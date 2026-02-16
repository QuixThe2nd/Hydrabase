import { Parser } from 'expr-eval'
import type { Request } from './Messages'
import type { SearchResult } from './Metadata'
import { discoverPeers } from './networking/dht'
import WebSocketClient from './networking/ws/client'
import { Peer } from './networking/ws/peer'
import { startServer, type WebSocketServerConnection } from './networking/ws/server'
import { CONFIG } from './config'

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

  public async requestAll<P extends string>(request: Request, hashes: Record<P, bigint>) {
    const results: { [plugin: string]: { [hash: number]: { result: SearchResult[], confidence: { current: number, historic: number }[] } } } = {}
    for (const hostname in this.peers) {
      const peer = this.peers[hostname]!
      if (!peer.isOpened) {
        delete this.peers[hostname]
        continue
      }

      const response = await peer.sendRequest(request)

      // Compare Results
      const responseHashes: Record<string, bigint> = {}
      const responseMatches: Partial<Record<P, boolean>> = {}
      for (const pluginId in response) {
        const result = response[pluginId]!
        const hash = BigInt(Bun.hash(JSON.stringify(result)))
        responseHashes[pluginId] = hash;
        if (pluginId in hashes) responseMatches[pluginId as P] = hashes[pluginId as P] === hash;
      }

      // Calculate Certainty
      const validMatches = Object.entries(responseMatches).filter(([,matched]) => matched).map(([pluginId]) => pluginId).length
      const invalidMatches = Object.entries(responseMatches).filter(([,matched]) => !matched).map(([pluginId]) => pluginId).length
      const matches = validMatches + invalidMatches
      // const noMatches = Object.keys(hashes).length - matches;
      const confidence = Parser.evaluate(CONFIG.confidenceExpression, { x: validMatches, y: matches })
      peer.points += confidence;

      for (const pluginId in response) {
        const hash = responseHashes[pluginId]!;
        const result = response[pluginId]!;
        if (!(pluginId in results)) results[pluginId] = {}
        results[pluginId]![Number(hash)] = { result, confidence: [...results[pluginId]![Number(hash)]?.confidence ?? [], { current: confidence, historic: 
          Parser.evaluate(CONFIG.historicConfidenceExpression, { x: peer.points, y: peer.events }) }] }
      }
    }
    return results;
  }
}

// TODO: Create custom peer discovery network for after users have bootstrapped with dht, dht isnt reliable
