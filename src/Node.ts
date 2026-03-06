import type { Request, Response, SearchResult } from './RequestManager'

import { Account, getPrivateKey } from './Crypto/Account'
import { startDatabase } from './db'
import { log } from './log'
import MetadataManager from './Metadata'
import ITunes from './Metadata/plugins/iTunes'
import Spotify from './Metadata/plugins/Spotify'
import { DHT_Node } from './networking/dht'
import Peers from './Peers'
import { StatsReporter } from './StatsReporter'

export class Node {
  public readonly resolved = {
    dhtNode: false,
    peerConns: false,
    peers: false,
    statsReporter: false,
  }
  private readonly metadataManager: MetadataManager
  private readonly peers: Peers
  private readonly SPOTIFY_CLIENT_ID = process.env['SPOTIFY_CLIENT_ID']
  private readonly SPOTIFY_CLIENT_SECRET = process.env['SPOTIFY_CLIENT_SECRET']

  private constructor(privateKey: Uint8Array) {
    const account = new Account(privateKey)
    const { db, repos } = startDatabase()
    this.metadataManager = new MetadataManager([new ITunes(), ... this.SPOTIFY_CLIENT_ID && this.SPOTIFY_CLIENT_SECRET ? [new Spotify({ clientId: this.SPOTIFY_CLIENT_ID, clientSecret: this.SPOTIFY_CLIENT_SECRET })] : []], repos)
    this.peers = new Peers(account, this.metadataManager, repos, db, <T extends Request['type']>(type: T, query: string, searchPeers?: boolean): Promise<Response<T>> => this.search(type, query, searchPeers))
    this.peers.init().then(() => {this.resolved.peers = true})
    const dhtNode = new DHT_Node(account, this.peers)
    dhtNode.init().then(() => {this.resolved.dhtNode = true})
    const statsReporter = new StatsReporter(account.address, this.metadataManager.installedPlugins, this.peers, dhtNode, db)
    statsReporter.init().then(() => {this.resolved.statsReporter = true})
    const id = setInterval(() => {
      if (this.peers.count === 0) return
      this.resolved.peerConns = true
      clearInterval(id)
    }, 1_000)
  }

  static readonly init = () => new Promise<Node>(res => {
    getPrivateKey().then(key => {
      const node = new Node(key)
      let lastResolved = 0
      let i = 0
      const id = setInterval(() => {
        const resolved = Object.values(node.resolved).filter(resolved => resolved).length
        const notResolved = Object.values(node.resolved).filter(resolved => !resolved).length
        if (notResolved === 0) {
          log(`[Node] Started... ${resolved}/${resolved}`)
          clearInterval(id)
          res(node)
        } else if (lastResolved !== resolved || i % 10 === 0) {
          log(`[Node] Starting... ${resolved}/${resolved+notResolved}`)
          lastResolved = resolved
        }
        i++
      }, 1_000)
    })
  })

  public readonly search = async <T extends Request['type']>(type: T, query: string, searchPeers = true): Promise<Response<T>> => {
    const results = await this.metadataManager.handleRequest({ query, type }, this.peers)
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
      const result: SearchResult[T] | undefined = results[i]
      if (hash && result) peerResults.set(hash, result)
    }

    return [...peerResults.values()]
  }
}

// TODO: show usernames in peers tab

