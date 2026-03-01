import { Parser } from 'expr-eval'

import type { Account } from './Crypto/Account';
import type { DB, Repositories } from './db'
import type MetadataManager from './Metadata'
import type { SearchResult } from './Metadata'
import type Node from './Node';
import type { Request, Response } from './RequestManager'

import { CONFIG } from './config'
import { error, log, warn } from './log';
import { DHT_Node } from './networking/dht';
import WebSocketClient from "./networking/ws/client";
import { Peer } from "./networking/ws/peer";
import { startServer, type WebSocketServerConnection } from './networking/ws/server'
import { StatsReporter } from './StatsReporter';

const cacheFile = Bun.file('./data/ws-servers.json')

const avg = (numbers: number[]) => numbers.reduce((accumulator, currentValue) => accumulator + currentValue, 0) / numbers.length
const parser = new Parser()
parser.functions.avg = (...args: number[]) => avg(args)

const checkPluginMatches = (peerResults: Response<Request['type']>, confirmedHashes: Set<bigint>) => {
  const pluginMatches: Record<string, { match: number, mismatch: number }> = {}
  for (const _result of peerResults) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { address, confidence, ...result } = _result
    const hash = BigInt(Bun.hash(JSON.stringify(_result)))
    if (!(result.plugin_id in pluginMatches)) {pluginMatches[result.plugin_id] = { match: 0, mismatch: 0 }}
    pluginMatches[result.plugin_id][confirmedHashes.has(hash) ? 'match' : 'mismatch']++
  }
  return pluginMatches
}

const calculatePeerConfidence = (pluginMatches: Record<string, { match: number, mismatch: number }>, installedPlugins: Set<string>) => avg(
  Object.entries(pluginMatches)
    .filter(([pluginId]) => installedPlugins.has(pluginId))
    .map(([, { match, mismatch }]) => Parser.evaluate(CONFIG.pluginConfidence, { x: match, y: mismatch }))
) // 0-1

const saveResults = <T extends Request['type']>(peerResults: Response<T>, peerConfidence: number, results: Map<bigint, Exclude<SearchResult[T], 'confidence'> & { confidences: number[] }>, peer: Peer) => {
  for (const _result of peerResults) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { address, confidence: peerClaimedConfidence, ...result } = _result
    const hash = BigInt(Bun.hash(JSON.stringify(_result)))
    const finalConfidence = parser.evaluate(CONFIG.finalConfidence, { x: peerConfidence, y: peerClaimedConfidence, z: peer.historicConfidence })
    results.set(hash, { ...result as Exclude<SearchResult[T], 'confidence'>, confidences: [...results.get(hash)?.confidences ?? [], finalConfidence] })
  }
  return results
}

const searchPeer = async <T extends Request['type']>(request: Request, peer: Peer, results: Map<bigint, Exclude<SearchResult[T], 'confidence'> & { confidences: number[] }>, installedPlugins: Set<string>, confirmedHashes: Set<bigint>) => {
  const peerResults = await peer.search(request.type, request.query)
  const pluginMatches = checkPluginMatches(peerResults, confirmedHashes)
  const peerConfidence = calculatePeerConfidence(pluginMatches, installedPlugins)
  return saveResults(peerResults, peerConfidence, results, peer)
}

const isPeer = (peer: Peer | undefined, address: `0x${string}`): peer is Peer => peer ? true : warn('DEVWARN:', `[PEERS] Peer not found ${address}`)
const isOpened = (peer: Peer | undefined, address: `0x${string}`): boolean => peer ? true : warn('WARN:', `[PEERS] Skipping peer ${address}: connection not open`)

export default class Peers {
  public get count() { 
    return Object.keys(this.peers).filter(address => address !== '0x0')?.length ?? 0
  }

  get peerAddresses() {
    return this.peers.keys().filter(address => address !== '0x0')
  }
  private readonly peers = new Map<`0x${string}`, Peer>()

  private readonly statsReport: StatsReporter

  constructor(private readonly node: Node, private readonly account: Account, private readonly metadataManager: MetadataManager, private readonly repos: Repositories, private readonly db: DB) {
    startServer(account, this)
    const dht = new DHT_Node(account, this)
    dht.init().catch(err => error('ERROR:', `[DHT] Something went wrong`, {err}))
    this.statsReport = new StatsReporter(account.address, metadataManager.installedPlugins, () => this.peers, db, dht)

    let lastCount = 0
    setInterval(() => {
      if (lastCount === this.count) return
      lastCount = this.count
      log('LOG:', `[PEERS] Connected to ${this.count} peer${this.count === 1 ? '' : 's'}`)
    }, 1_000)
  }

  public add(socket: WebSocketClient | WebSocketServerConnection) {
    socket.onClose(() => () => this.peers.delete(socket.peer.address))
    const peer = new Peer(this.node, socket, this.account, this, this.repos, this.db, this.metadataManager.installedPlugins)
    if (socket.peer.address in this.peers) {
      if (socket.peer.address !== '0x0') {
        warn('DEVWARN:', `[PEERS] Tried to connect to existing peer again via ${socket instanceof WebSocketClient ? 'client' : 'server'} ${socket.peer.address} ${socket.peer.hostname}`)
        socket.close()
      }
      return
    }
    this.peers.set(socket.peer.address, peer)
    cacheFile.write(JSON.stringify(Object.values(this.peers).map(peer => peer.hostname)))
    this.announce(peer)
  }

  public getConfidence(address: `0x${string}`): number {
    const peer = this.peers.get(address)
    if (!peer) return 0
    return peer.historicConfidence
  }

  public readonly has = (address: `0x${string}`) => address in this.peers

  public async init() {
    await this.statsReport.init()

    if (!(await cacheFile.exists())) return
    const hostnames: `ws://${string}`[] = await cacheFile.json()
    for (const hostname of hostnames) {
      if (hostname === 'ws://') continue
      WebSocketClient.init(this, this.account, hostname).then(socket => { if (socket) this.add(socket) })
    }
  }

  public isConnectionOpened(address: `0x${string}`): boolean {
    const peer = this.peers.get(address)
    if (!peer) return false
    return peer.isOpened
  }

  public async requestAll<T extends Request['type']>(request: Request & { type: T }, confirmedHashes: Set<bigint>, installedPlugins: Set<string>) {
    const results = new Map<bigint, Exclude<SearchResult[T], 'confidence'> & { confidences: number[] }>()
    log('LOG:', `[PEERS] Searching ${this.peerAddresses.length} peer${this.peerAddresses.length === 1 ? '' : 's'} for ${request.type}: ${request.query}`)
    for (const address in this.peerAddresses) {
      if (!Object.hasOwn(this.peerAddresses, address)) continue
      const peer = this.peers.get(address as `0x${string}`)
      if (!isPeer(peer, address as `0x${string}`)) continue
      if (!isOpened(peer, address as `0x${string}`)) continue
      (await searchPeer(request, peer, results, installedPlugins, confirmedHashes)).entries().map(result => results.set(result[0], result[1]))
    }
    return new Map<bigint, SearchResult[T]>(results.entries().map(([hash, result]) => ([hash, { ...result, confidence: avg(result.confidences) }])))
  }

  private announce({ hostname }: Peer) {
    for (const peerAddress in this.peers) {
      if (Object.hasOwn(this.peers, peerAddress)) continue
      const announceTo = this.peers.get(peerAddress as `0x${string}`)
      if (!announceTo) {
        warn('DEVWARN:', `[PEERS] Peer not found ${peerAddress}`)
        continue
      }
      announceTo.announcePeer({ hostname })
    }
  }
}
