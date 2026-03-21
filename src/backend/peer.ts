import type { NodeStats, PeerStats, Socket } from '../types/hydrabase'
import type { Album, Artist, MetadataPlugin, Request, Response, SearchHistoryEntry, Track } from '../types/hydrabase-schemas'
import type { Repositories } from './db'
import type PeerManager from './PeerManager'

import { stats, warn } from '../utils/log'
import { Trace } from '../utils/trace'
import { UDP_Client } from './networking/udp/client'
import WebSocketClient from './networking/ws/client'
import { HIP2_Messaging, type Ping } from './protocol/HIP2_Messaging'
import { type Announce, HIP3_AnnouncePeers } from './protocol/HIP3_AnnouncePeers'
import { RequestManager } from './RequestManager'

export class Peer {
  public nonce = 0
  get address() {
    return this.socket.identity.address
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
  private lastPing = {
    nonce: -1,
    time: 0,
    trace: undefined as Trace | undefined
  }
  private readonly requestManager: RequestManager
  private totalLatency = 0
  private totalPongs = 0

  private readonly handlers = {
    announce: (announce: Announce) => this.HIP4_Conn_Announce.handleAnnounce(announce),
    peer_stats: (_data: { address: `0x${string}` }, nonce: number, trace: Trace) => {
      if (this.address !== '0x0') return
      const peer_stats = this.repos.peer.collectPeerStats(this.address, this.ownPlugins)
      this.send({ nonce, peer_stats }, trace)
    },
    ping: (_: Ping, nonce: number, trace: Trace) => {
      this.send({ nonce, pong: { time: Number(new Date()) } }, trace)
    },
    pong: (_: Ping, nonce: number) => {
      if (this.lastPing.nonce !== nonce) {
        warn('DEVWARN:', '[PEER] Unhandled pong')
        return
      }
      const latency = Number(new Date()) - this.lastPing.time
      this.totalLatency += latency
      this.totalPongs++
      stats(`[PEER] Current latency ${latency}ms (${Math.ceil(this.latency*10)/10}ms AVG) ${this.username} ${this.address} ${this.hostname}`)
      if (this.lastPing.trace) {
        this.lastPing.trace.success()
      }
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
    }
  }

  private startTime?: number

  constructor(
    public readonly socket: Socket,
    peers: PeerManager,
    private readonly repos: Repositories,
    private readonly ownPlugins: MetadataPlugin[],
    private readonly searchNode: <T extends Request['type']>(type: T, query: string, searchPeers: boolean) => Promise<Response<T>>
  ) {
    this.requestManager = new RequestManager()
    this.HIP2_Conn_Message = new HIP2_Messaging(this, this.requestManager)
    this.HIP4_Conn_Announce = new HIP3_AnnouncePeers(this, peers)
    this.startTime = Number(new Date())
    const id = setInterval(() => {
      const nonce = this.nonce++
      const time = Number(new Date())
      const trace = Trace.start(`Pinging ${socket.identity.hostname}`)
      this.lastPing = { nonce, time, trace }
      this.send({ nonce, ping: { time } }, trace)
    }, 60_000)
    this.socket.onClose(() => {
      this.requestManager.close()
      if (id) clearInterval(id)
    })
    this.socket.onMessage(async message => {
      const trace = Trace.start(`Received message from ${socket.identity.hostname}`)
      this._dl += message.length
      const result = this.HIP2_Conn_Message.parseMessage(message, trace)
      if (!result) {
        trace.fail('Failed to parse message')
        return
      }
      const { data, nonce, type } = result
      if (type === 'ping') this.handlers[type](data as Ping, nonce, trace)
      else if (type === 'pong') this.handlers[type](data as Ping, nonce)
      else if (type === 'announce') this.handlers[type](data as Announce)
      else if (type === 'request') await this.handlers[type](data as Request, nonce, trace)
      else if (type === 'response') this.handlers[type](data as Response, nonce)
      else if (type === 'search_history') this.handlers[type](data as 'clear' | 'get' | { remove: number }, nonce, trace)
      else warn('DEVWARN:', `[PEER] Unexpected message ${type}`)
      trace.success()
    })
  }

  public readonly announcePeer = (announce: Announce, trace: Trace) => this.HIP4_Conn_Announce.sendAnnounce(announce, trace)

  public async search<T extends Request['type']>(type: T, query: string, trace: Trace): Promise<Response<T>> {
    const response = await this.HIP2_Conn_Message.send.request({ query, type }, trace)
    for (const result of response) {
      if (type === 'tracks' || type === 'artist.tracks' || type === 'album.tracks') this.repos.track.upsertFromPeer(result as Track, this.socket.identity.address)
      else if (type === 'albums' || type === 'artist.albums') this.repos.album.upsertFromPeer(result as Album, this.socket.identity.address)
      else if (type === 'artists') this.repos.artist.upsertFromPeer(result as Artist, this.socket.identity.address)
    }
    return response
  }

  send<T extends Request['type']>(payload: ({ announce: Announce } | { peer_stats: PeerStats } | { ping: Ping } | { pong: Ping } | { request: Request & { type: T } } | { response: Response<T> } | { search_history: SearchHistoryEntry[] } | { stats: NodeStats }) & { nonce: number }, trace: Trace) {
    const message = JSON.stringify(payload)
    this._ul += message.length
    const keys = Object.keys(JSON.parse(message))
    trace.step(`[PEER] [${this.type}] Sending ${keys.join(',')} to ${this.username} ${this.address} ${this.hostname}`)
    this.socket.send(message)
  }

  public readonly sendStats = (stats: NodeStats, trace: Trace) => this.send({ nonce: this.nonce++, stats }, trace)
}
