import { Parser } from 'expr-eval'
import { Peer } from "./networking/ws/peer";
import { CONFIG } from './config'
import { Crypto } from './Crypto'
import type { DB, Repositories } from './db'
import type MetadataManager from './Metadata'
import type { SearchResult } from './Metadata'
import WebSocketClient from "./networking/ws/client";
import { startServer, type WebSocketServerConnection } from './networking/ws/server'
import { discoverPeers } from './networking/dht'
import type { Request } from './RequestManager';
import type Node from './Node';
import { StatsReporter } from './StatsReporter';

const cacheFile = Bun.file('./data/ws-servers.json')

const avg = (numbers: number[]) => numbers.reduce((accumulator, currentValue) => accumulator + currentValue, 0) / numbers.length
const parser = new Parser()
parser.functions.avg = (...args: number[]) => avg(args)

export default class Peers {
  private readonly peers: { [address: `0x${string}`]: Peer } = {}

  constructor(private readonly node: Node, public readonly serverPort: number, dhtPort: number, private readonly crypto: Crypto, private readonly metadataManager: MetadataManager, private readonly repos: Repositories, private readonly db: DB) {
    startServer(crypto, serverPort, peer => this.add(peer))
    const dht = discoverPeers(serverPort, dhtPort, peer => this.add(peer), crypto, this)
    new StatsReporter(crypto.address, metadataManager.installedPlugins, () => this.peers, db, dht)

    cacheFile.exists().then(exists => {
      if (!exists) return
      cacheFile.json().then((hostnames: `ws://${string}`[]) => hostnames.filter(hostname => hostname !== 'ws://').forEach(hostname => WebSocketClient.init(crypto, hostname, `ws://${CONFIG.serverHostname}:${serverPort}`, this).then(socket => { if (socket) this.add(socket) })))
    })
    
    let lastCount = 0
    setInterval(() => {
      if (lastCount === this.count) return
      lastCount = this.count
      console.log('LOG:', `[PEERS] Connected to ${this.count} peer${this.count === 1 ? '' : 's'}`)
    }, 1_000)
  }

  public add(socket: WebSocketClient | WebSocketServerConnection) {
    const peer = new Peer(this.node, socket, peer => this.add(peer), this.crypto, () => { delete this.peers[socket.address] }, this, this.repos, this.db, this.metadataManager.installedPlugins)
    if (socket.address in this.peers) {
      if (socket.address !== '0x0') socket.close()
      return
    }
    this.peers[socket.address] = peer
    cacheFile.write(JSON.stringify(Object.values(this.peers).map(peer => peer.hostname)))
    this.announce(peer)
  }

  private announce(peer: Peer) {
    for (const peerAddress in this.peers) this.peers[peerAddress as `0x${string}`]!.announcePeer({ hostname: peer.hostname })
  }

  public readonly has = (address: `0x${string}`) => address in this.peers

  public async requestAll<T extends Request['type']>(request: Request & { type: T }, confirmedHashes: Set<bigint>, installedPlugins: Set<string>) {
    const results = new Map<bigint, Exclude<SearchResult[T], 'confidence'> & { confidences: number[] }>()
    console.log('LOG:', `[PEERS] Searching ${Object.keys(this.peers).filter(address => address !== '0x0').length} peers for ${request.type}: ${request.query}`)
    for (const _address in this.peers) {
      try {
        const address = _address as `0x${string}`
        if (address === '0x0') continue
        const peer = this.peers[address]!

        if (!peer.isOpened) {
          console.warn('WARN:', `[PEERS] Skipping peer ${address}: connection not open`)
          continue
        }

        const peerResults = await peer.search(request.type, request.query)

        // Compare Results
        const pluginMatches: { [pluginId: string]: { match: number, mismatch: number } } = {}
        for (const result of peerResults) {
          const hash = BigInt(Bun.hash(JSON.stringify(result)))
          if (!(result.plugin_id in pluginMatches)) pluginMatches[result.plugin_id] = { match: 0, mismatch: 0 }
          pluginMatches[result.plugin_id]![confirmedHashes.has(hash) ? 'match' : 'mismatch']++
        }

        const peerConfidence = avg(
          Object.entries(pluginMatches)
            .filter(([pluginId]) => installedPlugins.has(pluginId))
            .map(([, { match, mismatch }]) => Parser.evaluate(CONFIG.pluginConfidence, { x: match, y: mismatch }))
        ) // 0-1

        for (const result of peerResults) {
          const hash = BigInt(Bun.hash(JSON.stringify(result)))
          const peerClaimedConfidence = result.confidence
          const finalConfidence = parser.evaluate(CONFIG.finalConfidence, { x: peerConfidence, y: peerClaimedConfidence, z: peer.historicConfidence })
          results.set(hash, { ...result as Exclude<SearchResult[T], 'confidence'>, confidences: [...results.get(hash)?.confidences ?? [], finalConfidence] })
        }
      } catch(e) {
        console.error('ERROR:', e)
      }
    }

    return new Map<bigint, SearchResult[T]>(results.entries().map(([hash, result]) => ([hash, { ...result, confidence: avg(result.confidences) }])))
  }

  public get count() { 
    return Object.keys(this.peers).filter(address => address !== '0x0')?.length ?? 0
  }

  public getConfidence(address: `0x${string}`): number {
    const peer = this.peers[address]
    if (!peer) return 0
    return peer.historicConfidence
  }

  public isConnectionOpened(address: `0x${string}`): boolean {
    const peer = this.peers[address]
    if (!peer) return false
    return peer.isOpened
  }
}
