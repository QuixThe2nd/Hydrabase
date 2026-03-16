import dgram from 'dgram'
import { Parser } from 'expr-eval'

import type { Config, Socket } from '../types/hydrabase';
import type { Request, Response, SearchResult } from '../types/hydrabase-schemas';
import type { Account } from './Crypto/Account';
import type { Repositories } from './db'
import type MetadataManager from './Metadata'
import type { Identity } from './protocol/HIP1/handshake';

import { debug, log, warn } from '../utils/log';
import { authenticateServerHTTP } from './networking/http';
import { authenticateServerUDP, UDP_Client } from './networking/udp/client';
import { authenticatedPeers, UDP_Server } from './networking/udp/server';
import WebSocketClient from "./networking/ws/client";
import { WebSocketServerConnection } from './networking/ws/server';
import { Peer } from "./peer";
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
    const entry = pluginMatches[result.plugin_id] ?? { match: 0, mismatch: 0 }
    if (confirmedHashes.has(hash)) entry.match++
    else entry.mismatch++
    pluginMatches[result.plugin_id] = entry
  }
  return pluginMatches
} // TODO: pipe all console.log's to gui

const calculatePeerConfidence = (formulas: Config['formulas'], pluginMatches: Record<string, { match: number, mismatch: number }>, installedPlugins: Set<string>) => avg(
  Object.entries(pluginMatches)
    .filter(([pluginId]) => installedPlugins.has(pluginId))
    .map(([, { match, mismatch }]) => Parser.evaluate(formulas.pluginConfidence, { x: match, y: mismatch }))
) // 0-1
// TODO: dedupe usernames
const saveResults = <T extends Request['type']>(formulas: Config['formulas'], peerResults: Response<T>, peerConfidence: number, results: Map<bigint, SearchResult[T] & { confidences: number[] }>, peer: Peer): Map<bigint, SearchResult[T] & { confidences: number[] }> => {
  for (const _result of peerResults) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { address, confidence, ...result } = _result
    const hash = BigInt(Bun.hash(JSON.stringify(result)))
    const finalConfidence = parser.evaluate(formulas.finalConfidence, { x: peerConfidence, y: confidence, z: peer.historicConfidence })
    results.set(hash, { ...result as Exclude<SearchResult[T], 'confidence'>, confidences: [...results.get(hash)?.confidences ?? [], finalConfidence] })
  }
  return results
}

const searchPeer = async <T extends Request['type']>(formulas: Config['formulas'], request: Request & { type: T }, peer: Peer, results: Map<bigint, SearchResult[T] & { confidences: number[] }>, installedPlugins: Set<string>, confirmedHashes: Set<bigint>): Promise<Map<bigint, SearchResult[T] & { confidences: number[] }>> => {
  const peerResults = await peer.search(request.type, request.query)
  const pluginMatches = checkPluginMatches(peerResults, confirmedHashes)
  const peerConfidence = calculatePeerConfidence(formulas, pluginMatches, installedPlugins)
  return saveResults(formulas, peerResults, peerConfidence, results, peer)
}

const isPeer = (peer: Peer | undefined, address: `0x${string}`): peer is Peer => peer ? true : warn('DEVWARN:', `[PEERS] Peer not found ${address}`)
const isOpened = (peer: Peer | undefined, address: `0x${string}`): boolean => peer ? true : warn('WARN:', `[PEERS] Skipping peer ${address}: connection not open`)

export default class PeerManager {
  get apiPeer() {
    return this.peers.get('0x0')
  }
  get connectedPeers() {
    return [...this.peers.values()]
  }
  get peerAddresses() {
    return this.peers.addresses
  }
  private readonly knownPeers = new Set<`${string}:${number}`>() // TODO: prune old peers, mem leak
  private readonly peers = new PeerMap()

  constructor(
    public readonly account: Account, 
    private readonly metadataManager: MetadataManager, 
    private readonly repos: Repositories,
    private readonly search: <T extends Request['type']>(type: T, query: string, searchPeers?: boolean) => Promise<Response<T>>,
    private readonly node: Config['node'],
    private readonly rpcConfig: Config['rpc'],
    public readonly udpServer: UDP_Server,
    public readonly socket: dgram.Socket,
  ) {}

