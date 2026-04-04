/* eslint-disable max-lines */
 
import { spawn } from 'child_process'

import type { ApiPeer, NodeStats, PeerStats, Socket, StatsVotesPayload } from '../types/hydrabase'
import type { Album, Artist, MessageEnvelope, MetadataPlugin, Request, Response, SearchHistoryEntry, Track } from '../types/hydrabase-schemas'
import type { Repositories } from './db'
import type PeerManager from './PeerManager'

import { warn } from '../utils/log'
import { Trace } from '../utils/trace'
import { UTPClient } from './networking/utp/client'
import WebSocketClient from './networking/ws/client'
import { type ConnectPeer, HIP2_Messaging, type MessagePacket, type Ping, type Pong, type SendMessage, type UpdateConfig } from './protocol/HIP2_Messaging'
import { type Announce, HIP3_AnnouncePeers } from './protocol/HIP3_AnnouncePeers'
import { RequestManager } from './RequestManager'

export class Peer {
  private static readonly PING_INTERVAL_MS = 60_000
  // Keep timeout comfortably above interval to tolerate network and event-loop jitter.
  private static readonly PING_TIMEOUT_MS = 90_000

  public nonce = 0
  get address() { return this.socket.identity.address }
  get bio() { return this.socket.identity.bio }
  get historicConfidence(): number {
    return this.repos.peer.getHistoricConfidence(this.address, this.ownPlugins)
  }
  get hostname() { return this.socket.identity.hostname }
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

  get totalDL() { return this._dl }
  get totalUL() { return this._ul }

  get type() {
    return this.socket instanceof UTPClient ? 'UTP' : this.socket instanceof WebSocketClient ? 'CLIENT' : 'SERVER'
  }

  get uptimeMs() {
    return this.startTime ? Number(new Date()) - this.startTime : 0
  }

  get userAgent() { return this.socket.identity.userAgent }
  get username() { return this.socket.identity.username }
  // get votes(): Votes {
  //   return {
  //     albums: 0,
  //     artists: 0,
  //     tracks: 0,
  //   }
  // }

  private _dl = 0
  private _ul = 0 
  private consecutivePingTimeouts = 0
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
    get_config: (_data: true, nonce: number, trace: Trace) => {
      if (this.address !== '0x0') return
      this.send({ nonce, runtime_config: this.peers.getRuntimeConfig() }, trace)
    },
    message: (packet: MessagePacket, trace: Trace) => this.peers.handleMessage(packet, this, trace),
    message_history: (_data: 'get', nonce: number, trace: Trace) => {
      if (this.address !== '0x0') return
      this.send({ message_history: this.peers.messageHistory, nonce }, trace)
    },
    peer_stats: (data: { address: `0x${string}` }, nonce: number, trace: Trace) => {
      if (this.address !== '0x0') return
      const peer_stats = this.repos.peer.collectPeerStats(data.address, this.ownPlugins)
      this.send({ nonce, peer_stats }, trace)
    },
    ping: (ping: Ping, nonce: number, trace: Trace) => {
      trace.step(`[HIP2] Received ping ${nonce} from containing ${ping.peers.length} peer hostnames: ${ping.peers.join(', ')}`)
      for (const hostname of ping.peers) {
        this.peers.recordPeerAnnouncedHostname(this.address, hostname)
      }
      this.send({ nonce, pong: { peers: ping.peers ?? [], time: Number(new Date()) } }, trace)
    },
    pong: (_: Pong, nonce: number) => {
      const pendingPing = this.pendingPings.get(nonce)
      if (!pendingPing) {
        warn('DEVWARN:', '[PEER] Unhandled pong')
        return
      }
      clearTimeout(pendingPing.timeout)
      const latency = Number(new Date()) - pendingPing.time
      this.totalLatency += latency
      this.totalPongs++
      this.consecutivePingTimeouts = 0
      pendingPing.trace.step(`[HIP2] Received pong ${nonce} in ${latency}ms`)
      pendingPing.trace.success()
      this.pendingPings.delete(nonce)
    },
    purge_peer_cache: (_data: true, nonce: number, trace: Trace) => {
      if (this.address !== '0x0') return
      this.peers.purgePeerCache()
      this.send({ nonce, peer_cache_purged: true }, trace)
    },

