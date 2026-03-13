import type { Request, Response, SearchResult } from '../types/hydrabase-schemas'

import { log, warn } from '../utils/log'
import { CONFIG } from './config'
import { Account, getPrivateKey } from './Crypto/Account'
import { startDatabase } from './db'
import MetadataManager from './Metadata'
import ITunes from './Metadata/plugins/iTunes'
import Spotify from './Metadata/plugins/Spotify'
import { DHT_Node } from './networking/dht'
import { portForward } from './networking/upnp'
import { buildWebUI, startServer } from './networking/ws/server'
import Peers from './Peers'
import { StatsReporter } from './StatsReporter'

const upnp = async() => {
try {
    await portForward(CONFIG.port, 'Hydrabase (TCP)', 'TCP');
  } catch (err) {
    warn('WARN:', `[UPnP] Failed: ${(err as Error).message} - Ignore if manually port forwarded`)
  }
  try {
    await portForward(CONFIG.port, 'Hydrabase (UDP)', 'UDP');
  } catch (err) {
    warn('WARN:', `[UPnP] Failed: ${(err as Error).message} - Ignore if manually port forwarded`)
  }
}

const {SPOTIFY_CLIENT_ID,SPOTIFY_CLIENT_SECRET} = process.env

export class Node {
  constructor(private readonly metadataManager: MetadataManager, private readonly getPeers: () => Peers) {}

  public readonly search = async <T extends Request['type']>(type: T, query: string, searchPeers = true): Promise<Response<T>> => {
    const results = await this.metadataManager.handleRequest({ query, type }, this.getPeers())
    if (!searchPeers) return results
    const plugins = new Set<string>()
    const hashes = new Set<bigint>(results.map(_result => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const {address, confidence, ...result} = _result
      plugins.add(result.plugin_id)
      return BigInt(Bun.hash(JSON.stringify(result)))
    }))

    const peerResults = await this.getPeers().requestAll({ query, type }, hashes, plugins)

    // Inject local results
    for (let i = 0; i < results.length; i++) {
      const hash = [...hashes.values()][i]
      const result: SearchResult[T] | undefined = results[i]
      if (hash && result) peerResults.set(hash, result)
    }

    return [...peerResults.values()]
  }
}

export const startNode = async (): Promise<Node> => {
  log('[STARTUP] 1/14 Using UPnP')
  await upnp()
  log('[STARTUP] 2/14 Fetching private key')
  const key = await getPrivateKey()
  log('[STARTUP] 3/14 Initialising account')
  const account = new Account(key)
  log('[STARTUP] 4/14 Starting database')
  const repos = startDatabase()
  log('[STARTUP] 5/14 Starting metadata manager')
  const metadataManager = new MetadataManager([new ITunes(), ... SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET ? [new Spotify({ clientId: SPOTIFY_CLIENT_ID, clientSecret: SPOTIFY_CLIENT_SECRET })] : []], repos)
  log('[STARTUP] 6/14 Starting node')
  // eslint-disable-next-line prefer-const
  let peers: Peers
  const node = new Node(metadataManager, () => peers)
  log('[STARTUP] 7/14 Starting peer manager')
  peers = new Peers(account, metadataManager, repos, async (type, query, searchPeers) => node ? await node.search(type, query, searchPeers) : [], `${CONFIG.hostname}:${CONFIG.port}`, CONFIG.port)
  log('[STARTUP] 8/14 Building Web UI')
  await buildWebUI()
  log('[STARTUP] 9/14 Starting server')
  startServer(account, peers, CONFIG.port, CONFIG.listenAddress, `${CONFIG.hostname}:${CONFIG.port}`)
  log('[STARTUP] 10/14 Starting DHT node')
  const dhtNode = new DHT_Node(peers)
  log('[STARTUP] 11/14 Starting stats reporter')
  new StatsReporter(account.address, metadataManager.installedPlugins, peers, dhtNode, repos)
  log('[STARTUP] 12/14 Waiting for DHT')
  await dhtNode.isReady()
  log('[STARTUP] 13/14 Loading cached peers')
  await peers.loadCache(CONFIG.bootstrapPeers.split(','))
  log('[STARTUP] Startup finished, running test searches')
  const artists = await node.search('artists', 'jay z')
  const albums = await node.search('albums', 'made in england')
  await node.search('tracks', 'dont stop me now')
  if (artists[0]) {
    await node.search('artist.tracks', artists[0].soul_id)
    await node.search('artist.albums', artists[0].soul_id)
  }
  if (albums[0]) await node.search('album.tracks', albums[0].soul_id)

  return node
}
