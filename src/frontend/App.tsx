/* eslint-disable max-lines-per-function */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { EventEntry, FilterState, NodeStats, PartialNodeStats, PeerStats, PeerWithCountry, WsState } from '../types/hydrabase'
import type { MessageEnvelope, SearchHistoryEntry } from '../types/hydrabase-schemas'

import { error, warn } from '../utils/log'
import { ActivityFeed } from './components/ActivityFeed'
import { ApiKeyGate } from './components/ApiKeyGate'
import { PeerDetail } from './components/PeerDetail'
import { Sidebar, type Tab } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { DhtTab } from './tabs/dht'
import { MessagesTab } from './tabs/Messages'
import { OverviewTab } from './tabs/Overview'
import { PeersTab } from './tabs/Peers'
import { SearchTab } from './tabs/Search'
import { VotesTab } from './tabs/votes'
import { BG, GLOBAL_STYLES, TEXT } from './theme'
import { getCountry, mergePartialStats } from './utils'

export interface BwPoint { dl: number; ul: number }

const BW_HISTORY_LEN = 300
const nonce = Math.random()

const filterPeers = (peers: PeerWithCountry[], filter: FilterState) => [...peers].filter((p) => filter === 'all' || (p.connection === undefined && filter === 'disconnected') || (p.connection !== undefined && filter === 'connected'))

