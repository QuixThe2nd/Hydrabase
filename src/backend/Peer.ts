import type { ApiPeer, NodeStats, PeerStats, Socket, StatsPulsePayload, StatsVotesPayload } from '../types/hydrabase'
import type { Album, Artist, MessageEnvelope, MetadataPlugin, Request, Response, SearchHistoryEntry, Track } from '../types/hydrabase-schemas'
import type { Repositories } from './db'
import type PeerManager from './PeerManager'

import { warn } from '../utils/log'
import { Trace } from '../utils/trace'
import { UDP_Client } from './networking/udp/client'
import WebSocketClient from './networking/ws/client'
import { type ConnectPeer, HIP2_Messaging, type Ping, type SendMessage } from './protocol/HIP2_Messaging'
import { type Announce, HIP3_AnnouncePeers } from './protocol/HIP3_AnnouncePeers'
import { RequestManager } from './RequestManager'

export class Peer {
  private static readonly PING_INTERVAL_MS = 60_000
  // Keep timeout comfortably above interval to tolerate network and event-loop jitter.
  private static readonly PING_TIMEOUT_MS = 90_000

  public nonce = 0
  get address() {
    return this.socket.identity.address
  }
  get bio() {
    return this.socket.identity.bio
  }
  get historicConfidence(): number {
    return this.repos.peer.getHistoricConfidence(this.address, this.ownPlugins)
  }
  get hostname() {
    return this.socket.identity.hostname
  }
  get latency(): number {
    return this.totalLatency/this.totalPongs
  }
  get lifetimeDL(): number {
    return this.repos.peer.getLifetimeStats(this.address).lifetimeDL
  }
  get lifetimeUL(): number {
    return this.repos.peer.getLifetimeStats(this.address).lifetimeUL
  }
  get lookupTime(): number {
    return this.requestManager.averageLatencyMs
  }
  get plugins(): string[] {
    return this.repos.peer.getPlugins(this.address)
  }

  get totalDL() {
    return this._dl
  }

  get totalUL() {
    return this._ul
  }

  get type() {
    return this.socket instanceof UDP_Client ? 'UDP' : this.socket instanceof WebSocketClient ? 'CLIENT' : 'SERVER'
  }

  get uptimeMs() {
    return this.startTime ? Number(new Date()) - this.startTime : 0
  }

  get userAgent() {
    return this.socket.identity.userAgent
  }

  get username() {
    return this.socket.identity.username
  }
  // get votes(): Votes {
  //   return {
  //     albums: 0,
  //     artists: 0,
  //     tracks: 0,
  //   }
  // }

