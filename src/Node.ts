import { Parser } from 'expr-eval'
import type { Request } from './Messages'
import type { SearchResult } from './Metadata'
import { discoverPeers } from './networking/dht'
import WebSocketClient from './networking/ws/client'
import { Peer } from './networking/ws/peer'
import { startServer, type WebSocketServerConnection } from './networking/ws/server'
import { CONFIG } from './config'

type ExtendedSearchResult = SearchResult & { confidences: number[] }

const avg = (numbers: number[]) => numbers.reduce((accumulator, currentValue) => accumulator + currentValue, 0) / numbers.length

export default class Node {
  private readonly peers: { [hostname: string]: Peer } = {}

  constructor(serverPort: number, dhtPort: number, dhtRoom: string) {
    discoverPeers(serverPort, dhtPort, dhtRoom, hostname => this.addPeer(hostname))
    startServer(serverPort, peer => this.addPeer(peer))
  }

  public addPeer(peer: `ws://${string}` | WebSocketServerConnection) {
    if (typeof peer === 'string') {
      if (!(peer in this.peers)) this.peers[peer] = new Peer(new WebSocketClient(peer))
    } else if (!(peer.hostname in this.peers)) this.peers[peer.hostname] = new Peer(peer)
  }

  public async requestAll(request: Request, confirmedHashes: Set<bigint>, installedPlugins: Set<string>) {
    const results = new Map<bigint, ExtendedSearchResult>()
    for (const hostname in this.peers) {
      const peer = this.peers[hostname]!
      if (!peer.isOpened) {
        delete this.peers[hostname]
        continue
      }

      const peerResults = await peer.sendRequest(request)

      // Compare Results
      const pluginMatches: { [pluginId: string]: { match: number, mismatch: number } } = {}
      for (const result of peerResults) {
        const hash = BigInt(Bun.hash(JSON.stringify(result)))
        if (!(result.pluginId in pluginMatches)) pluginMatches[result.pluginId] = { match: 0, mismatch: 0 }
        pluginMatches[result.pluginId]![confirmedHashes.has(hash) ? 'match' : 'mismatch']++
        // if (pluginId in hashes) responseMatches[pluginId as P] = hashes[pluginId as P] === hash;
      }

      const confidence = avg(
        Object.entries(pluginMatches)
          .filter(([pluginId]) => installedPlugins.has(pluginId))
          .map(([, { match, mismatch }]) => Parser.evaluate(CONFIG.pluginConfidence, { x: match, y: mismatch }))
      )

      peer.points += confidence;

      for (const result of peerResults) {
        const hash = BigInt(Bun.hash(JSON.stringify(result)))
        results.set(hash, { ...result, confidences: [...results.get(hash)?.confidences ?? [], confidence] })
      }
    }

    return results
  }
}

// TODO: Create custom peer discovery network for after users have bootstrapped with dht, dht isnt reliable
