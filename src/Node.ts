import type { DB, Repositories } from './db'
import type MetadataManager from './Metadata'
import type { SearchResult } from './Metadata'
import Peers from './Peers'
import type { Request } from './RequestManager'
import { Crypto } from './Crypto'

export default class Node {
  private readonly peers: Peers

  constructor(public readonly serverPort: number, dhtPort: number, crypto: Crypto, private readonly metadataManager: MetadataManager, repos: Repositories, db: DB) {
    this.peers = new Peers(this, serverPort, dhtPort, crypto, metadataManager, repos, db)
  }
  public async search<T extends Request['type']>(type: T, query: string, searchPeers = true) {
    const results = await this.metadataManager.handleRequest({ type, query }) as SearchResult[T][]
    const hashes = new Set<bigint>()
    const plugins = new Set<string>()
    for (const result of results) {
      hashes.add(BigInt(Bun.hash(JSON.stringify(result))))
      plugins.add(result.plugin_id)
    }

    // TODO: search db

    if (!searchPeers) return results

    const peerResults = await this.peers.requestAll({ type, query }, hashes, plugins)

    // Inject local results
    for (let i = 0; i < results.length; i++) {
      const hash = [...hashes.values()][i]!;
      peerResults.set(hash, results[i]!)
    }

    return [...peerResults.values()]
  }

  get peerCount() {
    return this.peers.count
  }
}