  private _dl = 0
  private _ul = 0 
  private readonly HIP2_Conn_Message: HIP2_Messaging
  private readonly HIP4_Conn_Announce: HIP3_AnnouncePeers
    private pendingPings = new Map<number, { time: number; timeout: NodeJS.Timeout; trace: Trace }>()
    private readonly requestManager: RequestManager
    private totalLatency = 0
    private totalPongs = 0
  private readonly handlers = {
    announce: (announce: Announce) => this.HIP4_Conn_Announce.handleAnnounce(announce),
    connect_peer: (data: ConnectPeer, nonce: number, trace: Trace) => {
      if (this.address !== '0x0') return
      this.peers.handleConnectPeerRequest(data.hostname, this, nonce, trace)
    },
    deliver_message: (envelope: MessageEnvelope, trace: Trace) => this.peers.handleDeliverMessage(envelope, this, trace),
    message_history: (_data: 'get', nonce: number, trace: Trace) => {
      if (this.address !== '0x0') return
      this.send({ message_history: this.peers.messageHistory, nonce }, trace)
    },
    peer_stats: (data: { address: `0x${string}` }, nonce: number, trace: Trace) => {
      if (this.address !== '0x0') return
      const peer_stats = this.repos.peer.collectPeerStats(data.address, this.ownPlugins)
      this.send({ nonce, peer_stats }, trace)
    },
    ping: (_: Ping, nonce: number, trace: Trace) => {
      this.send({ nonce, pong: { time: Number(new Date()) } }, trace)
    },
    pong: (_: Ping, nonce: number) => {
      const pendingPing = this.pendingPings.get(nonce)
      if (!pendingPing) {
        warn('DEVWARN:', '[PEER] Unhandled pong')
        return
      }
      clearTimeout(pendingPing.timeout)
      const latency = Number(new Date()) - pendingPing.time
      this.totalLatency += latency
      this.totalPongs++
      pendingPing.trace.step(`[HIP2] Received pong ${nonce} in ${latency}ms`)
      pendingPing.trace.success()
      this.pendingPings.delete(nonce)
    },
    request: async <T extends Request['type']>(request: Request & { type: T }, nonce: number, trace: Trace) => {
      const results = await this.searchNode(request.type, request.query, this.address === '0x0')
      this.HIP2_Conn_Message.send.response(results, nonce, trace)
      if (this.address === '0x0') this.repos.searchHistory.add(request.query, request.type, results.length)
    },
    response: (response: Response, nonce: number) => { if (!this.requestManager.resolve(nonce, response)) warn('DEVWARN:', `[HIP2] Unexpected response nonce ${nonce} from ${this.socket.identity.address}`)},
    search_history: (data: 'clear' | 'get' | { remove: number }, nonce: number, trace: Trace) => {
      if (this.address !== '0x0') return
      if (data === 'get') {
        this.send({ nonce, search_history: this.repos.searchHistory.getAll() }, trace)
      } else if (data === 'clear') {
        this.repos.searchHistory.clear()
        this.send({ nonce, search_history: [] }, trace)
      } else if (typeof data === 'object' && 'remove' in data) {
        this.repos.searchHistory.remove(data.remove)
        this.send({ nonce, search_history: this.repos.searchHistory.getAll() }, trace)
      }
    },
    send_message: (data: SendMessage, trace: Trace) => {
      if (this.address !== '0x0') return
      this.peers.createAndSendMessage(data.to, data.payload, trace)
    },
    store_message: (envelope: MessageEnvelope, trace: Trace) => this.peers.handleStoreMessage(envelope, this, trace)
  }
  private lastSavedDL = 0
  private lastSavedUL = 0

  private startTime?: number

