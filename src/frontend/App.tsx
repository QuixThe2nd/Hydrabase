/* eslint-disable max-lines, max-lines-per-function */
/* global window */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { ApiPeer, EventEntry, FilterState, NodeStats, PartialNodeStats, PeerConnectionAttempt, PeerConnectionError, PeerStats, PeerWithCountry, RuntimeConfigSnapshot, RuntimeConfigUpdate, StatsPulsePayload, StatsVotesPayload, WsState } from '../types/hydrabase'
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
import { SettingsTab } from './tabs/Settings'
import { VotesTab } from './tabs/votes'
import { BG, GLOBAL_STYLES, TEXT } from './theme'
import { getCountryForHost, mergePartialStats } from './utils'

export interface BwPoint { dl: number; t: number; ul: number }
type SearchType = 'album.tracks' | 'albums' | 'artist.albums' | 'artist.tracks' | 'artists' | 'tracks'

const PULSE_WINDOW_MS = 6 * 60 * 60 * 1000
const PULSE_MIN_INTERVAL_MS = 500
const CONNECT_ATTEMPT_TIMEOUT_MS = 30_000
const MAX_CONNECTION_ATTEMPTS = 20
const GLOBAL_CHAT_ADDRESS = '0x0' as `0x${string}`

const keepRecentPulsePoints = (history: BwPoint[], latestTimestamp: number, intervalMs: number): BwPoint[] => {
  const maxPoints = Math.ceil(PULSE_WINDOW_MS / Math.max(intervalMs, PULSE_MIN_INTERVAL_MS)) + 4
  const bounded = history.length > maxPoints ? history.slice(history.length - maxPoints) : history
  const cutoff = latestTimestamp - PULSE_WINDOW_MS
  const firstRecentIndex = bounded.findIndex(point => point.t >= cutoff)
  if (firstRecentIndex <= 0) return bounded
  return bounded.slice(firstRecentIndex)
}

const messageEnvelopeKey = (envelope: MessageEnvelope): string => `${envelope.from}|${envelope.to}|${envelope.timestamp}`

const mergeMessages = (current: MessageEnvelope[], incoming: MessageEnvelope[]): { added: number; merged: MessageEnvelope[] } => {
  if (incoming.length === 0) return { added: 0, merged: current }
  const seen = new Set(current.map(messageEnvelopeKey))
  let added = 0
  const merged = [...current]
  for (const envelope of incoming) {
    const key = messageEnvelopeKey(envelope)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(envelope)
    added += 1
  }
  if (added === 0) return { added: 0, merged: current }
  merged.sort((a, b) => a.timestamp - b.timestamp)
  return { added, merged }
}

const nonce = Math.random()

const TAB_PATHS: Record<Tab, string> = {
  dht: '/dht',
  messages: '/messages',
  overview: '/',
  peers: '/peers',
  search: '/search',
  settings: '/settings',
  votes: '/votes',
}

const SEARCH_TYPE_PATHS: Record<SearchType, string> = {
  'album.tracks': 'album-tracks',
  albums: 'albums',
  'artist.albums': 'artist-albums',
  'artist.tracks': 'artist-tracks',
  artists: 'artists',
  tracks: 'tracks',
}

const PATH_SEARCH_TYPES: Record<string, SearchType> = Object.fromEntries(
  Object.entries(SEARCH_TYPE_PATHS).map(([searchType, slug]) => [slug, searchType as SearchType])
) as Record<string, SearchType>

const PATH_TABS: Record<string, Tab> = {
  '/': 'overview',
  '/dht': 'dht',
  '/messages': 'messages',
  '/overview': 'overview',
  '/peers': 'peers',
  '/search': 'search',
  '/settings': 'settings',
  '/votes': 'votes',
}

const isTab = (value: string): value is Tab => (
  value === 'dht'
  || value === 'messages'
  || value === 'overview'
  || value === 'peers'
  || value === 'search'
  || value === 'settings'
  || value === 'votes'
)

const isSearchType = (value: string): value is SearchType => (
  value === 'album.tracks'
  || value === 'albums'
  || value === 'artist.albums'
  || value === 'artist.tracks'
  || value === 'artists'
  || value === 'tracks'
)

