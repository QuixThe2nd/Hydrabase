import type { Request, Response, SearchResult } from './RequestManager'

import { CONFIG } from './config'
import { Account, getPrivateKey } from './Crypto/Account'
import { startDatabase } from './db'
import { log, warn } from './log'
import MetadataManager from './Metadata'
import ITunes from './Metadata/plugins/iTunes'
import Spotify from './Metadata/plugins/Spotify'
import { DHT_Node } from './networking/dht'
import { portForward } from './networking/upnp'
import { startServer } from './networking/ws/server'
import Peers from './Peers'
import { StatsReporter } from './StatsReporter'

const upnp = async() => {
try {
    await portForward(CONFIG.serverPort, 'Hydrabase (TCP)', 'TCP');
  } catch (err) {
    warn('WARN:', `[UPnP] Failed: ${(err as Error).message} - Ignore if manually port forwarded`)
  }
  try {
    await portForward(CONFIG.dhtPort, 'Hydrabase (UDP)', 'UDP');
  } catch (err) {
    warn('WARN:', `[UPnP] Failed: ${(err as Error).message} - Ignore if manually port forwarded`)
  }
}

const {SPOTIFY_CLIENT_ID,SPOTIFY_CLIENT_SECRET} = process.env

class Node {
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

// eslint-disable-next-line max-statements
export const startNode = async (): Promise<Node> => {
  log('[STARTUP] 1/12 Using UPnP')
  await upnp()
  log('[STARTUP] 2/12 Initialising account')
  const account = new Account(await getPrivateKey())
  log('[STARTUP] 3/12 Starting database')
  const { db, repos } = startDatabase()
  log('[STARTUP] 4/12 Starting metadata manager')
  const metadataManager = new MetadataManager([new ITunes(), ... SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET ? [new Spotify({ clientId: SPOTIFY_CLIENT_ID, clientSecret: SPOTIFY_CLIENT_SECRET })] : []], repos)
  log('[STARTUP] 5/12 Starting node')
  // eslint-disable-next-line prefer-const
  let peers: Peers
  const node = new Node(metadataManager, () => peers)
  log('[STARTUP] 6/12 Starting peer manager')
  peers = new Peers(account, metadataManager, repos, db, async <T extends Request['type']>(type: T, query: string, searchPeers?: boolean): Promise<Response<T>> => node ? await node.search(type, query, searchPeers) : [])
  log('[STARTUP] 7/12 Starting server')
  await startServer(account, peers)
  log('[STARTUP] 8/12 Starting DHT node')
  const dhtNode = new DHT_Node(account, peers)
  log('[STARTUP] 9/12 Waiting for DHT')
  await dhtNode.isReady()
  log('[STARTUP] 10/12 Loading cached peers')
  await peers.loadCache()
  log('[STARTUP] 11/12 Waiting for peers')
  if (CONFIG.requirePeerConnection) await peers.isConnected()
  peers.isConnected()
  log('[STARTUP] 12/12 Starting stats reporter')
  new StatsReporter(account.address, `ws://${CONFIG.hostname}:${CONFIG.serverPort}`, metadataManager.installedPlugins, peers, dhtNode, db)
  return node
}

// TODO: show usernames in peers tab

