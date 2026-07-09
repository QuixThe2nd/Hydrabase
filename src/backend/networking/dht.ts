import DHT, { type DHTNode } from 'bittorrent-dht'
import { SHA1 } from 'bun'
import krpc from 'k-rpc'
import krpcSocket from 'k-rpc-socket'
import net from 'net'

import type { Config } from '../../types/hydrabase'
import type { DhtNodeRepository } from '../db/repositories/DhtNodeRepository'
import type PeerManager from '../PeerManager'

import { debug, error, logContext, warn } from '../../utils/log'
import { Trace } from '../../utils/trace'
import { authenticatedPeers } from './authenticatedPeers'

// While the routing table is smaller than this, keep re-seeding bootstrap nodes and
// re-running an iterative lookup so a cold start actually traverses the DHT instead of
// giving up after a single shallow bootstrap lookup.
const COLD_BOOTSTRAP_INTERVAL_MS = 10_000
const HEALTHY_NODE_COUNT = 20
// Persist the routing table once it is at least this large (and still growing).
const MIN_CACHE_PERSIST_NODES = 8

export class DHT_Node {
  public readonly resolved = {
    cacheLoaded: false,
    connected: false,
    ready: false,
  }
  get nodes() {
    return this.dht.toJSON().nodes
  }
  private cacheSize = 0
  private coldBootstrapTimer: ReturnType<typeof setInterval> | undefined
  private readonly dht: DHT
  private readonly knownPeers: Set<`${string}:${number}`> // TODO: prune old peers, mem leak
  private readonly nodeHandlers: (() => void)[] = []
  private readonly startupTrace = Trace.start('[DHT] Startup')
  constructor (peers: PeerManager, private readonly config: Config['dht'], private readonly node: Config['node'], private readonly dhtNodeRepo: DhtNodeRepository) {
    this.knownPeers = new Set<`${string}:${number}`>([`${node.hostname}:${node.port}`,`${node.ip}:${node.port}`])
    const bootstrap = config.bootstrapNodes.split(',')
    // timeout belongs to the k-rpc-socket (k-rpc ignores it); raise per-query timeout to
    // 5s so slow-but-live routers are not dropped, and widen fan-out for faster traversal.
    const socket = krpc({ backgroundConcurrency: 16, concurrency: 32, id: Buffer.from(DHT_Node.getNodeId(node), 'hex'), krpcSocket: krpcSocket({ timeout: 5_000 }), nodes: bootstrap })
    this.dht = new DHT({ bootstrap, host: net.isIP(node.hostname) ? node.hostname : node.ip, krpc: socket, nodeId: DHT_Node.getNodeId(node) })
    // Explicitly bind the DHT socket on a free ephemeral port (NOT node.port — the UTP
    // transport owns that). Binding fires the 'listening' event that starts bittorrent-dht's
    // internal bucket-refresh / re-bootstrap-when-isolated maintenance loop; without it that
    // loop never runs and the routing table stalls at a single node.
    this.dht.listen()
    bootstrap.forEach(entry => {
      const [host, port] = entry.split(':') as [string, `${number}`]
      this.dht.addNode({ host, port: Number(port) })
    })
    this.loadCache()
    this.registerHandlers(peers)
    this.startColdBootstrap()
  }
  static readonly getNodeId = (node: Config['node']) => SHA1.hash(`${node.hostname}:${node.port}`, 'hex')
  static readonly getRoomId = (roomSeed: string) => Bun.SHA1.hash(roomSeed + String(Math.round(Date.now()/1000/60/60)), 'hex')
  public readonly add = (node: DHTNode) => this.dht.addNode(node)
  public readonly isReady = () => new Promise<undefined>(res => {
    const id = setInterval(() => {
      if (!this.config.requireReady) this.resolved.ready = true
      if (this.countResolved().notResolved === 0) {
        clearInterval(id)
        this.announce()
        setInterval(() => this.announce(), this.config.reannounce)
        this.startupTrace.success()
        res(undefined)
      } // TODO: rate limiting
    }, 1_000)
  })
  public onNode(handler: () => void): void {
    this.nodeHandlers.push(handler)
  }
  private readonly announce = () => {
    const room = DHT_Node.getRoomId(this.config.roomSeed)
    this.dht.announce(room, this.node.port, err => { if (err) warn('WARN:', `An error occurred during announce - ${err.message} ${this.nodes.length}`) })
    this.dht.lookup(room, err => { if (err) error('ERROR:', `An error occurred during lookup ${err.message}`) })
  }
  private readonly countResolved = () => {
    const resolved = Object.values(this.resolved).filter(resolved => resolved).length
    const notResolved = Object.values(this.resolved).filter(resolved => !resolved).length
    return { notResolved, resolved }
  }
  private readonly loadCache = () => {
    const peers = this.dhtNodeRepo.getAll()
    for (const peer of peers) this.add(peer)
    this.cacheSize = peers.length // seed so we only re-persist once the live table grows past the cache
    this.resolved.cacheLoaded = true
    const {notResolved,resolved} = this.countResolved()
    this.startupTrace.step(`${resolved}/${resolved+notResolved} Loaded cached nodes`)
  }
  private readonly registerHandlers = (peers: PeerManager) => {
    this.dht.on('error', (err: unknown) => logContext('DHT', () => error('ERROR:', 'An error occurred', { err })))
    this.dht.on('ready', () => logContext('DHT', () => {
      this.resolved.ready = true
      const {notResolved,resolved} = this.countResolved()
      this.startupTrace.step(`${resolved}/${resolved+notResolved} Ready with ${this.nodes.length} node${this.nodes.length === 1 ? '' : 's'}`)
    }))
    let lastNodes = 0
    this.dht.on('node', () => logContext('DHT', () => {
      const nodes = this.nodes.length
      if (nodes > 1 && !this.resolved.connected) {
        this.resolved.connected = true
        const {notResolved,resolved} = this.countResolved()
        this.startupTrace.step(`${resolved}/${resolved+notResolved} Connected to ${nodes} nodes`)
      }
      if (nodes % 25 === 0 && nodes !== lastNodes) {
        debug(`Connected to ${nodes} nodes`)
        lastNodes = nodes
      }
      // Persist a warm routing table whenever it reaches a new high (and is usably large),
      // so restarts are not perpetually cold. The old `nodes > 50` gate never fired because
      // the table never grew that large, leaving the cache permanently empty.
      if (nodes > this.cacheSize && nodes >= MIN_CACHE_PERSIST_NODES) {
        this.cacheSize = nodes
        this.dhtNodeRepo.replaceAll(this.nodes)
      }
      this.nodeHandlers.forEach(handler => handler())
    }))
    this.dht.on('peer', (peer: { host: string; port: number }) => logContext('DHT', () => {
      const hostname = authenticatedPeers.get(`${peer.host}:${peer.port}`)?.hostname ?? `${peer.host}:${peer.port}`
      if (this.knownPeers.has(hostname)) return
      this.knownPeers.add(hostname)
      const trace = Trace.start(`[DHT] Discovered peer ${hostname}`)
      peers.add(hostname, trace)
    }))
    this.dht.on('announce', (peer: { host: string; port: number }, _infoHash: Buffer) => logContext('DHT', () => {
      const hostname = authenticatedPeers.get(`${peer.host}:${peer.port}`)?.hostname ?? `${peer.host}:${peer.port}`
      if (_infoHash.toString('hex') !== DHT_Node.getRoomId(this.config.roomSeed)) return
      if (this.knownPeers.has(hostname)) return
      this.knownPeers.add(hostname)
      const trace = Trace.start(`[DHT] Received announce from ${hostname}`)
      peers.add(hostname, trace)
    }))
  }
  // Aggressively traverse the DHT while the routing table is small. bittorrent-dht otherwise
  // performs a single shallow bootstrap lookup and stops, which strands the table at 1-2 nodes
  // on networks where several public routers are slow or dead. Re-seeding the bootstrap nodes
  // and repeatedly looking up our own id forces continued iteration until the table is healthy.
  private readonly startColdBootstrap = () => {
    const ownId = Buffer.from(DHT_Node.getNodeId(this.node), 'hex')
    const tick = () => {
      if (this.nodes.length >= HEALTHY_NODE_COUNT) {
        if (this.coldBootstrapTimer) clearInterval(this.coldBootstrapTimer)
        this.coldBootstrapTimer = undefined
        return
      }
      for (const entry of this.config.bootstrapNodes.split(',')) {
        const [host, port] = entry.split(':') as [string, `${number}`]
        this.dht.addNode({ host, port: Number(port) })
      }
      this.dht.lookup(ownId, () => undefined)
    }
    this.coldBootstrapTimer = setInterval(tick, COLD_BOOTSTRAP_INTERVAL_MS)
    tick()
  }
}
