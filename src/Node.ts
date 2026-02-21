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
import type { startDatabase } from './database'

const avg = (numbers: number[]) => numbers.reduce((accumulator, currentValue) => accumulator + currentValue, 0) / numbers.length

export const bootstrapNode = (await resolve4("ddns.yazdani.au"))[0];

export default class Node {
  private readonly peers: { [address: `${'0x' | 'ws://'}${string}`]: Peer } = {}

  constructor(public readonly serverPort: number, dhtPort: number, private readonly crypto: Crypto, private readonly db: ReturnType<typeof startDatabase>) {
    startServer(serverPort, peer => this.addPeer(peer), crypto)
    discoverPeers(serverPort, dhtPort, peer => this.addPeer(peer), this.crypto)
  }

  public addPeer(peer: WebSocketClient | WebSocketServerConnection) {
    if (peer.address in this.peers && this.peers[peer.address]?.isOpened) return console.warn('WARN:', 'Already connected to peer')
    this.peers[peer.address] = new Peer(peer, peer => this.addPeer(peer), this.crypto, this.serverPort, () => { delete this.peers[peer.address] }, this.db)
    this.announcePeer(peer)
  }

  private announcePeer(peer: WebSocketClient | WebSocketServerConnection) {
    for (const address in this.peers) this.peers[address as `0x${string}`]!.announcePeer({ address: peer.hostname })
  }

  public async requestAll<T extends Request['type']>(request: Request & { type: T }, confirmedHashes: Set<bigint>, installedPlugins: Set<string>) {
    const results = new Map<bigint, SearchResult[T]>()
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
        results.set(hash, { ...result as SearchResult[T], confidence: finalConfidence })
      }
    }

    return results
  }
}
