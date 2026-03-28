import type { Config } from '../types/hydrabase'
import type { MessageEnvelope, Request, Response, SearchResult } from '../types/hydrabase-schemas'

import { Trace } from '../utils/trace'
import { Account, getPrivateKey } from './crypto/Account'
import { startDatabase } from './db'
import MetadataManager from './metadata'
import ITunes from './metadata/plugins/iTunes'
import Spotify from './metadata/plugins/Spotify'
import { DHT_Node } from './networking/dht'
import { startServer } from './networking/http'
import { UDP_Server } from './networking/udp/server'
import { requestPort } from './networking/upnp'
import PeerManager from './PeerManager'
import { StatsReporter } from './StatsReporter'
import { buildWebUI } from './webui'

const {SPOTIFY_CLIENT_ID,SPOTIFY_CLIENT_SECRET} = process.env

export class Node {
  private peers?: PeerManager
  constructor(
    private readonly metadataManager: MetadataManager,

    private readonly formulas: Config['formulas']
  ) {}

  public readonly relayStoreMessage = (envelope: MessageEnvelope): number => {
    if (!this.peers) return 0
    const trace = Trace.start(`[HIP2] Relaying message to ${envelope.to}`)
    const sent = this.peers.sendStoreMessage(envelope, trace)
    if (sent > 0) trace.success()
    else trace.softFail('No eligible peers available to relay message')
    return sent
  }

  public readonly search = async <T extends Request['type']>(type: T, query: string, searchPeers = true): Promise<Response<T>> => {
    const results = await this.metadataManager.handleRequest({ query, type }, this.getPeerConfidence)
    if (!searchPeers || !this.peers) return results
    const plugins = new Set<string>()
    const hashes = new Set<bigint>(results.map(_result => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const {address, confidence, ...result} = _result
      plugins.add(result.plugin_id)
      return BigInt(Bun.hash(JSON.stringify(result)))
    }))

    const trace = Trace.start(`Searching for ${type}: ${query}`)
    const peerResults = await this.peers.requestAll(this.formulas, { query, type }, hashes, plugins, trace)
    const noPeerResults = peerResults.size === 0

    // Inject local results
    for (let i = 0; i < results.length; i++) {
      const hash = [...hashes.values()][i]
      const result: SearchResult[T] | undefined = results[i]
      if (hash && result) peerResults.set(hash, result)
    }

    if (noPeerResults) trace.fail('No peer results')
    else if (peerResults.size === 0) trace.fail('No results')
    else trace.success()

    return [...peerResults.values()] as Response<T>
  }
  public readonly setPeerContext = (peers: PeerManager, getPeerConfidence: (address: `0x${string}`) => number) => {
    this.peers = peers
    this.getPeerConfidence = getPeerConfidence
  }

  // eslint-disable-next-line class-methods-use-this
  private getPeerConfidence: (address: `0x${string}`) => number = () => 0
}

export const startNode = async (CONFIG: Config): Promise<Node> => {
  const trace = Trace.start('STARTUP')
  trace.step('1/14 Using UPnP')
  await requestPort(CONFIG.node, CONFIG.upnp)
  trace.step('2/14 Fetching private key')
  const key = await getPrivateKey()
  trace.step('3/14 Initialising account')
  const account = new Account(key)
  trace.step('4/14 Starting database')
  const repos = await startDatabase(CONFIG.formulas.pluginConfidence)
  trace.step('5/14 Starting metadata manager')
  const metadataManager = new MetadataManager([new ITunes(), ... SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET ? [new Spotify({ clientId: SPOTIFY_CLIENT_ID, clientSecret: SPOTIFY_CLIENT_SECRET })] : []], repos, CONFIG.soulIdCutoff)
  trace.step('6/14 Starting UDP server')
  // eslint-disable-next-line prefer-const
  let peerManager: PeerManager
  const udpServer = await UDP_Server.init(account, CONFIG.rpc, CONFIG.node, CONFIG.apiKey, (peer, trace) => peerManager.add(peer, trace, CONFIG.node.preferTransport))
  trace.step('7/14 Starting node')
  const node = new Node(metadataManager, CONFIG.formulas)
  trace.step('8/14 Starting peer manager')
  peerManager = new PeerManager(account, metadataManager, repos, (type, query, searchPeers) => node.search(type, query, searchPeers), CONFIG.node, CONFIG.rpc, udpServer)
  node.setPeerContext(peerManager, address => peerManager.getConfidence(address))
  trace.step('9/14 Building Web UI')
  await buildWebUI()
  trace.step('10/14 Starting HTTP server')
  startServer(account, peerManager, CONFIG.node, CONFIG.apiKey ?? '', CONFIG.node.preferTransport, udpServer, { address: account.address, hostname: `${CONFIG.node.hostname}:${CONFIG.node.port}`, userAgent: 'Hydrabase', username: CONFIG.node.username })
  trace.step('11/14 Starting DHT node')
  const dhtNode = new DHT_Node(peerManager, CONFIG.dht, CONFIG.node, udpServer)
  trace.step('12/14 Starting stats reporter')
  new StatsReporter(CONFIG.node, account, metadataManager.installedPlugins, peerManager, dhtNode, repos)
  trace.step('13/14 Waiting for DHT')
  await dhtNode.isReady()
  trace.step('14/14 Loading cached peers')
  await peerManager.loadCache(CONFIG.bootstrapPeers.split(','))
  trace.success()
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
