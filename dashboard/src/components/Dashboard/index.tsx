// TODO: search history

import { type JSX, useCallback, useEffect, useRef, useState } from "react"

import type { ApiPeer, NodeStats } from "../../../../src/StatsReporter"
import type { EventEntry, FilterState, PeerWithCountry, VoteCounts, WsState } from "../../types"

import { enrichPeers, getCountry } from "../../geo"
import { ACCENT, BG, GLOBAL_STYLES, TEXT } from "../../theme"
import { PeerDetail } from "../PeerDetail"
import { DhtTab } from "./tabs/dht"
import { OverviewTab } from "./tabs/Overview"
import { PeersTab } from "./tabs/Peers"
import { SearchTab } from "./tabs/_Search"
import { VotesTab } from "./tabs/votes"
import type { PeerStats } from "../../../../src/networking/ws/peer"
import { Sidebar, type Tab } from "../SideBar"
import { StatusBar } from "../StatusBar"
import { ActivityFeed } from "../ActivityFeed"

const sortPeers = (peers: PeerWithCountry[], filter: FilterState, sortD: number, sortK: keyof ApiPeer) => [...peers].filter((p) => filter === "all" || p.status === filter).sort((a, b) => {
  const av = a[sortK] as unknown as number | string | undefined
  const bv = b[sortK] as unknown as number | string | undefined
  if (typeof av === "string" || typeof bv === "string") {return String(av ?? "").localeCompare(String(bv ?? "")) * sortD}
  return ((av ?? -Infinity) - (bv ?? -Infinity)) * sortD
})

