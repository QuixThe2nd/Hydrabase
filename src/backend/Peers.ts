import type { KRPC } from 'k-rpc';

import { Parser } from 'expr-eval'

import type { Socket } from '../types/hydrabase';
import type { Request, Response, SearchResult } from '../types/hydrabase-schemas';
import type { Account } from './Crypto/Account';
import type { DB, Repositories } from './db'
import type MetadataManager from './Metadata'

import { debug, log, warn } from '../utils/log';
import { CONFIG } from './config';
import { authenticatedPeers, RPC, startRPC } from './networking/rpc';
import WebSocketClient from "./networking/ws/client";
import { WebSocketServerConnection } from './networking/ws/server';
import { Peer } from "./peer";
import { PeerMap } from './PeerMap';
import { AuthSchema, type Identity, verifyServer } from './protocol/HIP1/handshake';

const cacheFile = Bun.file('./data/ws-servers.json')
const avg = (numbers: number[]) => numbers.reduce((accumulator, currentValue) => accumulator + currentValue, 0) / numbers.length
const parser = new Parser()
parser.functions.avg = (...args: number[]) => avg(args)
// TODO: move all sql.raw() to repos
const checkPluginMatches = (peerResults: Response<Request['type']>, confirmedHashes: Set<bigint>) => {
  const pluginMatches: Record<string, { match: number, mismatch: number }> = {}
  for (const _result of peerResults) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { address, confidence, ...result } = _result
    const hash = BigInt(Bun.hash(JSON.stringify(_result)))
    const entry = pluginMatches[result.plugin_id] ?? { match: 0, mismatch: 0 }
    if (confirmedHashes.has(hash)) entry.match++
    else entry.mismatch++
    pluginMatches[result.plugin_id] = entry
  } // TODO: Store peer username
  return pluginMatches
} // TODO: pipe all console.log's to gui

const calculatePeerConfidence = (pluginMatches: Record<string, { match: number, mismatch: number }>, installedPlugins: Set<string>) => avg(
  Object.entries(pluginMatches)
    .filter(([pluginId]) => installedPlugins.has(pluginId))
    .map(([, { match, mismatch }]) => Parser.evaluate(CONFIG.pluginConfidence, { x: match, y: mismatch }))
) // 0-1
// TODO: dedupe usernames
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

export const authenticateServer = async (hostname: `${string}:${number}`): Promise<[number, string] | Identity> => {
  debug(`[PEERS] Authenticating server ${hostname}`)
  const cache = authenticatedPeers.get(hostname)
  if (cache) return cache
  try {
    const response = await fetch(`http://${hostname}/auth`)
    const body = await response.text()
    const auth = AuthSchema.safeParse(JSON.parse(body)).data
    if (!auth) return [500, 'Failed to parse server authentication']
    if (auth.hostname !== hostname) {
      debug(`[PEERS] Upgrading hostname from ${hostname} to ${auth.hostname}`)
      return await authenticateServer(auth.hostname)
    }
    const authResults = verifyServer(auth, hostname)
    if (authResults !== true) return authResults
    authenticatedPeers.set(hostname, auth)
    return auth
  } catch (err) {
    warn('WARN:', `[CLIENT] Failed to fetch server authentication from ${hostname} - ${(err as Error).message}`)
    return [500, 'Failed to fetch server authentication']
  }
}

export default class Peers {
  public readonly rpc: KRPC
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
  private readonly knownPeers = new Set<`${string}:${number}`>()
  private readonly peers = new PeerMap()

  constructor(public readonly account: Account, private readonly metadataManager: MetadataManager, private readonly repos: Repositories, private readonly db: DB, private readonly search: <T extends Request['type']>(type: T, query: string, searchPeers?: boolean) => Promise<Response<T>>, public readonly hostname: `${string}:${number}`) {
    const { rpc } = startRPC(this)
    this.rpc = rpc
  }

