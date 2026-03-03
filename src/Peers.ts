import { Parser } from 'expr-eval'

import type { Account } from './Crypto/Account';
import type { DB, Repositories } from './db'
import type MetadataManager from './Metadata'
import type { Request, Response, SearchResult } from './RequestManager'

import { CONFIG } from './config'
import { log, warn } from './log';
import WebSocketClient from "./networking/ws/client";
import { Peer } from "./networking/ws/peer";
import { startServer, type WebSocketServerConnection } from './networking/ws/server'
import { PeerMap } from './PeerMap';

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

const saveResults = <T extends Request['type']>(peerResults: Response<T>, peerConfidence: number, results: Map<bigint, SearchResult[T] & { confidences: number[] }>, peer: Peer): Map<bigint, SearchResult[T] & { confidences: number[] }> => {
  for (const _result of peerResults) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { address, confidence, ...result } = _result
    const hash = BigInt(Bun.hash(JSON.stringify(result)))
    const finalConfidence = parser.evaluate(CONFIG.finalConfidence, { x: peerConfidence, y: confidence, z: peer.historicConfidence })
    results.set(hash, { ...result as Exclude<SearchResult[T], 'confidence'>, confidences: [...results.get(hash)?.confidences ?? [], finalConfidence] })
  }
  return results
}

const searchPeer = async <T extends Request['type']>(request: Request & { type: T }, peer: Peer, results: Map<bigint, SearchResult[T] & { confidences: number[] }>, installedPlugins: Set<string>, confirmedHashes: Set<bigint>): Promise<Map<bigint, SearchResult[T] & { confidences: number[] }>> => {
  const peerResults = await peer.search(request.type, request.query)
  const pluginMatches = checkPluginMatches(peerResults, confirmedHashes)
  const peerConfidence = calculatePeerConfidence(pluginMatches, installedPlugins)
  return saveResults(peerResults, peerConfidence, results, peer)
}

const isPeer = (peer: Peer | undefined, address: `0x${string}`): peer is Peer => peer ? true : warn('DEVWARN:', `[PEERS] Peer not found ${address}`)
const isOpened = (peer: Peer | undefined, address: `0x${string}`): boolean => peer ? true : warn('WARN:', `[PEERS] Skipping peer ${address}: connection not open`)

export default class Peers {
  get apiPeer() {
    return this.peers.get('0x0')
  }

  get connectedPeers() {
    return [...this.peers.values()]
  }

  public get count() { 
    return this.peers.count
  }
  get peerAddresses() {
    return this.peers.addresses
  }
  private readonly peers = new PeerMap()

  constructor(private readonly account: Account, private readonly metadataManager: MetadataManager, private readonly repos: Repositories, private readonly db: DB, private readonly search: <T extends Request['type']>(type: T, query: string, searchPeers?: boolean) => Promise<Response<T>>) {
    startServer(account, this)
  }

  public add(socket: WebSocketClient | WebSocketServerConnection) {
    socket.onClose(() => this.peers.delete(socket.peer.address))
    const peer = new Peer(this.search, socket, this.account, this, this.repos, this.db, this.metadataManager.installedPlugins)
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
    if (!(await cacheFile.exists())) return
    const hostnames: `ws://${string}`[] = await cacheFile.json()
    for (const hostname of hostnames) if (hostname && hostname !== 'ws://') WebSocketClient.init(this, this.account, hostname).then(socket => { if (socket) this.add(socket) })
  }

  public isConnectionOpened(address: `0x${string}`): boolean {
    const peer = this.peers.get(address)
    if (!peer) return false
    return peer.isOpened
  }

  public async requestAll<T extends Request['type']>(request: Request & { type: T }, confirmedHashes: Set<bigint>, installedPlugins: Set<string>): Promise<Map<bigint, SearchResult[T]>> {
    const results = new Map<bigint, SearchResult[T] & { confidences: number[] }>()
    log(`[PEERS] Searching ${this.peerAddresses.length} peer${this.peerAddresses.length === 1 ? '' : 's'} for ${request.type}: ${request.query}`)
    for (const address of this.peerAddresses) {
      const peer = this.peers.get(address)
      if (!isPeer(peer, address)) continue
      if (!isOpened(peer, address)) continue
      (await searchPeer(request, peer, results, installedPlugins, confirmedHashes)).entries().map(([hash,item]) => results.set(BigInt(hash), item))
    }
    log(`[PEERS] Received ${results.size} results`)
    return new Map<bigint, SearchResult[T]>(results.entries().map(([hash, result]) => ([hash, { ...result, confidence: avg(result.confidences) }])))
  }

  private announce({ hostname }: Peer) {
    for (const peerAddress of this.peerAddresses) {
      const announceTo = this.peers.get(peerAddress)
      if (!announceTo) {
        warn('DEVWARN:', `[PEERS] Peer not found ${peerAddress}`)
        continue
      }
      announceTo.announcePeer({ hostname })
    }
  }
}