export const Dashboard = ({ apiKey, socket }: { apiKey: string; socket: string }) => {
  const [wsState, setWsState] = useState<WsState>("connecting")
  const [peers, setPeers] = useState<PeerWithCountry[]>([])
  const [selfAddr, setSelfAddr] = useState<`0x${string}`>('0x0')
  const [votes, setVotes] = useState<VoteCounts>({ albums: 0, artists: 0, tracks: 0 })
  const [peerData, setPeerData] = useState<VoteCounts>({ albums: 0, artists: 0, tracks: 0 })
  const [dhtNodes, setDhtNodes] = useState<{ country: string; host: string }[]>([])
  const [installedPlugins, setInstalledPlugins] = useState<string[]>([])
  const [knownPlugins, setKnownPlugins] = useState<string[]>([])
  const [eventLog, setEventLog] = useState<EventEntry[]>([])
  const [dhtNodeCounts, setDhtNodeCounts] = useState<number[]>([])
  const [uptime, setUptime] = useState<number>(0)
  // Search state
  const [searchQuery, setSearchQuery] = useState("")
  const [searchType, setSearchType] = useState<"artist" | "album" | "track" | "artist.albums" | 'artist.tracks' | 'album.tracks'>("artist")
  const [searchResults, setSearchResults] = useState<null | unknown[]>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<null | string>(null)
  const [searchElapsed, setSearchElapsed] = useState<null | number>(null)
  const [playingId, setPlayingId] = useState<null | string>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingSearches = useRef(new Map<number, (r: unknown[]) => void>())
  const nonceRef = useRef(Math.floor(Math.random() * 90_000) + 10_000)
  // Peers / nav state
  const [tab, setTab] = useState<Tab>("overview")
  const [sel, setSel] = useState<PeerWithCountry | null>(null)
  const [sortK, setSortK] = useState<keyof ApiPeer>("status")
  const [sortD, setSortD] = useState<number>(1)
  const [filter, setFilter] = useState<FilterState>("all")
  const onPeerStatsRef = useRef<({ peer_stats, nonce }: { peer_stats: PeerStats, nonce: number }) => void>(() => {})
  const wsRef = useRef<undefined | WebSocket>(undefined)
  const addLog = useCallback((lv: string, m: string) => { setEventLog((prev) => [...prev.slice(-199), { lv, m, t: new Date().toISOString().slice(11, 19) }]) }, [])
  const applyStats = useCallback((stats: NodeStats) => {
    setSelfAddr(stats.address)
    setVotes(stats.votes)
    setPeerData(stats.peerData)
    Promise.all(stats.dhtNodes.map(async (host) => ({ country: await getCountry(host.split(":")[0]!), host }))).then((nodes) => setDhtNodes(nodes))
    setInstalledPlugins(stats.installedPlugins)
    setKnownPlugins(stats.knownPlugins)
    setDhtNodeCounts(prev => [...prev, stats.dhtNodes?.length ?? 0])
    enrichPeers(stats.peers ?? [], stats.knownPeers).then(p => setPeers(p))
    addLog("INFO", `Stats received — ${stats.connectedPeers} connected, ${(stats.dhtNodes ?? []).length} DHT nodes`)
  }, [addLog])
  useEffect(() => {
    let destroyed = false
    const connect = () => {
      if (destroyed) return
      addLog("INFO", `Connecting to ${socket}…`)
      setWsState("connecting")
      const ws = new WebSocket(socket, [`x-api-key-${apiKey}`])
      wsRef.current = ws
      ws.onopen = () => { if (destroyed) { ws.close(); return } setWsState("open"); addLog("INFO", "WebSocket connected") }
      ws.onmessage = (e: MessageEvent) => {
        if (destroyed) return
        try {
          const data = JSON.parse(e.data)
          if (data.response !== undefined && data.nonce !== undefined) {
            const resolve = pendingSearches.current.get(data.nonce)
            if (resolve) { pendingSearches.current.delete(data.nonce); resolve(data.response); return }
          }
          if (data.stats && data.stats.address) applyStats(data.stats)
          else if (data.peer_stats) onPeerStatsRef.current(data)
          else addLog("DEBUG", `WS msg: ${e.data.slice(0, 80)}`)
        } catch(err) {
          console.error(err)
          addLog("WARN", `Unparseable message: ${e.data.slice(0, 60)}`)
        }
      }
      ws.onerror  = () => { if (!destroyed) { setWsState("error");  addLog("ERROR", "WebSocket error") } }
      ws.onclose  = (ev: CloseEvent) => { if (!destroyed) { setWsState("closed"); addLog("WARN", `WebSocket closed (${ev.code}). Reconnecting in 5s…`); setTimeout(connect, 5000) } }
    }
    connect()
    return () => { destroyed = true; wsRef.current?.close() }
  }, [applyStats, addLog])
  useEffect(() => {
    const id = setInterval(() => setUptime((u) => u + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const doSearch = useCallback(async () => {
    const q = searchQuery.trim()
    if (!q) return
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) { setSearchError("WebSocket not connected"); return}
    setSearchLoading(true); setSearchError(null); setSearchResults(null); setSearchElapsed(null)
    const nonce = nonceRef.current++
    const t0 = performance.now()
    const timeout = setTimeout(() => {
      if (pendingSearches.current.has(nonce)) {
        pendingSearches.current.delete(nonce)
        setSearchLoading(false)
        setSearchError("Search timed out after 30s")
      }
    }, 30_000)
    const result = await new Promise<unknown[]>(resolve => {
      pendingSearches.current.set(nonce, resolve)
      ws.send(JSON.stringify({ nonce, request: { query: q, type: searchType } }))
    })
    clearTimeout(timeout)
    setSearchElapsed(performance.now() - t0)
    setSearchResults(result)
    setSearchLoading(false)
  }, [searchQuery, searchType])
  const handleTogglePlay = useCallback((id: string, previewUrl: string) => {
    if (playingId === id) {
      audioRef.current?.pause()
      setPlayingId(null)
    } else {
      audioRef.current?.pause()
      const a = new Audio(previewUrl)
      audioRef.current = a
      a.play()
      setPlayingId(id)
      a.onended = () => setPlayingId(null)
    }
  }, [playingId])
  const toggleSort = (k: keyof ApiPeer) => { if (sortK === k) {setSortD((d) => -d)} else { setSortK(k); setSortD(-1) } }
  const SI = ({ k }: { k: keyof ApiPeer | 'icon' }): JSX.Element => sortK !== k ? <span style={{ opacity: 0.2 }}>⇅</span> : sortD === 1 ? <span style={{ color: ACCENT }}>↑</span> : <span style={{ color: ACCENT }}>↓</span>
  const tLabels = Array.from({ length: 60 }, (_, i) => `${60 - i}s`).toReversed()
  const onPeerStatsCallback = (onPeerStats: ({ peer_stats, nonce }: { peer_stats: PeerStats, nonce: number }) => void) => { onPeerStatsRef.current = onPeerStats }
  return <div style={{ background: BG, color: TEXT, display: "flex", fontFamily: "'JetBrains Mono','Courier New',monospace", fontSize: 13, minHeight: "100vh" }}>
    <style>{GLOBAL_STYLES}</style>
    <Sidebar peers={peers} selfAddr={selfAddr} setTab={setTab} tab={tab} uptime={uptime} />
    <div style={{ animation: "fadein .3s ease", flex: 1, minWidth: 0, padding: "14px 16px 70px" }}>
      {tab === "overview" && <OverviewTab peers={peers} sel={sel} setSel={setSel} SI={SI} toggleSort={toggleSort} votes={votes} />}
      {tab === "peers" && <PeersTab filter={filter} sel={sel} setFilter={setFilter} setSel={setSel} sorted={sortPeers(peers, filter, sortD, sortK)} />}
      {tab === "dht" && <DhtTab dhtNodeCounts={dhtNodeCounts} dhtNodes={dhtNodes} socket={socket} tLabels={tLabels} wsState={wsState} />}
      {tab === "votes" && <VotesTab installedPlugins={installedPlugins} knownPlugins={knownPlugins} peerData={peerData} peers={peers} votes={votes} />}
      {tab === "search" && <SearchTab onSearch={doSearch} onTogglePlay={handleTogglePlay} playingId={playingId} searchElapsed={searchElapsed} searchError={searchError} searchLoading={searchLoading} searchQuery={searchQuery} searchResults={searchResults} setSearchResults={setSearchResults} searchType={searchType} setSearchQuery={setSearchQuery} setSearchType={setSearchType} />}
    </div>
    <PeerDetail onClose={() => setSel(null)} peer={sel} wsRef={wsRef} callback={onPeerStatsCallback} />
    <ActivityFeed eventLog={eventLog} />
    <StatusBar dhtNodes={dhtNodes} peers={peers} uptime={uptime} wsState={wsState} />
  </div>
}