  // TODO: some mechanism to proactively propagate unsolicited votes
  public async add(_peer: `${string}:${number}` | RPC | WebSocketServerConnection, preferTransport = CONFIG.preferTransport): Promise<boolean> {
    const socket = await this.toSocket(_peer, preferTransport)
    if (!socket) return false
    if (this.peers.has(socket.peer.address)) {
      if (socket.peer.address !== '0x0') {
        warn('DEVWARN:', `[PEERS] Tried to connect to existing peer again via ${socket instanceof WebSocketClient ? 'client' : socket instanceof RPC ? 'RPC' : 'server'} ${socket.peer.address} ${socket.peer.hostname}`)
        socket.close()
      }
      return false
    }

    // TODO: feedback endpoints, so soulsync can force set metadata votes to 0 or 1 confidence
    socket.onClose(() => this.peers.delete(socket.peer.address))
    const peer = new Peer(socket, this, this.db, this.repos, this.metadataManager.installedPlugins, this.search)
    this.peers.set(socket.peer.address, peer)
    cacheFile.write(JSON.stringify([...this.peers.values()].map(peer => peer.hostname)))
    this.announce(peer)
    return true
  }

  public getConfidence(address: `0x${string}`): number { // TODO: Soulsync plugin - https://github.com/Nezreka/SoulSync/blob/main/Support/API.md
    const peer = this.peers.get(address)
    if (!peer) return 0
    return peer.historicConfidence // TODO: tit for tat
  }

  // TODO: endpoint soulsync can call with user feedback of "spotify result x is listenbrainz result y"
  public readonly has = (address: `0x${string}`) => address in this.peers

  public isConnectionOpened(address: `0x${string}`): boolean {
    const peer = this.peers.get(address)
    if (!peer) return false
    return peer.isOpened
  }

  public async loadCache(bootstrapPeers: string[]) {
    await Promise.all(bootstrapPeers.map(async node => {
      await this.add(node as `${string}:${number}`)
    }))
    if (!(await cacheFile.exists())) return
    const hostnames: `${string}:${number}`[] = await cacheFile.json()
    for (const hostname of hostnames) if (hostname && !bootstrapPeers.includes(hostname)) this.add(hostname)
  } // TODO: time based confidence scores - older peers = more trustworthy

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

  private async getAuth(hostname: `${string}:${number}`) {
    if (hostname === this.hostname) return false
    if (hostname === `${CONFIG.ip}:${CONFIG.port}`) return false
    if (this.knownPeers.has(hostname)) return false
    this.knownPeers.add(hostname)

    const auth = await authenticateServer(hostname)
    if (Array.isArray(auth)) return warn('DEVWARN:', `[PEERS] Failed to authenticate server ${auth[1]}`)
    if (this.has(auth.address)) return warn('DEVWARN:', `[PEERS] Already connected/connecting to peer ${auth.username} ${auth.address} ${auth.hostname}`)
    if (auth.address === this.account.address) return warn('DEVWARN:', `[PEERS] Not connecting to self`)

    if ('hostname' in auth) {
      if (auth.hostname === this.hostname) return false
      if (auth.hostname === `${CONFIG.ip}:${CONFIG.port}`) return false
      if (auth.hostname !== hostname && this.knownPeers.has(auth.hostname)) return false
      this.knownPeers.add(auth.hostname)
    }

    return auth
  }

  private async toSocket(peer: `${string}:${number}` | RPC | WebSocketServerConnection, preferTransport: 'TCP' | 'UDP'): Promise<false | Socket> {
    if (peer instanceof WebSocketServerConnection || peer instanceof RPC) return peer
    const identity = await this.getAuth(authenticatedPeers.get(peer)?.hostname ?? peer)
    if (!identity) return identity
    const preferredClient = preferTransport === 'TCP' ? new WebSocketClient(identity, this) : RPC.fromOutbound(identity, this)
    if (preferredClient) return preferredClient
    return preferTransport === 'TCP' ? RPC.fromOutbound(identity, this) : new WebSocketClient(identity, this)
  }
}
