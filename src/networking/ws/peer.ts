import { sql } from 'drizzle-orm'
import { Parser } from 'expr-eval'

import type { Account } from '../../Crypto/Account';
import type { DB, Repositories } from "../../db";
import type { MetadataPlugin } from "../../Metadata";
import type Node from "../../Node";
import type Peers from "../../Peers";
import type { NodeStats } from "../../StatsReporter";
import type { WebSocketServerConnection } from "./server";

import { CONFIG } from "../../config";
import { warn } from "../../log";
import { HIP2_Conn_Message } from "../../protocol/HIP2/message";
import { type Announce, HIP4_Conn_Announce } from "../../protocol/HIP4/announce";
import { type Album, type Artist, type Request, RequestManager, type Response, type Track } from "../../RequestManager";
import WebSocketClient from "./client";

export interface PeerStats {
  peerPlugins: string[]
  sharedPlugins: string[]
  totalMatches: number
  totalMismatches: number
  votes: { albums: number; artists: number; tracks: number }
}

const countRow = (db: DB, table: 'albums' | 'artists' | 'tracks', address: `0x${string}`) => db.all<{ n: number }>(sql.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE address = '${address}'`))[0]?.n ?? 0

const collectPeerStats = (db: DB, address: `0x${string}`, installedPlugins: MetadataPlugin[]): PeerStats => {
  const installedPluginIds = new Set(installedPlugins.map(p => p.id))
  const peerPlugins = db.all<{ plugin_id: string }>(sql.raw(`SELECT DISTINCT plugin_id FROM tracks WHERE address = '${address}'
    UNION SELECT DISTINCT plugin_id FROM artists WHERE address = '${address}'
    UNION SELECT DISTINCT plugin_id FROM albums WHERE address = '${address}'`)).map(r => r.plugin_id)
  let totalMatches = 0
  let totalMismatches = 0
  for (const table of ['tracks', 'artists', 'albums'] as const) {
    for (const { match, mismatch, plugin_id } of db.all<{ match: number; mismatch: number; plugin_id: string }>(sql.raw(`SELECT peer.plugin_id, COUNT(local.id) AS match, COUNT(*) - COUNT(local.id) AS mismatch FROM ${table} peer
      LEFT JOIN ${table} local ON local.id = peer.id AND local.plugin_id = peer.plugin_id AND local.address = '0x0'
      WHERE peer.address = '${address}' GROUP BY peer.plugin_id`))) {
      if (installedPluginIds.has(plugin_id)) continue
      totalMatches += match
      totalMismatches += mismatch
    }
  }
  return {
    peerPlugins,
    sharedPlugins: peerPlugins.filter(pl => installedPluginIds.has(pl)),
    totalMatches,
    totalMismatches,
    votes: {
      albums:  countRow(db, 'albums', address),
      artists: countRow(db, 'artists', address),
      tracks:  countRow(db, 'tracks', address),
    }
  }
}

const avg = (numbers: number[]) => numbers.reduce((a, b) => a + b, 0) / numbers.length

interface PluginAccuracy { match: number; mismatch: number; plugin_id: string; }

const queryTable = (table: 'albums' | 'artists' | 'tracks', db: DB, address: `0x${string}`) => db.all<PluginAccuracy>(sql`
  SELECT peer.plugin_id, COUNT(local.id) AS match, COUNT(*) - COUNT(local.id) AS mismatch
  FROM ${sql.raw(table)} peer
  LEFT JOIN ${sql.raw(table)} local
    ON local.id = peer.id AND local.plugin_id = peer.plugin_id AND local.address = '0x0'
  WHERE peer.address = ${address}
  GROUP BY peer.plugin_id
`)

const getHistoricPeerConfidence = (db: DB, address: `0x${string}`, installedPlugins: MetadataPlugin[]): number => {
  const rows = [...queryTable('tracks', db, address), ...queryTable('artists', db, address), ...queryTable('albums', db, address)]

  const merged: Record<string, { match: number; mismatch: number }> = {}
  for (const { match, mismatch, plugin_id } of rows) {
    if (!merged[plugin_id]) {merged[plugin_id] = { match: 0, mismatch: 0 }}
    merged[plugin_id].match += match
    merged[plugin_id].mismatch += mismatch
  }

  const installedPluginIds = new Set(installedPlugins.map(plugin => plugin.id))
  const scores = Object.entries(merged)
    .filter(([pluginId]) => installedPluginIds.has(pluginId))
    .map(([, { match, mismatch }]) => Parser.evaluate(CONFIG.pluginConfidence, { x: match, y: mismatch }))

  return scores.length > 0 ? avg(scores) : 0
}

export class Peer {
  get address() {
    return this.socket.peer.address
  }
  get averageLatencyMs(): number {
    return this.requestManager.averageLatencyMs
  }
  get historicConfidence(): number {
    return getHistoricPeerConfidence(this.db, this.address, this.plugins)
  }
  get hostname() {
    return this.socket.peer.hostname
  }
  get isOpened() {
    return this.socket.isOpened
  }
  get rxTotal() {
    return this._rx
  }

  get txTotal() {
    return this._tx
  }

  get uptimeMs() {
    return this.startTime ? Number(new Date()) - this.startTime : 0
  }

  private _rx = 0

  private _tx = 0

  private readonly HIP2_Conn_Message: HIP2_Conn_Message

  private readonly HIP4_Conn_Announce: HIP4_Conn_Announce

  private readonly requestManager: RequestManager

  private readonly handlers = {
    announce: (announce: Announce) => this.HIP4_Conn_Announce.handleAnnounce(announce),
    peer_stats: (_data: { address: `0x${string}` }, nonce: number) => {
      if (this.address !== '0x0') return
      const stats = collectPeerStats(this.db, _data.address, this.plugins)
      this.send(JSON.stringify({ nonce, peer_stats_response: stats }))
    },
    request: async <T extends Request['type']>(request: Request & { type: T }, nonce: number) => this.HIP2_Conn_Message.send.response(await this.node.search(request.type, request.query, this.address === '0x0') as Response<T>, nonce),
    response: (response: Response, nonce: number) => { if (!this.requestManager.resolve(nonce, response)) {warn('DEVWARN:', `[HIP2] Unexpected response nonce ${nonce} from ${this.socket.peer.address}`)} }
  }

  private startTime?: number

  constructor(private readonly node: Node, private readonly socket: WebSocketClient | WebSocketServerConnection, account: Account, peers: Peers, private readonly repos: Repositories, private readonly db: DB, public readonly plugins: MetadataPlugin[]) {
    this.requestManager = new RequestManager()
    this.HIP2_Conn_Message = new HIP2_Conn_Message(this, this.requestManager)
    this.HIP4_Conn_Announce = new HIP4_Conn_Announce(account, this, peers)
    // Log('LOG:', `Creating peer ${socket.address} as ${socket instanceof WebSocketClient ? 'client' : 'server'}`)
    this.socket.onOpen(() => {
      this.startTime = Number(new Date())
    })
    this.socket.onClose(() => {
      this.requestManager.close()
    })
    this.socket.onMessage(async message => {
      this._rx += message.length
      const result = this.HIP2_Conn_Message.parseMessage(message)
      if (!result) return
      const { data, nonce, type } = result
      await this.handlers[type](data, nonce)
    })
  }

  public readonly announcePeer = (announce: Announce) => this.HIP4_Conn_Announce.sendAnnounce(announce, this.address)

  public async search<T extends Request['type']>(type: T, query: string): Promise<Response<T>> {
    const response = await this.HIP2_Conn_Message.send.request({ query, type })
    for (const result of response) {
      if (type === 'track') {this.repos.track.upsertFromPeer(result as Track, this.socket.peer.address)}
      else if (type === 'album') {this.repos.album.upsertFromPeer(result as Album, this.socket.peer.address)}
      else if (type === 'artist') {this.repos.artist.upsertFromPeer(result as Artist, this.socket.peer.address)}
    }
    return response;
  }

  send(message: string) {
    if (!this.socket.isOpened) {
      warn('DEVWARN:', `[PEER] Cannot send request to unconnected peer ${this.socket.peer.address}`)
      return
    }
    this._tx += message.length
    this.socket.send(message)
  }

  public readonly sendStats = (stats: NodeStats) => this.send(JSON.stringify({ stats }))
}