  // TODO: some mechanism to proactively propagate unsolicited votes
  public async add(_peer: `${string}:${number}` | UDP_Client | WebSocketServerConnection, preferTransport = this.node.preferTransport): Promise<boolean> {
    const socket = typeof _peer === 'string' ? await this.toSocket(_peer, preferTransport) : _peer
    if (!socket) return false // TODO: try other 
    if (this.peers.has(socket.peer.address)) {
      if (socket.peer.address !== '0x0') {
        debug(`[PEERS] Skipping duplicate connection to ${socket.peer.username} ${socket.peer.address} - already connected via ${this.peers.get(socket.peer.address) instanceof WebSocketClient ? 'client' : 'server'} connection`)
        socket.close()
      }
      return false
    }

    // TODO: feedback endpoints, so soulsync can force set metadata votes to 0 or 1 confidence
    const peer = new Peer(socket, this, this.repos, this.metadataManager.installedPlugins, this.search)

    socket.onClose(() => {
      this.peers.delete(socket.peer.address) // TODO: fallback
    })

    socket.onOpen(() => {
      this.peers.set(socket.peer.address, peer)
      cacheFile.write(JSON.stringify([...this.peers.values()].map(peer => peer.hostname)))
      log(`[PEERS] Peer connection established with ${socket.peer.username} ${socket.peer.address}`)
      this.announce(peer)
    })

    return true
  }

  public getConfidence(address: `0x${string}`): number { // TODO: Soulsync plugin - https://github.com/Nezreka/SoulSync/blob/main/Support/API.md
    const peer = this.peers.get(address)
    if (!peer) return 0
    return peer.historicConfidence // TODO: tit for tat
  }

  // TODO: endpoint soulsync can call with user feedback of "spotify result x is listenbrainz result y"
  public readonly has = (address: `0x${string}`) => this.peers.has(address)

  public isConnectionOpened(address: `0x${string}`): boolean {
    const peer = this.peers.get(address)
    if (!peer) return false
    return peer.isOpened
  }

  public async loadCache(bootstrapPeers: string[]) {
    await Promise.all(bootstrapPeers.map(async hostname => {
      log(`[PEERS] Connecting to bootstrap peer ${hostname}`)
      await this.add(hostname as `${string}:${number}`)
    }))
    if (!(await cacheFile.exists())) return
    const hostnames: `${string}:${number}`[] = await cacheFile.json()
    for (const hostname of hostnames) if (hostname && !bootstrapPeers.includes(hostname)) {
      log(`[PEERS] Connecting to cached peer ${hostname}`)
      await this.add(hostname)
    }
  } // TODO: time based confidence scores - older peers = more trustworthy

  public async requestAll<T extends Request['type']>(formulas: Config['formulas'], request: Request & { type: T }, confirmedHashes: Set<bigint>, installedPlugins: Set<string>): Promise<Map<bigint, SearchResult[T]>> {
    const results = new Map<bigint, SearchResult[T] & { confidences: number[] }>()
    log(`[PEERS] Searching ${this.peerAddresses.length} peer${this.peerAddresses.length === 1 ? '' : 's'} for ${request.type}: ${request.query}`)
    for (const address of this.peerAddresses) {
      const peer = this.peers.get(address)
      if (!isPeer(peer, address)) continue
      if (!isOpened(peer, address)) continue
      (await searchPeer(formulas, request, peer, results, installedPlugins, confirmedHashes)).entries().map(([hash,item]) => results.set(BigInt(hash), item))
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

  private async toSocket(hostname: `${string}:${number}`, preferTransport: 'TCP' | 'UDP' = this.node.preferTransport): Promise<false | Socket> {
    const auth = preferTransport === 'TCP' ? await authenticateServerHTTP(hostname) : await authenticateServerUDP(this.udpServer.socket, hostname, this.account, this.node)
    if (Array.isArray(auth)) return warn('DEVWARN:', `[PEERS] Failed to authenticate peer ${auth[1]}`)
    const identity = this.verifyPeer(authenticatedPeers.get(hostname)?.hostname ?? hostname, auth)
    if (!identity) return identity
    if (preferTransport === 'TCP') return new WebSocketClient(identity, this, this.node)
    return UDP_Client.connectToAuthenticatedPeer(this, identity, this.rpcConfig) || false
  }

  private verifyPeer(hostname: `${string}:${number}`, auth: Identity) {
    if (hostname === `${this.node.hostname}:${this.node.port}` || hostname === `${this.node.ip}:${this.node.port}`) return warn('DEVWARN:', `[PEERS] Not connecting to self ${hostname}`)
    if (this.knownPeers.has(hostname) || this.has(auth.address)) return warn('DEVWARN:', `[PEERS] Already connected/connecting to peer ${auth.username} ${auth.address} ${auth.hostname}`)
    if (auth.address === this.account.address) return warn('DEVWARN:', `[PEERS] Not connecting to self ${auth.address}`)

    if ('hostname' in auth) {
      if (auth.hostname === this.node.hostname) return false
      if (auth.hostname === `${this.node.ip}:${this.node.port}`) return false
      if (auth.hostname !== hostname && this.knownPeers.has(auth.hostname)) return false
      this.knownPeers.add(auth.hostname)
    }

    return auth
  }
}
