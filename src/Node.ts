import type { Request, Response, SearchResult } from './RequestManager'

import { Account, getPrivateKey } from './Crypto/Account'
import { startDatabase } from './db'
import { log, warn } from './log'
import MetadataManager from './Metadata'
import ITunes from './Metadata/plugins/iTunes'
import Spotify from './Metadata/plugins/Spotify'
import { DHT_Node } from './networking/dht'
import Peers from './Peers'
import { StatsReporter } from './StatsReporter'

const {SPOTIFY_CLIENT_ID,SPOTIFY_CLIENT_SECRET} = process.env

const startWorkers = async (): Promise<{ metadataManager: MetadataManager, peers: Peers }> => {
  const account = new Account(await getPrivateKey())
  const { db, repos } = startDatabase()
  const metadataManager = new MetadataManager([new ITunes(), ... SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET ? [new Spotify({ clientId: SPOTIFY_CLIENT_ID, clientSecret: SPOTIFY_CLIENT_SECRET })] : []], repos)
  const peers = new Peers(account, metadataManager, repos, db, <T extends Request['type']>(type: T, query: string, searchPeers?: boolean): Promise<Response<T>> => search(type, query, searchPeers))
  await peers.init()
  const dhtNode = await DHT_Node.init(account, peers)
  const statsReport = new StatsReporter(account.address, metadataManager.installedPlugins, peers, dhtNode, db)
  await statsReport.init()

  await new Promise(res => {
    let i = 0
    const id = setInterval(() => {
      if (peers.count === 0) {
        if (i === 0) log('[NODE] Waiting to connect to peers')
        if (i > 12 && i % 6 === 0) warn('WARN:', '[NODE] Taking a while to find peers to connect to')
        i++
        return
      }
      clearInterval(id)
      res(undefined)
    }, 5_000)
  })

  return { metadataManager, peers }
}

const { metadataManager, peers } = await startWorkers()

export const search = async <T extends Request['type']>(type: T, query: string, searchPeers = true): Promise<Response<T>> => {
  const results = await metadataManager.handleRequest({ query, type }, peers)
  if (!searchPeers) return results
  const plugins = new Set<string>()
  const hashes = new Set<bigint>(results.map(_result => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {address, confidence, ...result} = _result
    plugins.add(result.plugin_id)
    return BigInt(Bun.hash(JSON.stringify(result)))
  }))

  const peerResults = await peers.requestAll({ query, type }, hashes, plugins)

  // Inject local results
  for (let i = 0; i < results.length; i++) {
    const hash = [...hashes.values()][i]
    const result: SearchResult[T] | undefined = results[i]
    if (hash && result) peerResults.set(hash, result)
  }

  return [...peerResults.values()]
}