  // eslint-disable-next-line max-lines-per-function
  constructor(
    public readonly socket: Socket,
    private readonly peers: PeerManager,
    private readonly repos: Repositories,
    private readonly ownPlugins: MetadataPlugin[],
    private readonly searchNode: <T extends Request['type']>(type: T, query: string, searchPeers: boolean) => Promise<Response<T>>
  ) {
    this.requestManager = new RequestManager()
    this.HIP2_Conn_Message = new HIP2_Messaging(this, this.requestManager)
    this.HIP4_Conn_Announce = new HIP3_AnnouncePeers(this, this.peers)
    this.startTime = Number(new Date())
    
    // Periodically save session stats to lifetime stats (every 30 seconds)
    const statsSaveInterval = setInterval(() => {
      const ulDelta = this._ul - this.lastSavedUL
      const dlDelta = this._dl - this.lastSavedDL
      if (ulDelta > 0 || dlDelta > 0) {
        this.repos.peer.accumulateSessionStats(this.address, ulDelta, dlDelta)
        this.lastSavedUL = this._ul
        this.lastSavedDL = this._dl
      }
    }, 30_000)
    
    const id = setInterval(() => {
      if (this.pendingPings.size > 0) {
        const trace = Trace.start(`Pinging ${socket.identity.hostname}`)
        trace.step('[HIP2] Skipping ping while previous ping is still pending')
        trace.success()
        return
      }
      const nonce = this.nonce++
      const time = Number(new Date())
      const trace = Trace.start(`Pinging ${socket.identity.hostname}`)
      const timeout = setTimeout(() => {
        if (!this.pendingPings.has(nonce)) return
        this.pendingPings.delete(nonce)
        trace.softFail(`[HIP2] Pong ${nonce} timed out after ${Peer.PING_TIMEOUT_MS / 1000}s; disconnecting peer`)
        this.socket.close()
      }, Peer.PING_TIMEOUT_MS)
      this.pendingPings.set(nonce, { time, timeout, trace })
      this.send({ nonce, ping: { time } }, trace)
      trace.step(`[HIP2] Waiting for pong ${nonce}`)
    }, Peer.PING_INTERVAL_MS)
    this.socket.onClose(() => {
      this.requestManager.close()
      if (id) clearInterval(id)
      if (statsSaveInterval) clearInterval(statsSaveInterval)
      // Final save on disconnect
      const ulDelta = this._ul - this.lastSavedUL
      const dlDelta = this._dl - this.lastSavedDL
      if (ulDelta > 0 || dlDelta > 0) {
        this.repos.peer.accumulateSessionStats(this.address, ulDelta, dlDelta)
      }
      for (const ping of this.pendingPings.values()) {
        clearTimeout(ping.timeout)
        ping.trace.softFail('Peer disconnected before pong')
      }
      this.pendingPings.clear()
    })
    this.socket.onMessage(async message => {
      this._dl += message.length
      let parsedMessage: unknown
      try {
        parsedMessage = JSON.parse(message)
      } catch {
        const trace = Trace.start(`Received message from ${socket.identity.hostname}`)
        trace.fail('Failed to parse message')
        return
      }

      const parsedRecord = typeof parsedMessage === 'object' && parsedMessage && !Array.isArray(parsedMessage) ? parsedMessage as Record<string, unknown> : null
      if (!parsedRecord) {
        const trace = Trace.start(`Received message from ${socket.identity.hostname}`)
        trace.fail('Failed to parse message')
        return
      }

      const { nonce: parsedNonce, ...candidatePayload } = parsedRecord
      const matchedPongTrace = HIP2_Messaging.identifyType(candidatePayload) === 'pong' && typeof parsedNonce === 'number' && this.pendingPings.has(parsedNonce)
      const trace = matchedPongTrace ? this.pendingPings.get(parsedNonce)?.trace ?? Trace.start(`Received message from ${socket.identity.hostname}`) : Trace.start(`Received message from ${socket.identity.hostname}`)
      const result = this.HIP2_Conn_Message.parseMessage(message, trace)
      if (!result) {
        if (matchedPongTrace && typeof parsedNonce === 'number') {
          const pendingPing = this.pendingPings.get(parsedNonce)
          if (pendingPing) clearTimeout(pendingPing.timeout)
          this.pendingPings.delete(parsedNonce)
        }
        trace.fail('Failed to parse message')
        return
      }
      const { data, nonce, type } = result
      if (type === 'ping') this.handlers[type](data as Ping, nonce, trace)
      else if (type === 'pong') this.handlers[type](data as Ping, nonce)
      else if (type === 'announce') this.handlers[type](data as Announce)
      else if (type === 'peer_stats') this.handlers[type](data as { address: `0x${string}` }, nonce, trace)
      else if (type === 'request') await this.handlers[type](data as Request, nonce, trace)
      else if (type === 'response') this.handlers[type](data as Response, nonce)
      else if (type === 'search_history') this.handlers[type](data as 'clear' | 'get' | { remove: number }, nonce, trace)
      else if (type === 'message_history') this.handlers[type](data as 'get', nonce, trace)
      else if (type === 'connect_peer') this.handlers[type](data as ConnectPeer, nonce, trace)
      else if (type === 'send_message') this.handlers[type](data as SendMessage, trace)
      else if (type === 'store_message') this.handlers[type](data as MessageEnvelope, trace)
      else if (type === 'deliver_message') this.handlers[type](data as MessageEnvelope, trace)
      else warn('DEVWARN:', `[PEER] Unexpected message ${type}`)
      if (!matchedPongTrace) trace.success()
    })
  }

  public readonly announcePeer = (peer: Announce | Peer, trace: Trace) => {
    const announce = typeof peer === 'object' && 'hostname' in peer && 'address' in peer ? { hostname: peer.hostname } : peer as Announce
    this.HIP4_Conn_Announce.sendAnnounce(announce, trace)
  }