    request: async <T extends Request['type']>(request: Request & { type: T }, nonce: number, trace: Trace) => {
      const results = await this.searchNode(request.type, request.query, this.address === '0x0')
      this.HIP2_Conn_Message.send.response(results, nonce, trace)
      if (this.address === '0x0') this.repos.searchHistory.add(request.query, request.type, results.length)
    },
    response: (response: Response, nonce: number) => { if (!this.requestManager.resolve(nonce, response)) warn('DEVWARN:', `[HIP2] Unexpected response nonce ${nonce} from ${this.socket.identity.address}`)},
    restart: (_data: true, nonce: number, trace: Trace) => {
      if (this.address !== '0x0') return
      trace.step('[PEER] API requested restart')
      this.send({ nonce, restarting: true }, trace)
      setTimeout(() => {
        const child = spawn(process.execPath, process.argv.slice(1), {
          detached: true,
          env: process.env,
          stdio: 'inherit',
        })
        child.unref()
        process.exit(0)
      }, 500)
    },
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
    update_config: (data: UpdateConfig, nonce: number, trace: Trace) => {
      if (this.address !== '0x0') return
      try {
        const runtime_config_updated = this.peers.updateRuntimeConfig(data, this.address)
        this.send({ nonce, runtime_config_updated }, trace)
      } catch (err) {
        this.send({ config_error: err instanceof Error ? err.message : 'Failed to update config', nonce }, trace)
      }
    },
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
        this.consecutivePingTimeouts += 1
        const timeoutThreshold = 2
        if (this.consecutivePingTimeouts < timeoutThreshold) {
          trace.softFail(`[HIP2][TIMEOUT] Pong ${nonce} timed out after ${Peer.PING_TIMEOUT_MS / 1000}s; keeping peer connected (${this.type} transport, hostname: ${this.hostname}, strike ${this.consecutivePingTimeouts}/${timeoutThreshold})`)
          warn('WARN:', `[PEER][TIMEOUT] Missed pong from peer ${this.username} (${this.address}) on ${this.hostname} via ${this.type}; keeping connection (${this.consecutivePingTimeouts}/${timeoutThreshold}).`)
          return
        }

