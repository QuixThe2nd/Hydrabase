import { Parser } from 'expr-eval'
import type { Request } from './Messages'
import type { SearchResult } from './Metadata'
import { discoverPeers } from './networking/dht'
import WebSocketClient from './networking/ws/client'
import { Peer } from './networking/ws/peer'
import { startServer, type WebSocketServerConnection } from './networking/ws/server'
import { CONFIG } from './config'
import { Crypto } from './crypto'

export type ExtendedSearchResult<T extends Request['type']> = SearchResult[T] & { confidences: number[] }

const avg = (numbers: number[]) => numbers.reduce((accumulator, currentValue) => accumulator + currentValue, 0) / numbers.length

export default class Node {
  private readonly peers: { [address: `${'0x' | 'ws://'}${string}`]: Peer } = {}

  constructor(serverPort: number, dhtPort: number, dhtRoom: string, private readonly crypto: Crypto) {
    discoverPeers(serverPort, dhtPort, dhtRoom, peer => this.addPeer(peer), this.crypto)
    startServer(serverPort, peer => this.addPeer(peer))

    this.addPeer(new WebSocketClient(`ws://ddns.yazdani.au:3000`, crypto))
    this.addPeer(new WebSocketClient(`ws://ddns.yazdani.au:5000`, crypto))
    this.addPeer(new WebSocketClient(`ws://ddns.yazdani.au:5001`, crypto))
    this.addPeer(new WebSocketClient(`ws://ddns.yazdani.au:5002`, crypto))
  }

  // TODO: Prevent 2 nodes from connecting as both client/server to each other, wasteful
  public addPeer(peer: WebSocketClient | WebSocketServerConnection) {
    if (CONFIG.publicHostnames.includes(peer.address) || peer.address === this.crypto.address) return console.warn('WARN:', `Not connecting to self ${peer.address}`)
    console.log('LOG:', `Connecting to ${peer.address} as ${peer instanceof WebSocketClient ? 'client' : 'server'}`)
    if (peer instanceof WebSocketClient) {
      if (!(peer.address in this.peers)) this.peers[peer.address] = new Peer(peer)
    } else if (!(peer.address in this.peers)) this.peers[peer.address] = new Peer(peer)
  }

  public async requestAll<T extends Request['type']>(request: Request & { type: T }, confirmedHashes: Set<bigint>, installedPlugins: Set<string>) {
    const results = new Map<bigint, ExtendedSearchResult<T>>()
    for (const _address in this.peers) {
      const address = _address as `0x${string}`
      const peer = this.peers[address]!
      if (!peer.isOpened) {
        delete this.peers[address]
        continue
      }

      const peerResults = await peer.sendRequest<T>(request)

      // Compare Results
      const pluginMatches: { [pluginId: string]: { match: number, mismatch: number } } = {}
      for (const result of peerResults) {
        const hash = BigInt(Bun.hash(JSON.stringify(result)))
        if (!(result.plugin_id in pluginMatches)) pluginMatches[result.plugin_id] = { match: 0, mismatch: 0 }
        pluginMatches[result.plugin_id]![confirmedHashes.has(hash) ? 'match' : 'mismatch']++
        // if (pluginId in hashes) responseMatches[pluginId as P] = hashes[pluginId as P] === hash;
      }

      const confidence = avg(
        Object.entries(pluginMatches)
          .filter(([pluginId]) => installedPlugins.has(pluginId))
          .map(([, { match, mismatch }]) => Parser.evaluate(CONFIG.pluginConfidence, { x: match, y: mismatch }))
      )

      const historicConfidence = Parser.evaluate(CONFIG.historicConfidence, { x: peer.points, y: peer.events })

      const finalConfidence = Parser.evaluate(CONFIG.finalConfidence, { x: confidence, y: historicConfidence })

      peer.points += confidence;

      for (const result of peerResults) {
        const hash = BigInt(Bun.hash(JSON.stringify(result)))
        results.set(hash, { ...result as SearchResult[T], confidences: [...results.get(hash)?.confidences ?? [], finalConfidence] })
      }
    }

    return results
  }
}

// TODO: Create custom peer discovery network for after users have bootstrapped with dht, dht isnt reliable
