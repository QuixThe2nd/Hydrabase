import { Parser } from 'expr-eval'
import { CONFIG } from './config'
import { discoverPeers } from './networking/dht'
import { startServer, type WebSocketServerConnection } from './networking/ws/server'
import WebSocketClient from './networking/ws/client'
import { Peer } from './networking/ws/peer'
import { Crypto } from './utils/crypto'
import type { SearchResult } from './Metadata'
import type MetadataManager from './Metadata'
import type { Repositories } from './db'
import type { Request } from './RequestManager'

const avg = (numbers: number[]) => numbers.reduce((accumulator, currentValue) => accumulator + currentValue, 0) / numbers.length

export default class Node {
  private readonly peers: { [address: `${'0x' | 'ws://'}${string}`]: Peer } = {}

  constructor(public readonly serverPort: number, dhtPort: number, private readonly crypto: Crypto, private readonly metadataManager: MetadataManager, private readonly db: Repositories) {
    startServer(crypto, serverPort, peer => this.addPeer(peer))
    discoverPeers(serverPort, dhtPort, peer => this.addPeer(peer), this.crypto)
  }

  public addPeer(socket: WebSocketClient | WebSocketServerConnection) {
    if (socket.address in this.peers && this.peers[socket.address]?.isOpened) return console.warn('WARN:', 'Already connected to peer')
    this.peers[socket.address] = new Peer(socket, peer => this.addPeer(peer), this.crypto, () => { delete this.peers[socket.address] }, this, this.db, this.metadataManager.installedPlugins)
    this.announcePeer(socket)
  }

  private announcePeer(peer: WebSocketClient | WebSocketServerConnection) {
    for (const address in this.peers) this.peers[address as `0x${string}`]!.announcePeer({ hostname: peer.hostname })
  }

  private async requestAll<T extends Request['type']>(request: Request & { type: T }, confirmedHashes: Set<bigint>, installedPlugins: Set<string>) {
    const results = new Map<bigint, Exclude<SearchResult[T], 'confidence'> & { confidences: number[] }>()
    console.log('LOG:', `Sending request to ${Object.keys(this.peers).length} peers`)
    for (const _address in this.peers) {
      const address = _address as `0x${string}`
      if (address === '0x0') continue
      const peer = this.peers[address]!
      if (!peer.isOpened) {
        console.warn('WARN:', 'Skipping request, connection not open')
        delete this.peers[address]
        continue
      }

      console.log('LOG:', `Sending request to peer ${address}`)
      const peerResults = await peer.search(request.type, request.query)
      console.log('LOG:', `Received ${peerResults.length} results from ${address}`)

      // Compare Results
      const pluginMatches: { [pluginId: string]: { match: number, mismatch: number } } = {}
      for (const result of peerResults) {
        const hash = BigInt(Bun.hash(JSON.stringify(result)))
        if (!(result.plugin_id in pluginMatches)) pluginMatches[result.plugin_id] = { match: 0, mismatch: 0 }
        pluginMatches[result.plugin_id]![confirmedHashes.has(hash) ? 'match' : 'mismatch']++
        // if (pluginId in hashes) responseMatches[pluginId as P] = hashes[pluginId as P] === hash;
      }

      const peerConfidence = avg(
        Object.entries(pluginMatches)
          .filter(([pluginId]) => installedPlugins.has(pluginId))
          .map(([, { match, mismatch }]) => Parser.evaluate(CONFIG.pluginConfidence, { x: match, y: mismatch }))
      )

      for (const result of peerResults) {
        const hash = BigInt(Bun.hash(JSON.stringify(result)))
        const peerClaimedConfidence = result.confidence
        const finalConfidence = Parser.evaluate(CONFIG.finalConfidence, { x: peerConfidence, y: peerClaimedConfidence })
        // TODO: take into account historic accuracy
        results.set(hash, { ...result as Exclude<SearchResult[T], 'confidence'>, confidences: [...results.get(hash)?.confidences ?? [], finalConfidence] })
      }
    }

    return new Map<bigint, SearchResult[T]>(results.entries().map(([hash, result]) => ([hash, { ...result, confidence: avg(result.confidences) }])))
  }

  public async search<T extends Request['type']>(type: T, query: string) {
    console.log('LOG:', 'Searching locally')
    const results = await this.metadataManager.handleRequest({ type, query }) as SearchResult[T][]
    const hashes = new Set<bigint>()
    const plugins = new Set<string>()
    for (const result of results) {
      hashes.add(BigInt(Bun.hash(JSON.stringify(result))))
      plugins.add(result.plugin_id)
    }

    console.log('LOG:', 'Searching peers')
    const peerResults = await this.requestAll({ type, query }, hashes, plugins)

    // Inject local results
    for (let i = 0; i < results.length; i++) {
      const hash = [...hashes.values()][i]!;
      peerResults.set(hash, results[i]!)
    }

    return [...peerResults.values()]
  }
}