        trace.softFail(`[HIP2][TIMEOUT] Pong ${nonce} timed out after ${Peer.PING_TIMEOUT_MS / 1000}s; disconnecting peer (${this.type} transport, hostname: ${this.hostname}, strikes ${this.consecutivePingTimeouts}/${timeoutThreshold})`)
        warn('WARN:', `[PEER][TIMEOUT] Ping timeout threshold reached for peer ${this.username} (${this.address}) on ${this.hostname} via ${this.type}. Disconnecting.`)
        this.socket.close()
      }, Peer.PING_TIMEOUT_MS)
      this.pendingPings.set(nonce, { time, timeout, trace })
      // Gather all connected peer hostnames except self
      const peers = this.peers.connectedPeers
        .filter(p => p.hostname !== this.hostname)
        .map(p => p.hostname)
      this.send({ nonce, ping: { peers, time } }, trace)
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
    // eslint-disable-next-line max-lines-per-function
    this.socket.onMessage(async message => {
      this._dl += message.length
      this.peers.notifyDataTransfer()
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
      else if (type === 'pong') this.handlers[type](data as Pong, nonce)
      else if (type === 'announce') this.handlers[type](data as Announce)
      else if (type === 'peer_stats') this.handlers[type](data as { address: `0x${string}` }, nonce, trace)
      else if (type === 'request') await this.handlers[type](data as Request, nonce, trace)
      else if (type === 'response') this.handlers[type](data as Response, nonce)
      else if (type === 'search_history') this.handlers[type](data as 'clear' | 'get' | { remove: number }, nonce, trace)
      else if (type === 'message_history') this.handlers[type](data as 'get', nonce, trace)
      else if (type === 'connect_peer') this.handlers[type](data as ConnectPeer, nonce, trace)
      else if (type === 'restart') this.handlers[type](data as true, nonce, trace)
      else if (this.handleRuntimeConfigMessage(type, data, nonce, trace)) {
        // handled by runtime config router
      }
      else if (type === 'send_message') this.handlers[type](data as SendMessage, trace)
      else if (type === 'message') this.handlers[type](data as MessagePacket, trace)
      else warn('DEVWARN:', `[PEER] Unexpected message ${type}`)
      if (!matchedPongTrace) trace.success()
    })
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

  send(payload: ({ announce: Announce } | { config_error: string } | { connect_peer: ConnectPeer } | { connection_error: import('../types/hydrabase').PeerConnectionError } | { log_event: import('../types/hydrabase').LogEvent } | { message: MessagePacket } | { message_history: MessageEnvelope[] } | { peer_cache_purged: true } | { peer_stats: PeerStats } | { ping: Ping } | { pong: Pong } | { refresh_ui: string } | { request: Request } | { response: Response } | { restarting: true } | { runtime_config: import('../types/hydrabase').RuntimeConfigSnapshot } | { runtime_config_updated: import('../types/hydrabase').RuntimeConfigSnapshot } | { search_history: SearchHistoryEntry[] } | { stats: NodeStats } | { stats_dht_node_connected: string } | { stats_dht_nodes: NodeStats['dhtNodes'] } | { stats_peer_connected: ApiPeer } | { stats_peers: NodeStats['peers']['known'] } | { stats_pulse: import('../types/hydrabase').StatsPulseBundle } | { stats_self: NodeStats['self'] } | { stats_votes: StatsVotesPayload }) & { nonce: number }, trace: Trace) {
    const message = JSON.stringify(payload)
    this._ul += message.length
    this.peers.notifyDataTransfer()
    const keys = Object.keys(JSON.parse(message))
    trace.step(`[PEER] [${this.type}] Sending ${keys.join(',')} to ${this.username} ${this.address} ${this.hostname}`)
    this.socket.send(message)
  }

  public readonly sendConnectionError = (error: import('../types/hydrabase').PeerConnectionError, nonce: number, trace: Trace) => this.send({ connection_error: error, nonce }, trace)

  public readonly sendLogEvent = (log_event: import('../types/hydrabase').LogEvent, trace: Trace) => this.send({ log_event, nonce: this.nonce++ }, trace)
  public readonly sendMessagePacket = (packet: MessagePacket, trace: Trace) => this.send({ message: packet, nonce: this.nonce++ }, trace)
  public readonly sendRefreshUi = (trace: Trace) => this.send({ nonce: this.nonce++, refresh_ui: 'backend_changed' }, trace)
  public readonly sendStatsDhtNodeConnected = (stats_dht_node_connected: string, trace: Trace) => this.send({ nonce: this.nonce++, stats_dht_node_connected }, trace)
  public readonly sendStatsDhtNodes = (stats_dht_nodes: NodeStats['dhtNodes'], trace: Trace) => this.send({ nonce: this.nonce++, stats_dht_nodes }, trace)
  public readonly sendStatsPeerConnected = (stats_peer_connected: ApiPeer, trace: Trace) => this.send({ nonce: this.nonce++, stats_peer_connected }, trace)
  public readonly sendStatsPeers = (stats_peers: NodeStats['peers']['known'], trace: Trace) => this.send({ nonce: this.nonce++, stats_peers }, trace)
  public readonly sendStatsPulseBundle = (bundle: import('../types/hydrabase').StatsPulseBundle, trace: Trace) => this.send({ nonce: this.nonce++, stats_pulse: bundle }, trace)
  public readonly sendStatsSelf = (stats_self: NodeStats['self'], trace: Trace) => this.send({ nonce: this.nonce++, stats_self }, trace)
  public readonly sendStatsVotes = (stats_votes: StatsVotesPayload, trace: Trace) => this.send({ nonce: this.nonce++, stats_votes }, trace)
  private handleRuntimeConfigMessage(type: string, data: unknown, nonce: number, trace: Trace): boolean {
    if (type === 'get_config') {
      this.handlers[type](data as true, nonce, trace)
      return true
    }
    if (type === 'update_config') {
      this.handlers[type](data as UpdateConfig, nonce, trace)
      return true
    }
    if (type === 'purge_peer_cache') {
      this.handlers[type](data as true, nonce, trace)
      return true
    }
    return false
  }
}
