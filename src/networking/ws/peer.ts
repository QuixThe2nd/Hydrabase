import { RequestManager, type Album, type Artist, type Request, type Response, type Track } from "../../RequestManager";
import { HIP4_Conn_Announce, type Announce } from "../../protocol/HIP4/announce";
import { Crypto } from "../../Crypto";
import WebSocketClient from "./client";
import type { WebSocketServerConnection } from "./server";
import type { DB, Repositories } from "../../db";
import type { MetadataPlugin } from "../../Metadata";
import { HIP2_Conn_Message } from "../../protocol/HIP2/message";
import type Peers from "../../Peers";
import type Node from "../../Node";
import { sql } from 'drizzle-orm'
import { Parser } from 'expr-eval'
import { CONFIG } from "../../config";
import type { NodeStats } from "../../StatsReporter";

const avg = (numbers: number[]) => numbers.reduce((a, b) => a + b, 0) / numbers.length

type PluginAccuracy = { plugin_id: string; match: number; mismatch: number }

export class Peer {
  private readonly requestManager: RequestManager
  private readonly HIP2_Conn_Message: HIP2_Conn_Message
  private readonly HIP4_Conn_Announce: HIP4_Conn_Announce
  private startTime?: number
  private _rx = 0
  private _tx = 0

  constructor(private readonly node: Node, private readonly socket: WebSocketClient | WebSocketServerConnection, addPeer: (peer: WebSocketClient) => void, crypto: Crypto, onClose: () => void, peers: Peers, private readonly repos: Repositories, private readonly db: DB, public readonly plugins: MetadataPlugin[]) {
    this.requestManager = new RequestManager()
    this.HIP2_Conn_Message = new HIP2_Conn_Message(this, this.requestManager)
    this.HIP4_Conn_Announce = new HIP4_Conn_Announce(crypto, this, addPeer, peers)
    // console.log('LOG:', `Creating peer ${socket.address} as ${socket instanceof WebSocketClient ? 'client' : 'server'}`)
    this.socket.onOpen(() => {
      this.startTime = +new Date()
    })
    this.socket.onClose(() => {
      this.requestManager.close()
      onClose()
    })
    this.socket.onMessage(async message => {
      this._rx += message.length
      const result = this.HIP2_Conn_Message.parseMessage(message)
      if (!result) return
      const { type, data, nonce } = result
      await this.handlers[type](data, nonce)
    })
  }

  get isOpened() {
    return this.socket.isOpened
  }

  get address() {
    return this.socket.address
  }

  get hostname() {
    return this.socket.hostname
  }

  get uptimeMs() {
    return this.startTime ? +new Date() - this.startTime : 0
  }

  get rxTotal() {
    return this._rx
  }

  get txTotal() {
    return this._tx
  }

  public readonly announcePeer = (announce: Announce) => this.HIP4_Conn_Announce.sendAnnounce(announce)

  private readonly handlers = {
    request: async <T extends Request['type']>(request: Request & { type: T }, nonce: number) => this.HIP2_Conn_Message.send.response(await this.node.search(request.type, request.query, false) as Response<T>, nonce),
    response: (response: Response, nonce: number) => { if (!this.requestManager.resolve(nonce, response)) console.warn('WARN:', `Unexpected response nonce ${nonce} from ${this.socket.address}`) },
    announce: (announce: Announce) => this.HIP4_Conn_Announce.handleAnnounce(announce)
  }

  public async search<T extends Request['type']>(type: T, query: string): Promise<Response<T>> {
    const response = await this.HIP2_Conn_Message.send.request({ type, query })
    for (const result of response) {
      if (type === 'track') this.repos.track.upsertFromPeer(result as Track, this.socket.address)
      else if (type === 'album') this.repos.album.upsertFromPeer(result as Album, this.socket.address)
      else if (type === 'artist') this.repos.artist.upsertFromPeer(result as Artist, this.socket.address)
    }
    return response;
  }

  get historicConfidence(): number {
    return getHistoricPeerConfidence(this.db, this.address, this.plugins)
  }

  get averageLatencyMs(): number {
    return this.requestManager.averageLatencyMs
  }

  public readonly sendStats = (stats: NodeStats) => this.send(JSON.stringify({ stats }))

  send(message: string) {
    if (!this.socket.isOpened) {
      console.warn('WARN:', `[PEER] Cannot send request to unconnected peer ${this.socket.address}`)
      return []
    }
    this._tx += message.length
    this.socket.send(message)
  }
}

function getHistoricPeerConfidence(db: DB, address: `0x${string}`, installedPlugins: MetadataPlugin[]): number {
  const queryTable = (table: 'tracks' | 'artists' | 'albums') => db.all<PluginAccuracy>(sql`
    SELECT peer.plugin_id, COUNT(local.id) AS match, COUNT(*) - COUNT(local.id) AS mismatch
    FROM ${sql.raw(table)} peer
    LEFT JOIN ${sql.raw(table)} local
      ON local.id = peer.id AND local.plugin_id = peer.plugin_id AND local.address = '0x0'
    WHERE peer.address = ${address}
    GROUP BY peer.plugin_id
  `)

  const rows = [...queryTable('tracks'), ...queryTable('artists'), ...queryTable('albums')]

  const merged: Record<string, { match: number; mismatch: number }> = {}
  for (const { plugin_id, match, mismatch } of rows) {
    if (!merged[plugin_id]) merged[plugin_id] = { match: 0, mismatch: 0 }
    merged[plugin_id]!.match += match
    merged[plugin_id]!.mismatch += mismatch
  }

  const installedPluginIds = new Set(installedPlugins.map(plugin => plugin.id))
  const scores = Object.entries(merged)
    .filter(([pluginId]) => installedPluginIds.has(pluginId))
    .map(([, { match, mismatch }]) => Parser.evaluate(CONFIG.pluginConfidence, { x: match, y: mismatch }))

  return scores.length > 0 ? avg(scores) : 0
}
