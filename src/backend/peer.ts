import type { NodeStats, PeerStats, Socket } from '../types/hydrabase';
import type { Album, Artist, MetadataPlugin, Request, Response, Track } from '../types/hydrabase-schemas';
import type { Repositories } from "./db";
import type PeerManager from "./PeerManager";

import { debug, stats, warn } from '../utils/log';
import { UDP_Client } from './networking/udp/client';
import WebSocketClient from './networking/ws/client';
import { HIP2_Conn_Message, type Ping } from "./protocol/HIP2/message";
import { type Announce, HIP3_Conn_Announce } from "./protocol/HIP3/announce";
import { RequestManager } from './RequestManager';

export class Peer {
  public nonce = 0
  get address() {
    return this.socket.peer.address
  }
  get historicConfidence(): number {
    return this.repos.peer.getHistoricConfidence(this.address, this.ownPlugins)
  }
  get hostname() {
    return this.socket.peer.hostname
  }
  get isOpened() {
    return this.socket.isOpened
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
    return this.socket.peer.userAgent
  }

  get username() {
    return this.socket.peer.username
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
  private readonly HIP2_Conn_Message: HIP2_Conn_Message
  private readonly HIP4_Conn_Announce: HIP3_Conn_Announce
  private lastPing = {
    nonce: -1,
    time: 0
  }
  private readonly requestManager: RequestManager
  private totalLatency = 0
  private totalPongs = 0

  private readonly handlers = {
    announce: (announce: Announce) => this.HIP4_Conn_Announce.handleAnnounce(announce),
    peer_stats: (_data: { address: `0x${string}` }, nonce: number) => {
      if (this.address !== '0x0') return
      const peer_stats = this.repos.peer.collectPeerStats(this.address, this.ownPlugins)
      this.send({ nonce, peer_stats })
    },
    ping: (_: Ping, nonce: number) => {
      this.send({ nonce, pong: { time: Number(new Date()) } })
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
    },
    request: async <T extends Request['type']>(request: Request & { type: T }, nonce: number) => this.HIP2_Conn_Message.send.response(await this.searchNode(request.type, request.query, this.address === '0x0'), nonce),
    response: (response: Response, nonce: number) => { if (!this.requestManager.resolve(nonce, response)) warn('DEVWARN:', `[HIP2] Unexpected response nonce ${nonce} from ${this.socket.peer.address}`)}
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
    this.HIP2_Conn_Message = new HIP2_Conn_Message(this, this.requestManager)
    this.HIP4_Conn_Announce = new HIP3_Conn_Announce(this, peers)
    // Log(`Creating peer ${socket.address} as ${socket instanceof WebSocketClient ? 'client' : 'server'}`)
    let id: NodeJS.Timeout | undefined
    this.socket.onOpen(() => {
      this.startTime = Number(new Date())
      id = setInterval(() => {
        const nonce = this.nonce++
        const time = Number(new Date())
        this.lastPing = { nonce, time }
        this.send({ nonce, ping: { time } })
      }, 60_000)
    })
    this.socket.onClose(() => {
      this.requestManager.close()
      if (id) clearInterval(id)
    })
    this.socket.onMessage(async message => {
      this._dl += message.length
      const result = this.HIP2_Conn_Message.parseMessage(message)
      if (!result) return
      const { data, nonce, type } = result
      if (type === 'ping') this.handlers[type](data as Ping, nonce)
      else if (type === 'pong') this.handlers[type](data as Ping, nonce)
      else if (type === 'announce') this.handlers[type](data as Announce)
      else if (type === 'request') await this.handlers[type](data as Request, nonce)
      else if (type === 'response') this.handlers[type](data as Response, nonce)
      else warn('DEVWARN:', `[PEER] Unexpected message ${type}`)
    })
  }

  public readonly announcePeer = (announce: Announce) => this.HIP4_Conn_Announce.sendAnnounce(announce)

  public async search<T extends Request['type']>(type: T, query: string): Promise<Response<T>> {
    const response = await this.HIP2_Conn_Message.send.request({ query, type })
    for (const result of response) {
      if (type === 'tracks' || type === 'artist.tracks' || type === 'album.tracks') this.repos.track.upsertFromPeer(result as Track, this.socket.peer.address)
      else if (type === 'albums' || type === 'artist.albums') this.repos.album.upsertFromPeer(result as Album, this.socket.peer.address)
      else if (type === 'artists') this.repos.artist.upsertFromPeer(result as Artist, this.socket.peer.address)
    }
    return response;
  }

  send<T extends Request['type']>(payload: ({ announce: Announce } | { peer_stats: PeerStats } | { ping: Ping } | { pong: Ping } | { request: Request & { type: T } } | { response: Response<T> } | { stats: NodeStats }) & { nonce: number }) {
    const message = JSON.stringify(payload)
    if (!this.socket.isOpened) {
      warn('DEVWARN:', `[PEER] [${this.type}] Cannot send ${Object.keys(payload).join(',')} to unconnected peer ${this.socket.peer.address}`)
      return
    }
    this._ul += message.length
    const keys = Object.keys(JSON.parse(message))
    debug(`[PEER] [${this.type}] Sending ${keys.join(',')} to ${this.username} ${this.address} ${this.hostname}`)
    this.socket.send(message)
  }

  public readonly sendStats = (stats: NodeStats) => this.send({ nonce: this.nonce++, stats })
}