const Dashboard = ({ apiKey, socket }: { apiKey: string; socket: string }) => {
  const [wsState, setWsState] = useState<WsState>('connecting')
  const [peers, setPeers] = useState<PeerWithCountry[]>([])
  const [dhtNodes, setDhtNodes] = useState<{ country: string; host: string }[]>([])
  const [eventLog, setEventLog] = useState<EventEntry[]>([])
  const [uptime, setUptime] = useState<number>(0)
  const [bwHistory, setBwHistory] = useState<BwPoint[]>(Array(BW_HISTORY_LEN).fill({ dl: 0, ul: 0 }))
  const prevTotalsRef = useRef<{ DL: number; UL: number; }>({ DL: 0, UL: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchType, setSearchType] = useState<'album.tracks' | 'albums' | 'artist.albums' | 'artist.tracks' | 'artists' | 'tracks'>('artists')
  const [searchResults, setSearchResults] = useState<null | unknown[]>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<null | string>(null)
  const [searchElapsed, setSearchElapsed] = useState<null | number>(null)
  const [playingId, setPlayingId] = useState<null | string>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingSearches = useRef(new Map<number, (r: unknown[]) => void>())
  const nonceRef = useRef(Math.floor(nonce * 90_000) + 10_000)
  const [tab, setTab] = useState<Tab>('overview')
  // keep tabRef in sync so the ws message handler can read current tab without stale closure
  const [sel, setSel] = useState<null | PeerWithCountry>(null)
  const [filter, setFilter] = useState<FilterState>('all')
  const [stats, setStats] = useState<NodeStats | null>(null)
  const [dhtNodeCounts, setDhtNodeCounts] = useState<number[]>([])
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [messages, setMessages] = useState<MessageEnvelope[]>([])
  const [unreadMessages, setUnreadMessages] = useState(0)
  const statsRef = useRef<NodeStats | null>(null)

  const onPeerStatsRef = useRef<({ nonce, peer_stats }: { nonce: number; peer_stats: PeerStats, }) => void>(() => warn('DEVWARN:', '[WEBUI] onPeerStatsRef not initialised'))
  const wsRef = useRef<undefined | WebSocket>(undefined)
  const tabRef = useRef(tab)

  const addLog = useCallback((lv: string, m: string) => {
    setEventLog((prev) => [...prev.slice(-199), { lv, m, t: new Date().toISOString().slice(11, 19) }])
  }, [])

  const applyStats = useCallback((fullOrPartialStats: NodeStats | PartialNodeStats) => {
    // Check if it's a full or partial stats object
    const isFull = 'dhtNodes' in fullOrPartialStats && fullOrPartialStats.dhtNodes !== undefined &&
                   'peers' in fullOrPartialStats && 'self' in fullOrPartialStats

    let newStats: NodeStats
    if (isFull) {
      newStats = fullOrPartialStats as NodeStats
    } else {
      // It's a partial update - merge with existing
      newStats = mergePartialStats(statsRef.current, fullOrPartialStats as PartialNodeStats)
    }

    statsRef.current = newStats
    setStats(newStats)
    setDhtNodeCounts(prev => ([...prev, newStats.dhtNodes.length]))
    Promise.all(newStats.peers.known.map(async (peer) => {
      const ip = peer.connection?.hostname.split(':')[0] ?? 'unknown'
      const country = ip === 'unknown' ? 'N/A' : await getCountry(ip)
      return { ...peer, activity: [], country }
    }))
      .then((peers) => setPeers(peers))
    Promise.all(newStats.dhtNodes.map(async (host) => ({ country: await getCountry((host.split(':') as [string, string])[0]), host })))
      .then((nodes) => setDhtNodes(nodes))

    const totalDL = (newStats.peers.known ?? []).reduce((a, p) => a + (p.connection?.totalDL ?? 0), 0)
    const totalUL = (newStats.peers.known ?? []).reduce((a, p) => a + (p.connection?.totalUL ?? 0), 0)
    const dlDelta = Math.max(0, totalDL - prevTotalsRef.current.DL)
    const ulDelta = Math.max(0, totalUL - prevTotalsRef.current.UL)
    prevTotalsRef.current = { DL: totalDL, UL: totalUL }
    setBwHistory(prev => [...prev.slice(1 - BW_HISTORY_LEN), { dl: dlDelta, ul: ulDelta }])

    addLog('INFO', isFull ? 'Received full stats' : 'Received stats update')
  }, [addLog])

  useEffect(() => {
    let destroyed = false
    const connect = () => {
      if (destroyed) return
      addLog('INFO', `Connecting to ${socket}…`)
      setWsState('connecting')
      const ws = new WebSocket(socket, [`x-api-key-${apiKey}`])
      wsRef.current = ws
      ws.onopen = () => {
        if (destroyed) { ws.close(); return }
        setWsState('open')
        addLog('INFO', 'WebSocket connected')
        ws.send(JSON.stringify({ nonce: nonceRef.current++, search_history: 'get' }))
      }
      ws.onmessage = (e: MessageEvent) => {
        if (destroyed) return
        try {
          const data = JSON.parse(e.data)
          if (data.response !== undefined && data.nonce !== undefined) {
            const resolve = pendingSearches.current.get(data.nonce)
            if (resolve) { pendingSearches.current.delete(data.nonce); resolve(data.response); return }
          }
          if (data.search_history !== undefined) {
            setSearchHistory(data.search_history)
          } else if (data.deliver_message) {
            setMessages(prev => [...prev, data.deliver_message as MessageEnvelope])
            if (tabRef.current !== 'messages') setUnreadMessages(u => u + 1)
          } else if (data.stats) applyStats(data.stats)
          else if (data.partial_stats) applyStats(data.partial_stats)
          else if (data.peer_stats) onPeerStatsRef.current(data)
          else addLog('DEBUG', `WS msg: ${e.data.slice(0, 80)}`)
        } catch (err) {
          error('ERROR:', '[WEBUI] onMessage', {err})
          addLog('WARN', `Unparseable message: ${e.data.slice(0, 60)}`)
        }
      }
      ws.onerror  = () => { if (!destroyed) { setWsState('error');  addLog('ERROR', 'WebSocket error') } }
      ws.onclose  = (ev: CloseEvent) => {
        if (!destroyed) {
          setWsState('closed')
          addLog('WARN', `WebSocket closed (${ev.code}). Reconnecting in 5s…`)
          setTimeout(connect, 5000)
        }
      }
    }
    connect()
    return () => { destroyed = true; wsRef.current?.close() }
  }, [applyStats, addLog, socket, apiKey])

  useEffect(() => {
    const id = setInterval(() => setUptime((u) => u + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const doSearch = useCallback(async () => {
    const q = searchQuery.trim()
    if (!q) return
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) { setSearchError('WebSocket not connected'); return }
    setSearchLoading(true); setSearchError(null); setSearchResults(null); setSearchElapsed(null)
    const nonce = nonceRef.current++
    const t0 = performance.now()
    const timeout = setTimeout(() => {
      if (pendingSearches.current.has(nonce)) {
        pendingSearches.current.delete(nonce)
        setSearchLoading(false)
        setSearchError('Search timed out after 30s')
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
    
    ws.send(JSON.stringify({ nonce: nonceRef.current++, search_history: 'get' }))
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

  const handleHistorySelect = useCallback((entry: SearchHistoryEntry) => {
    setSearchQuery(entry.query)
    setSearchType(entry.type)
    setShowHistory(false)
    setTimeout(() => doSearch(), 0)
  }, [doSearch, setSearchQuery, setSearchType])

  const handleRemoveHistory = useCallback((entry: SearchHistoryEntry, e: React.MouseEvent) => {
    e.stopPropagation()
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ nonce: nonceRef.current++, search_history: { remove: entry.id } }))
    }
  }, [])

  const handleSendMessage = useCallback((to: `0x${string}`, payload: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    setMessages(prev => [...prev, { from: stats?.self.address ?? '0x0' as `0x${string}`, payload, sig: '', timestamp: Date.now(), to, ttl: 86_400_000 }])
    ws.send(JSON.stringify({ nonce: nonceRef.current++, send_message: { payload, to } }))
  }, [stats?.self.address])

  const handleClearHistory = useCallback(() => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ nonce: nonceRef.current++, search_history: 'clear' }))
    }
    setShowHistory(false)
  }, [])

  const handleSetTab = useCallback((next: React.SetStateAction<Tab>) => {
    setTab((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next
      if (resolved === 'messages') setUnreadMessages(0)
      return resolved
    })
  }, [])

  useEffect(() => { tabRef.current = tab }, [tab])

  const tLabels = Array.from({ length: 60 }, (_, i) => `${60 - i}s`).toReversed()
  // const onPeerStatsCallback = (onPeerStats: ({ nonce, peer_stats }: { nonce: number; peer_stats: PeerStats, }) => void) => {
  //   onPeerStatsRef.current = onPeerStats
  // }

  return <div style={{ background: BG, color: TEXT, display: 'flex', fontFamily: "'JetBrains Mono','Courier New',monospace", fontSize: 13, minHeight: '100vh' }}>
    <style>{GLOBAL_STYLES}</style>
    <Sidebar peers={peers} setTab={handleSetTab} stats={stats} tab={tab} unreadMessages={unreadMessages} uptime={uptime} />
    <div style={{ animation: 'fadein .3s ease', flex: 1, minWidth: 0, padding: '14px 16px 70px' }}>
      {tab === 'overview' && <OverviewTab bwHistory={bwHistory} onViewMorePeers={() => handleSetTab('peers')} peers={peers} sel={sel} setSel={setSel} stats={stats} uptime={uptime} />}
      {tab === 'peers' && <PeersTab filter={filter} sel={sel} setFilter={setFilter} setSel={setSel} sorted={filterPeers(peers, filter)} />}
      {tab === 'dht' && <DhtTab dhtNodeCounts={dhtNodeCounts} dhtNodes={dhtNodes} socket={socket} stats={stats} tLabels={tLabels} wsState={wsState} />}
      {tab === 'votes' && <VotesTab peers={peers} stats={stats} />}
      {tab === 'search' && <SearchTab onClearHistory={handleClearHistory} onHistorySelect={handleHistorySelect} onRemoveHistory={handleRemoveHistory} onSearch={doSearch} onTogglePlay={handleTogglePlay} playingId={playingId} searchElapsed={searchElapsed} searchError={searchError} searchHistory={searchHistory} searchLoading={searchLoading} searchQuery={searchQuery} searchResults={searchResults} searchType={searchType} setSearchQuery={setSearchQuery} setSearchResults={setSearchResults} setSearchType={setSearchType} setShowHistory={setShowHistory} showHistory={showHistory} />}
      {tab === 'messages' && <MessagesTab messages={messages} ownAddress={stats?.self.address} peers={peers} sendMessage={handleSendMessage} />}
    </div>
    <PeerDetail onClose={() => setSel(null)} peer={sel} wsRef={wsRef} />
    <ActivityFeed eventLog={eventLog} />
    <StatusBar dhtNodes={dhtNodes} peers={peers} setTab={handleSetTab} uptime={uptime} wsState={wsState} />
  </div>
}

export default function App() {
  const [socket, setSocket] = useState<null | string>(() => localStorage.getItem('socket'))
  const [key, setKey] = useState<null | string>(() => localStorage.getItem('api_key'))

  if (!socket || !key) return <ApiKeyGate onSubmit={(s, k) => {
    setSocket(s)
    setKey(k)
  }} />

  return <Dashboard apiKey={key} socket={socket} />
}
