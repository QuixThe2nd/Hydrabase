import { Parser } from 'expr-eval'
import type { Request } from './Messages'
import type { SearchResult } from './Metadata'
import { discoverPeers } from './networking/dht'
import WebSocketClient from './networking/ws/client'
import { Peer } from './networking/ws/peer'
import { startServer, type WebSocketServerConnection } from './networking/ws/server'
import { CONFIG } from './config'
import { Crypto } from './crypto'
import { resolve4 } from "dns/promises";

export type ExtendedSearchResult<T extends Request['type']> = SearchResult[T] & { confidences: number[] }

const avg = (numbers: number[]) => numbers.reduce((accumulator, currentValue) => accumulator + currentValue, 0) / numbers.length

export const bootstrapNode = (await resolve4("ddns.yazdani.au"))[0];

export default class Node {
  private readonly peers: { [address: `${'0x' | 'ws://'}${string}`]: Peer } = {}

  constructor(serverPort: number, dhtPort: number, dhtRoom: string, private readonly crypto: Crypto) {
    startServer(serverPort, peer => this.addPeer(peer), crypto)
    discoverPeers(serverPort, dhtPort, dhtRoom, peer => this.addPeer(peer), this.crypto)

    WebSocketClient.init(`ws://${bootstrapNode}:3000`, crypto).then(client => {
      if (client !== false) this.addPeer(client)
    })
    WebSocketClient.init(`ws://${bootstrapNode}:3001`, crypto).then(client => {
      if (client !== false) this.addPeer(client)
    })
    WebSocketClient.init(`ws://${bootstrapNode}:6000`, crypto).then(client => {
      if (client !== false) this.addPeer(client)
    })
    WebSocketClient.init(`ws://${bootstrapNode}:6001`, crypto).then(client => {
      if (client !== false) this.addPeer(client)
    })
  }

  public addPeer(peer: WebSocketClient | WebSocketServerConnection) {
    if (peer.address in this.peers) return console.warn('WARN:', 'Already connected to peer')
    this.peers[peer.address] = new Peer(peer)
  }

  public async requestAll<T extends Request['type']>(request: Request & { type: T }, confirmedHashes: Set<bigint>, installedPlugins: Set<string>) {
    const results = new Map<bigint, ExtendedSearchResult<T>>()
    console.log('LOG:', `Sending request to ${Object.keys(this.peers).length} peers`)
    for (const _address in this.peers) {
      const address = _address as `0x${string}`
      const peer = this.peers[address]!
      if (!peer.isOpened) {
        console.warn('WARN:', 'Skipping request, connection not open')
        delete this.peers[address]
        continue
      }

      console.log('LOG:', `Sending request to peer ${address}`)
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