const getLocationState = (): { peerAddress?: string; searchType: SearchType; tab: Tab } => {
  const pathname = window.location.pathname.replace(/\/+$/u, '') || '/'

  const peerMatch = pathname.match(/^\/peers\/(?<address>0x[0-9a-fA-F]+)$/u)
  if (peerMatch?.groups?.['address']) return { peerAddress: peerMatch.groups['address'], searchType: 'artists', tab: 'peers' }

  const searchRouteMatch = pathname.match(/^\/search\/(?<searchType>[a-z-]+)$/u)
  if (searchRouteMatch?.groups?.['searchType']) {
    const fromPath = PATH_SEARCH_TYPES[searchRouteMatch.groups['searchType']]
    if (fromPath) return { searchType: fromPath, tab: 'search' }
  }

  const searchTypeParam = new URLSearchParams(window.location.search).get('searchType')
  if (searchTypeParam && isSearchType(searchTypeParam)) return { searchType: searchTypeParam, tab: 'search' }

  const tabParam = new URLSearchParams(window.location.search).get('tab')
  if (tabParam && isTab(tabParam)) return { searchType: 'artists', tab: tabParam }

  const hash = window.location.hash.replace(/^#/u, '').replace(/^\//u, '')
  if (hash && isTab(hash)) return { searchType: 'artists', tab: hash }

  return { searchType: 'artists', tab: PATH_TABS[pathname] ?? 'overview' }
}

const shouldCanonicalizeTabUrl = (): boolean => {
  const pathname = window.location.pathname.replace(/\/+$/u, '') || '/'
  const searchRouteMatch = pathname.match(/^\/search\/(?<searchType>[a-z-]+)$/u)
  if (searchRouteMatch?.groups?.['searchType']) {
    const fromPath = PATH_SEARCH_TYPES[searchRouteMatch.groups['searchType']]
    if (fromPath) return true
  }

  if (pathname === '/search') return true

  const searchTypeParam = new URLSearchParams(window.location.search).get('searchType')
  if (searchTypeParam && isSearchType(searchTypeParam)) return true

  const param = new URLSearchParams(window.location.search).get('tab')
  if (param && isTab(param)) return true

  const hash = window.location.hash.replace(/^#/u, '').replace(/^\//u, '')
  if (hash && isTab(hash)) return true

  return pathname in PATH_TABS
}

const updateUrlForState = (tab: Tab, searchType: SearchType, mode: 'push' | 'replace' = 'push') => {
  const url = new URL(window.location.href)
  const nextPath = tab === 'search' ? `/search/${SEARCH_TYPE_PATHS[searchType]}` : TAB_PATHS[tab]
  if (url.pathname !== nextPath) {
    url.pathname = nextPath
  }
  if (url.searchParams.get('tab') !== null) {
    url.searchParams.set('tab', tab)
  }
  const next = `${url.pathname}${url.search}${url.hash}`
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (next !== current) {
    if (mode === 'replace') window.history.replaceState(null, '', next)
    else window.history.pushState(null, '', next)
  }
}

const hasPopulatedPeerStats = (peer: PeerWithCountry): boolean => {
  const { auth, connection } = peer
  if (!connection) return Boolean(auth?.username || auth?.hostname || auth?.bio)
  return connection.confidence > 0
    || connection.latency > 0
    || connection.lookupTime > 0
    || connection.plugins.length > 0
    || connection.totalDL > 0
    || connection.totalUL > 0
    || connection.uptime > 0
    || Boolean(auth?.username || auth?.hostname || auth?.bio)
}

const filterPeers = (peers: PeerWithCountry[], filter: FilterState) => [...peers]
  .filter((p) => filter === 'all' || (p.connection === undefined && filter === 'disconnected') || (p.connection !== undefined && filter === 'connected'))
  .sort((a, b) => Number(hasPopulatedPeerStats(b)) - Number(hasPopulatedPeerStats(a)) || Number(b.connection !== undefined) - Number(a.connection !== undefined))

const Dashboard = ({ apiKey, socket }: { apiKey: string; socket: string }) => {
  const initialLocationState = getLocationState()
  const [wsState, setWsState] = useState<WsState>('connecting')
  const [peers, setPeers] = useState<PeerWithCountry[]>([])
  const [dhtNodes, setDhtNodes] = useState<{ country: string; host: string }[]>([])
  const [eventLog, setEventLog] = useState<EventEntry[]>([])
  const [uptime, setUptime] = useState<number>(0)
  const nodeStartTimeRef = useRef<number>(0)
  const [bwHistory, setBwHistory] = useState<BwPoint[]>([])
  const prevPulseTotalsRef = useRef<null | { DL: number; UL: number; }>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchType, setSearchType] = useState<SearchType>(() => initialLocationState.searchType)
  const [searchResults, setSearchResults] = useState<null | unknown[]>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<null | string>(null)
  const [searchElapsed, setSearchElapsed] = useState<null | number>(null)
  const [playingId, setPlayingId] = useState<null | string>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingSearches = useRef(new Map<number, (r: unknown[]) => void>())
  const pendingRuntimeConfig = useRef(new Map<number, (result: { error?: string; snapshot?: RuntimeConfigSnapshot }) => void>())
  const pendingPurgePeerCache = useRef(new Map<number, (result: { error?: string }) => void>())
  const pendingConnectAttempts = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const nonceRef = useRef(Math.floor(nonce * 90_000) + 10_000)
  const [tab, setTab] = useState<Tab>(() => initialLocationState.tab)
  // keep tabRef in sync so the ws message handler can read current tab without stale closure
  const [sel, setSel] = useState<null | PeerWithCountry>(null)
  const pendingPeerAddrRef = useRef<null | string>(initialLocationState.peerAddress ?? null)
  const [filter, setFilter] = useState<FilterState>('all')
  const [stats, setStats] = useState<NodeStats | null>(null)
  const [dhtNodeCounts, setDhtNodeCounts] = useState<number[]>([])
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [messages, setMessages] = useState<MessageEnvelope[]>([])
  const [runtimeConfig, setRuntimeConfig] = useState<null | RuntimeConfigSnapshot>(null)
  const [runtimeConfigError, setRuntimeConfigError] = useState<null | string>(null)
  const [runtimeConfigLoading, setRuntimeConfigLoading] = useState(true)
  const [restartPendingReconnect, setRestartPendingReconnect] = useState(false)
  const restartSawDisconnectRef = useRef(false)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const statsRef = useRef<NodeStats | null>(null)
  const [connectionAttempts, setConnectionAttempts] = useState<PeerConnectionAttempt[]>([])
  const connectionAttemptsRef = useRef<PeerConnectionAttempt[]>([])
  const messagesRef = useRef<MessageEnvelope[]>([])
  const pendingDirectMessagesRef = useRef<MessageEnvelope[]>([])

  const onPeerStatsRef = useRef<({ nonce, peer_stats }: { nonce: number; peer_stats: PeerStats, }) => void>(() => warn('DEVWARN:', '[WEBUI] onPeerStatsRef not initialised'))
  const wsRef = useRef<undefined | WebSocket>(undefined)
  const tabRef = useRef(tab)

  const addLog = useCallback((lv: string, m: string, stack?: string) => {
    const entry: EventEntry = { lv, m, t: new Date().toISOString().slice(11, 19) }
    if (stack !== undefined) entry.stack = stack
    setEventLog((prev) => [...prev.slice(-199), entry])
  }, [])

  useEffect(() => {
    connectionAttemptsRef.current = connectionAttempts
  }, [connectionAttempts])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const appendMessages = useCallback((incoming: MessageEnvelope[]): number => {
    const { added, merged } = mergeMessages(messagesRef.current, incoming)
    if (added === 0) return 0
    messagesRef.current = merged
    setMessages(merged)
    return added
  }, [])

  useEffect(() => {
    if (!restartPendingReconnect) return
    if (wsState !== 'open') {
      restartSawDisconnectRef.current = true
      return
    }
    if (restartSawDisconnectRef.current) {
      setTimeout(() => setRestartPendingReconnect(false), 0)
      restartSawDisconnectRef.current = false
    }
  }, [restartPendingReconnect, wsState])

  const clearConnectAttemptTimeout = useCallback((nonce: number) => {
    const timeout = pendingConnectAttempts.current.get(nonce)
    if (!timeout) return
    clearTimeout(timeout)
    pendingConnectAttempts.current.delete(nonce)
  }, [])

  const markAttemptFailed = useCallback((nonce: number, errorPayload: PeerConnectionError): boolean => {
    const hasPendingNonce = connectionAttemptsRef.current.some((attempt) => attempt.nonce === nonce && attempt.state === 'pending')
    if (!hasPendingNonce) return false
    clearConnectAttemptTimeout(nonce)
    setConnectionAttempts((prev) => prev.map((attempt) => {
      if (attempt.nonce !== nonce || attempt.state !== 'pending') return attempt
      return {
        ...attempt,
        error: errorPayload,
        state: 'failed',
        timedOut: errorPayload.status === 408,
      }
    }))
    return true
  }, [clearConnectAttemptTimeout])

  const sendRuntimeConfigRequest = useCallback(async (payload: { update_config: RuntimeConfigUpdate }): Promise<RuntimeConfigSnapshot> => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket not connected')
    const requestNonce = nonceRef.current++
    const response = await new Promise<{ error?: string; snapshot?: RuntimeConfigSnapshot }>((resolve) => {
      const timeout = setTimeout(() => {
        pendingRuntimeConfig.current.delete(requestNonce)
        resolve({ error: 'Settings request timed out' })
      }, 10_000)
      pendingRuntimeConfig.current.set(requestNonce, (result) => {
        clearTimeout(timeout)
        resolve(result)
      })
      ws.send(JSON.stringify({ nonce: requestNonce, ...payload }))
    })
    if (response.error) throw new Error(response.error)
    if (response.snapshot) return response.snapshot
    throw new Error('Missing settings payload')
  }, [])

  const refreshRuntimeConfig = useCallback((): Promise<void> => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('WebSocket not connected'))
    setRuntimeConfigLoading(true)
    setRuntimeConfigError(null)
    ws.close()
    return Promise.resolve()
  }, [])

  const updateRuntimeConfig = useCallback(async (update: RuntimeConfigUpdate) => {
    setRuntimeConfigError(null)
    const snapshot = await sendRuntimeConfigRequest({ update_config: update })
    setRuntimeConfig(snapshot)
  }, [sendRuntimeConfigRequest])

  const purgePeerCache = useCallback(async (): Promise<void> => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket not connected')
    const requestNonce = nonceRef.current++
    const response = await new Promise<{ error?: string }>((resolve) => {
      const timeout = setTimeout(() => {
        pendingPurgePeerCache.current.delete(requestNonce)
        resolve({ error: 'Peer cache purge timed out' })
      }, 10_000)
      pendingPurgePeerCache.current.set(requestNonce, (result) => {
        clearTimeout(timeout)
        resolve(result)
      })
      ws.send(JSON.stringify({ nonce: requestNonce, purge_peer_cache: true }))
    })
    if (response.error) throw new Error(response.error)
  }, [])

  const markLatestPendingAttemptForHostname = useCallback((hostname: `${string}:${number}`, errorPayload: PeerConnectionError): boolean => {
    const latestPendingAttempt = connectionAttemptsRef.current.find((attempt) => attempt.hostname === hostname && attempt.state === 'pending')
    if (!latestPendingAttempt) return false
    clearConnectAttemptTimeout(latestPendingAttempt.nonce)
    setConnectionAttempts((prev) => prev.map((attempt) => {
      if (attempt.nonce !== latestPendingAttempt.nonce || attempt.state !== 'pending') return attempt
      return {
        ...attempt,
        error: errorPayload,
        state: 'failed',
        timedOut: errorPayload.status === 408,
      }
    }))
    return true
  }, [clearConnectAttemptTimeout])

  const applyPulse = useCallback((statsPulse: StatsPulsePayload) => {
    const pointTimestamp = Number(new Date(statsPulse.timestamp)) || Date.now()
    const previous = prevPulseTotalsRef.current
    const dlDelta = previous ? Math.max(0, statsPulse.totalDL - previous.DL) : 0
    const ulDelta = previous ? Math.max(0, statsPulse.totalUL - previous.UL) : 0
    prevPulseTotalsRef.current = { DL: statsPulse.totalDL, UL: statsPulse.totalUL }

    setBwHistory((prev) => {
      const next = [...prev, { dl: dlDelta, t: pointTimestamp, ul: ulDelta }]
      return keepRecentPulsePoints(next, pointTimestamp, statsPulse.intervalMs)
    })
  }, [])

  const applyPulseHistory = useCallback((history: StatsPulsePayload[]) => {
    if (history.length === 0) return
    const points: BwPoint[] = []
    let prevDL = 0
    let prevUL = 0
    for (let i = 0; i < history.length; i++) {
      const entry = history[i]
      if (!entry) continue
      const t = Number(new Date(entry.timestamp)) || Date.now()
      const dl = i > 0 ? Math.max(0, entry.totalDL - prevDL) : 0
      const ul = i > 0 ? Math.max(0, entry.totalUL - prevUL) : 0
      prevDL = entry.totalDL
      prevUL = entry.totalUL
      points.push({ dl, t, ul })
    }
    const last = history[history.length - 1]
    if (!last || points.length === 0) return
    prevPulseTotalsRef.current = { DL: last.totalDL, UL: last.totalUL }
    const latestTimestamp = points[points.length - 1]?.t ?? Date.now()
    setBwHistory(keepRecentPulsePoints(points, latestTimestamp, last.intervalMs))
  }, [])

  const applyStats = useCallback((fullOrPartialStats: NodeStats | PartialNodeStats) => {
    // Check if it's a full or partial stats object
    const isFull = 'dhtNodes' in fullOrPartialStats && fullOrPartialStats.dhtNodes !== undefined &&
                   'peers' in fullOrPartialStats && 'self' in fullOrPartialStats
    const partialUpdate = isFull ? null : fullOrPartialStats as PartialNodeStats

    let newStats: NodeStats
    if (isFull) {
      newStats = fullOrPartialStats as NodeStats
    } else {
      // It's a partial update - merge with existing
      newStats = mergePartialStats(statsRef.current, fullOrPartialStats as PartialNodeStats)
    }

    statsRef.current = newStats
    setStats(newStats)

    const selfAddress = newStats.self.address
    if (selfAddress && pendingDirectMessagesRef.current.length > 0) {
      const pendingForSelf = pendingDirectMessagesRef.current.filter((envelope) => envelope.to === selfAddress)
      pendingDirectMessagesRef.current = []
      const added = appendMessages(pendingForSelf)
      if (added > 0 && tabRef.current !== 'messages') setUnreadMessages((u) => u + added)
    }

    if (isFull || partialUpdate?.dhtNodes !== undefined) {
      setDhtNodeCounts(prev => ([...prev, newStats.dhtNodes.length]))
      Promise.all(newStats.dhtNodes.map(async (host) => ({ country: await getCountryForHost(host), host })))
        .then((nodes) => setDhtNodes(nodes))
    }

    if (isFull || partialUpdate?.peers?.known !== undefined) {
      Promise.all(newStats.peers.known.map(async (peer) => {
        const host = peer.connection?.hostname ?? peer.auth?.hostname
        const country = host ? await getCountryForHost(host) : 'N/A'
        return { ...peer, activity: [], country }
      }))
        .then((peers) => {
          setPeers(peers)
          const pending = pendingPeerAddrRef.current
          if (pending) {
            const found = peers.find(p => p.address === pending)
            if (found) { setSel(found); pendingPeerAddrRef.current = null }
          }
        })
    }

  }, [appendMessages])

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
        setRuntimeConfigLoading(true)
        setRuntimeConfigError(null)
        ws.send(JSON.stringify({ nonce: nonceRef.current++, search_history: 'get' }))
        ws.send(JSON.stringify({ message_history: 'get', nonce: nonceRef.current++ }))
      }
      ws.onmessage = (e: MessageEvent) => {
        if (destroyed) return
        try {
          const data = JSON.parse(e.data)
          if (data.response !== undefined && data.nonce !== undefined) {
            const resolve = pendingSearches.current.get(data.nonce)
            if (resolve) { pendingSearches.current.delete(data.nonce); resolve(data.response); return }
          }
          if (data.runtime_config !== undefined) {
            setRuntimeConfig(data.runtime_config as RuntimeConfigSnapshot)
            setRuntimeConfigLoading(false)
            setRuntimeConfigError(null)
            return
          }
          if ((data.runtime_config_updated !== undefined || data.config_error !== undefined) && data.nonce !== undefined) {
            const resolveConfig = pendingRuntimeConfig.current.get(data.nonce)
            if (resolveConfig) {
              pendingRuntimeConfig.current.delete(data.nonce)
              if (data.config_error === undefined) resolveConfig({ snapshot: data.runtime_config_updated as RuntimeConfigSnapshot })
              else resolveConfig({ error: String(data.config_error) })
              return
            }
          }
          if ((data.peer_cache_purged !== undefined || data.config_error !== undefined) && data.nonce !== undefined) {
            const resolvePurgePeerCache = pendingPurgePeerCache.current.get(data.nonce)
            if (resolvePurgePeerCache) {
              pendingPurgePeerCache.current.delete(data.nonce)
              if (data.config_error === undefined) resolvePurgePeerCache({})
              else resolvePurgePeerCache({ error: String(data.config_error) })
              return
            }
          }
          if (data.ping !== undefined && data.nonce !== undefined) {
            ws.send(JSON.stringify({ nonce: data.nonce, pong: { time: Date.now() } }))
            return
          }
          if (data.search_history !== undefined) {
            setSearchHistory(data.search_history)
          } else if (data.message_history !== undefined) {
            const snapshot = data.message_history as MessageEnvelope[]
            appendMessages(snapshot)
          } else if (data.message) {
            const packet = data.message as { envelope?: MessageEnvelope }
            const {envelope} = packet
            if (!envelope) return

            const selfAddress = statsRef.current?.self.address
            if (envelope.to === GLOBAL_CHAT_ADDRESS) {
              const added = appendMessages([envelope])
              if (added > 0 && tabRef.current !== 'messages') setUnreadMessages(u => u + added)
            } else if (!selfAddress) {
              pendingDirectMessagesRef.current.push(envelope)
            } else if (envelope.to === selfAddress) {
              const added = appendMessages([envelope])
              if (added > 0 && tabRef.current !== 'messages') setUnreadMessages(u => u + added)
            }
          } else if (data.stats) {
            const fullStats = data.stats as NodeStats
            if (fullStats.self?.nodeStartTime) nodeStartTimeRef.current = fullStats.self.nodeStartTime
            applyStats(fullStats)
          }
          else if (data.stats_self) {
            const selfStats = data.stats_self as NodeStats['self']
            if (selfStats.nodeStartTime) nodeStartTimeRef.current = selfStats.nodeStartTime
            applyStats({ self: selfStats })
          }
          else if (data.stats_peers) applyStats({ peers: { known: data.stats_peers } })
          else if (data.stats_votes) {
            const statsVotes = data.stats_votes as StatsVotesPayload
            applyStats({ peers: statsVotes.peers, self: statsVotes.self })
          }
          else if (data.stats_dht_nodes) applyStats({ dhtNodes: data.stats_dht_nodes })
          else if (data.stats_pulse) {
            const bundle = data.stats_pulse as { history: StatsPulsePayload[]; latest: StatsPulsePayload, }
            // Always apply history first, then latest
            if (bundle.history && bundle.history.length > 0) {
              applyPulseHistory(bundle.history)
            }
            if (bundle.latest) {
              applyPulse(bundle.latest)
            }
          }
          else if (data.stats_peer_connected) {
            const connectedPeer = data.stats_peer_connected as ApiPeer
            const currentKnown = statsRef.current?.peers.known ?? []
            const nextKnown = [connectedPeer, ...currentKnown.filter(peer => peer.address !== connectedPeer.address)]
            applyStats({ peers: { known: nextKnown } })
            addLog('INFO', `Peer connected: ${connectedPeer.auth?.username ?? connectedPeer.connection?.username ?? connectedPeer.address}`)
          }
          else if (data.stats_dht_node_connected) {
            const connectedNode = data.stats_dht_node_connected as string
            const currentNodes = statsRef.current?.dhtNodes ?? []
            if (!currentNodes.includes(connectedNode)) applyStats({ dhtNodes: [...currentNodes, connectedNode] })
            addLog('INFO', `DHT node connected: ${connectedNode}`)
          }
          else if (data.refresh_ui !== undefined) {
            addLog('INFO', 'Received refresh_ui from backend. Reloading UI...')
            window.location.reload()
          }
          else if (data.connection_error) {
            const connError = data.connection_error as PeerConnectionError
            const parsedNonce = typeof data.nonce === 'number'
              ? data.nonce
              : typeof data.nonce === 'string' && Number.isFinite(Number(data.nonce))
                ? Number(data.nonce)
                : null
            const matchedByNonce = parsedNonce === null ? false : markAttemptFailed(parsedNonce, connError)
            if (matchedByNonce) {
              // nonce correlation succeeded
            } else {
              markLatestPendingAttemptForHostname(connError.hostname, connError)
            }
            addLog('ERROR', `Connection error for ${connError.hostname}: ${connError.message}`, connError.stack || undefined)
          }
          else if (data.log_event) {
            const logEvt = data.log_event as { lv: string; m: string; stack?: string }
            addLog(logEvt.lv, logEvt.m, logEvt.stack)
          }
          else if (data.config_error !== undefined) addLog('ERROR', `Config update failed: ${String(data.config_error)}`)
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
  }, [applyPulse, applyPulseHistory, applyStats, addLog, markAttemptFailed, markLatestPendingAttemptForHostname, socket, apiKey, appendMessages])

  useEffect(() => () => {
      pendingConnectAttempts.current.forEach((timeout) => clearTimeout(timeout))
      pendingConnectAttempts.current.clear()
    }, [])

  useEffect(() => {
    const id = setInterval(() => {
      const start = nodeStartTimeRef.current
      setUptime(start > 0 ? Math.floor((Date.now() - start) / 1000) : 0)
    }, 1000)
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

  const handleSetSearchType = useCallback((next: React.SetStateAction<SearchType>) => {
    setSearchType((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next
      if (resolved !== prev && tabRef.current === 'search') updateUrlForState('search', resolved)
      return resolved
    })
  }, [])

  const handleHistorySelect = useCallback((entry: SearchHistoryEntry) => {
    setSearchQuery(entry.query)
    handleSetSearchType(entry.type)
    setShowHistory(false)
    setTimeout(() => doSearch(), 0)
  }, [doSearch, handleSetSearchType, setSearchQuery])

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

  const handleRequestConnect = useCallback((hostname: `${string}:${number}`) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      error('ERROR:', 'WebSocket not connected')
      return
    }
    const requestNonce = nonceRef.current++
    const pendingAttempt: PeerConnectionAttempt = {
      hostname,
      nonce: requestNonce,
      startedAt: Date.now(),
      state: 'pending',
    }
    setConnectionAttempts((prev) => ([
      pendingAttempt,
      ...prev,
    ].slice(0, MAX_CONNECTION_ATTEMPTS)))
    const timeout = setTimeout(() => {
      markAttemptFailed(requestNonce, {
        hostname,
        message: `Connection attempt timed out after ${CONNECT_ATTEMPT_TIMEOUT_MS / 1000}s`,
        stack: '',
        status: 408,
      })
      addLog('ERROR', `Connection timeout for ${hostname}`)
    }, CONNECT_ATTEMPT_TIMEOUT_MS)
    pendingConnectAttempts.current.set(requestNonce, timeout)
    addLog('INFO', `Requesting connection to ${hostname}...`)
    try {
      ws.send(JSON.stringify({ connect_peer: { hostname }, nonce: requestNonce }))
    } catch (err) {
      markAttemptFailed(requestNonce, {
        hostname,
        message: err instanceof Error ? err.message : 'Failed to send connect request',
        stack: err instanceof Error && err.stack ? err.stack : '',
        status: 500,
      })
      addLog('ERROR', `Failed to send connect request for ${hostname}`)
    }
  }, [addLog, markAttemptFailed])

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
      if (resolved === 'peers' && prev === 'peers' && sel !== null) {
        setSel(null)
        window.history.pushState(null, '', '/peers')
        return prev
      }
      if (resolved !== 'peers' && sel !== null) setSel(null)
      if (resolved === 'messages') setUnreadMessages(0)
      if (resolved !== prev) updateUrlForState(resolved, searchType)
      return resolved
    })
  }, [searchType, sel])

  const handleSelectPeer = useCallback((p: null | PeerWithCountry) => {
    if (!p) { setSel(null); return }
    setSel(p)
    setTab('peers')
    window.history.pushState(null, '', `/peers/${p.address}`)
  }, [])

  const handleRestart = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    restartSawDisconnectRef.current = false
    setRestartPendingReconnect(true)
    ws.send(JSON.stringify({ nonce: nonceRef.current++, restart: true }))
  }, [])

  const handlePeerClose = useCallback(() => {
    setSel(null)
    window.history.pushState(null, '', '/peers')
  }, [])

  useEffect(() => { tabRef.current = tab }, [tab])

  useEffect(() => {
    const syncTabFromUrl = () => {
      const fromLocation = getLocationState()
      setTab((current) => {
        if (current === fromLocation.tab) return current
        if (fromLocation.tab === 'messages') setUnreadMessages(0)
        return fromLocation.tab
      })
      setSearchType((current) => current === fromLocation.searchType ? current : fromLocation.searchType)
      if (fromLocation.peerAddress) {
        pendingPeerAddrRef.current = fromLocation.peerAddress
      } else {
        setSel(null)
      }
    }

    // Canonicalize tab URLs on first load (e.g. /overview -> /) without rewriting unknown deep links.
    if (shouldCanonicalizeTabUrl()) {
      const locationState = getLocationState()
      updateUrlForState(locationState.tab, locationState.searchType, 'replace')
    }
    window.addEventListener('popstate', syncTabFromUrl)
    window.addEventListener('hashchange', syncTabFromUrl)
    return () => {
      window.removeEventListener('popstate', syncTabFromUrl)
      window.removeEventListener('hashchange', syncTabFromUrl)
    }
  }, [])

  const sidebarTab = tab === 'peers' && sel !== null ? null : tab

  const tLabels = Array.from({ length: 60 }, (_, i) => `${60 - i}s`).toReversed()
  const onPeerStatsCallback = (onPeerStats: ({ nonce, peer_stats }: { nonce: number; peer_stats: PeerStats, }) => void) => {
    onPeerStatsRef.current = onPeerStats
  }

  return <div style={{ background: BG, color: TEXT, display: 'flex', fontFamily: "'JetBrains Mono','Courier New',monospace", fontSize: 13, minHeight: '100vh' }}>
    <style>{GLOBAL_STYLES}</style>
    <Sidebar onSelectPeer={handleSelectPeer} peers={peers} selectedPeerAddress={sel?.address ?? null} setTab={handleSetTab} stats={stats} tab={sidebarTab} unreadMessages={unreadMessages} uptime={uptime} />
    <div style={{ animation: 'fadein .3s ease', flex: 1, minWidth: 0, padding: '14px 16px 70px' }}>
      {tab === 'overview' && <OverviewTab bwHistory={bwHistory} onViewMorePeers={() => handleSetTab('peers')} peers={peers} sel={sel} setSel={handleSelectPeer} stats={stats} uptime={uptime} />}
      {tab === 'peers' && sel
        ? <PeerDetail callback={onPeerStatsCallback} messages={messages} onClose={handlePeerClose} ownAddress={stats?.self.address} peer={sel} peers={peers} sendMessage={handleSendMessage} wsRef={wsRef} />
        : tab === 'peers' && <PeersTab connectionAttempts={connectionAttempts} filter={filter} onRequestConnect={handleRequestConnect} peers={peers} sel={sel} setFilter={setFilter} setSel={handleSelectPeer} sorted={filterPeers(peers, filter)} />}
      {tab === 'dht' && <DhtTab dhtNodeCounts={dhtNodeCounts} dhtNodes={dhtNodes} socket={socket} stats={stats} tLabels={tLabels} wsState={wsState} />}
      {tab === 'votes' && <VotesTab peers={peers} stats={stats} />}
      {tab === 'search' && <SearchTab onClearHistory={handleClearHistory} onHistorySelect={handleHistorySelect} onRemoveHistory={handleRemoveHistory} onSearch={doSearch} onTogglePlay={handleTogglePlay} playingId={playingId} searchElapsed={searchElapsed} searchError={searchError} searchHistory={searchHistory} searchLoading={searchLoading} searchQuery={searchQuery} searchResults={searchResults} searchType={searchType} setSearchQuery={setSearchQuery} setSearchResults={setSearchResults} setSearchType={handleSetSearchType} setShowHistory={setShowHistory} showHistory={showHistory} />}
      {tab === 'settings' && <SettingsTab config={runtimeConfig} error={runtimeConfigError} isLoading={runtimeConfigLoading} isRestarting={restartPendingReconnect} onPurgePeerCache={purgePeerCache} onRefresh={refreshRuntimeConfig} onRestart={handleRestart} onSave={updateRuntimeConfig} />}
      {tab === 'messages' && <MessagesTab messages={messages} ownAddress={stats?.self.address} peers={peers} sendMessage={handleSendMessage} />}
    </div>
    <ActivityFeed eventLog={eventLog} />
    <StatusBar dhtNodes={dhtNodes} peers={peers} uptime={uptime} wsState={wsState} />
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
