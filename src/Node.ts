import type { Request } from './RequestManager'

import { Account, getPrivateKey } from './Crypto/Account'
import { startDatabase } from './db'
import { log, warn } from './log'
import MetadataManager, { type SearchResult } from './Metadata'
import ITunes from './Metadata/plugins/iTunes'
import Spotify from './Metadata/plugins/Spotify'
import Peers from './Peers'

export default class Node {
  get peerCount() {
    return this.peers.count
  }
  private readonly metadataManager: MetadataManager

  private readonly peers: Peers

  private constructor(account: Account) {
    const {SPOTIFY_CLIENT_ID} = process.env
    const {SPOTIFY_CLIENT_SECRET} = process.env

    const { db, repos } = startDatabase()
    this.metadataManager = new MetadataManager([new ITunes(), ... SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET ? [new Spotify({ clientId: SPOTIFY_CLIENT_ID, clientSecret: SPOTIFY_CLIENT_SECRET })] : []], repos)
    this.peers = new Peers(this, account, this.metadataManager, repos, db)
  }

  static readonly init = async (): Promise<Node> => {
    const node = new Node(new Account(await getPrivateKey()))

    return new Promise<Node>(res => {
      let i = 0
      const id = setInterval(() => {
        if (node.peerCount === 0) {
          if (i === 0) {log('LOG:', '[NODE] Waiting to connect to peers')}
          if (i > 12) {warn('WARN:', '[NODE] Taking a while to find peers to connect to')}
          i++
          return
        }
        clearInterval(id)
        res(node)
      }, 5_000)
    })
  }

  public async search<T extends Request['type']>(type: T, query: string, searchPeers = true) {
    const results = await this.metadataManager.handleRequest({ query, type }, this.peers) as SearchResult[T][]
    if (!searchPeers) return results

    const plugins = new Set<string>()
    const hashes = new Set<bigint>(results.map(_result => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const {address, confidence, ...result} = _result
      plugins.add(result.plugin_id)
      return BigInt(Bun.hash(JSON.stringify(result)))
    }))

    const peerResults = await this.peers.requestAll({ query, type }, hashes, plugins)

    // Inject local results
    for (let i = 0; i < results.length; i++) {
      const hash = [...hashes.values()][i]
      const result = results[i]
      if (hash && result) peerResults.set(hash, result)
    }

    return [...peerResults.values()]
  }
}