  public async search<T extends Request['type']>(type: T, query: string, trace: Trace): Promise<Response<T>> {
    const response = await this.HIP2_Conn_Message.send.request({ query, type }, trace)
    for (const result of response) {
      if (type === 'tracks' || type === 'artist.tracks' || type === 'album.tracks') this.repos.track.upsertFromPeer(result as Track, this.socket.identity.address)
      else if (type === 'albums' || type === 'artist.albums') this.repos.album.upsertFromPeer(result as Album, this.socket.identity.address)
      else if (type === 'artists') this.repos.artist.upsertFromPeer(result as Artist, this.socket.identity.address)
    }
    return response
  }

  send(payload: ({ announce: Announce } | { connect_peer: ConnectPeer } | { connection_error: import('../types/hydrabase').PeerConnectionError } | { deliver_message: MessageEnvelope } | { log_event: import('../types/hydrabase').LogEvent } | { message_history: MessageEnvelope[] } | { peer_stats: PeerStats } | { ping: Ping } | { pong: Ping } | { refresh_ui: string } | { request: Request } | { response: Response } | { search_history: SearchHistoryEntry[] } | { stats: NodeStats } | { stats_dht_node_connected: string } | { stats_dht_nodes: NodeStats['dhtNodes'] } | { stats_peer_connected: ApiPeer } | { stats_peers: NodeStats['peers']['known'] } | { stats_pulse: StatsPulsePayload } | { stats_self: NodeStats['self'] } | { stats_timestamp: NodeStats['timestamp'] } | { stats_votes: StatsVotesPayload } | { store_message: MessageEnvelope }) & { nonce: number }, trace: Trace) {
    const message = JSON.stringify(payload)
    this._ul += message.length
    const keys = Object.keys(JSON.parse(message))
    trace.step(`[PEER] [${this.type}] Sending ${keys.join(',')} to ${this.username} ${this.address} ${this.hostname}`)
    this.socket.send(message)
  }

  public readonly sendConnectionError = (error: import('../types/hydrabase').PeerConnectionError, nonce: number, trace: Trace) => this.send({ connection_error: error, nonce }, trace)
  public readonly sendDeliverMessage = (message: MessageEnvelope, trace: Trace) => this.send({ deliver_message: message, nonce: this.nonce++ }, trace)
  public readonly sendLogEvent = (log_event: import('../types/hydrabase').LogEvent, trace: Trace) => this.send({ log_event, nonce: this.nonce++ }, trace)
  public readonly sendRefreshUi = (trace: Trace) => this.send({ nonce: this.nonce++, refresh_ui: 'backend_changed' }, trace)
  public readonly sendStats = (stats: NodeStats, trace: Trace) => this.send({ nonce: this.nonce++, stats }, trace)
  public readonly sendStatsDhtNodeConnected = (stats_dht_node_connected: string, trace: Trace) => this.send({ nonce: this.nonce++, stats_dht_node_connected }, trace)
  public readonly sendStatsDhtNodes = (stats_dht_nodes: NodeStats['dhtNodes'], trace: Trace) => this.send({ nonce: this.nonce++, stats_dht_nodes }, trace)
  public readonly sendStatsPeerConnected = (stats_peer_connected: ApiPeer, trace: Trace) => this.send({ nonce: this.nonce++, stats_peer_connected }, trace)
  public readonly sendStatsPeers = (stats_peers: NodeStats['peers']['known'], trace: Trace) => this.send({ nonce: this.nonce++, stats_peers }, trace)
  public readonly sendStatsPulse = (stats_pulse: StatsPulsePayload, trace: Trace) => this.send({ nonce: this.nonce++, stats_pulse }, trace)
  public readonly sendStatsSelf = (stats_self: NodeStats['self'], trace: Trace) => this.send({ nonce: this.nonce++, stats_self }, trace)
  public readonly sendStatsTimestamp = (stats_timestamp: NodeStats['timestamp'], trace: Trace) => this.send({ nonce: this.nonce++, stats_timestamp }, trace)
  public readonly sendStatsVotes = (stats_votes: StatsVotesPayload, trace: Trace) => this.send({ nonce: this.nonce++, stats_votes }, trace)
  public readonly sendStoreMessage = (message: MessageEnvelope, trace: Trace) => this.send({ nonce: this.nonce++, store_message: message }, trace)
}
