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
import { authenticatedPeers, UDP_Server } from './udp/server'

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
  private readonly dht: DHT
  private readonly knownPeers: Set<`${string}:${number}`> // TODO: prune old peers, mem leak
  private readonly nodeHandlers: (() => void)[] = []
  private readonly startupTrace = Trace.start('[DHT] Startup')
  constructor (peers: PeerManager, private readonly config: Config['dht'], private readonly node: Config['node'], udpServer: UDP_Server, private readonly dhtNodeRepo: DhtNodeRepository) {
    this.knownPeers = new Set<`${string}:${number}`>([`${node.hostname}:${node.port}`,`${node.ip}:${node.port}`])
    const socket = krpc({ id: Buffer.from(DHT_Node.getNodeId(node), 'hex'), krpcSocket: krpcSocket(udpServer), nodes: config.bootstrapNodes.split(','), timeout: 5_000 })
    this.dht = new DHT({ bootstrap: config.bootstrapNodes.split(','), host: net.isIP(node.hostname) ? node.hostname : node.ip, krpc: socket, nodeId: DHT_Node.getNodeId(node) })
    config.bootstrapNodes.split(',').forEach(node => {
      const [host, port] = node.split(':') as [string, `${number}`]
      this.dht.addNode({ host, port: Number(port) })
    })
    this.loadCache()
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
      if (nodes > 50 || (nodes > this.cacheSize && this.cacheSize !== 0)) {
        this.dhtNodeRepo.replaceAll(this.nodes)
        this.cacheSize = nodes
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
      if (_infoHash.toString('hex') !== DHT_Node.getRoomId(config.roomSeed)) return
      if (this.knownPeers.has(hostname)) return
      this.knownPeers.add(hostname)
      const trace = Trace.start(`[DHT] Received announce from ${hostname}`)
      peers.add(hostname, trace)
    }))
  }
  static readonly getNodeId = (node: Config['node']) => SHA1.hash(`${node.hostname}:${node.port}`, 'hex')
  static readonly getRoomId = (roomSeed: string) => Bun.SHA1.hash(roomSeed + String(Math.round(Date.now()/1000/60/60)), 'hex')
  public readonly add = (node: DHTNode) => this.dht.addNode(node)
  public readonly isReady = () => new Promise<undefined>(res => {
    const id = setInterval(() => {
      // #region agent log
      fetch('http://127.0.0.1:7488/ingest/ae9253ff-0376-45a8-b089-19456fa3761b',{body:JSON.stringify({data:{cacheLoaded:this.resolved.cacheLoaded,connected:this.resolved.connected,nodeCount:this.nodes.length,ready:this.resolved.ready,requireReady:this.config.requireReady},hypothesisId:'H1',location:'src/backend/networking/dht.ts:82',message:'DHT readiness poll',runId:'pre-fix',sessionId:'ca44a7',timestamp:Date.now()}),headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ca44a7'},method:'POST'}).catch(() => undefined)
      // #endregion
      if (!this.config.requireReady) this.resolved.ready = true
      if (this.countResolved().notResolved === 0) {
        clearInterval(id)
        // #region agent log
        fetch('http://127.0.0.1:7488/ingest/ae9253ff-0376-45a8-b089-19456fa3761b',{body:JSON.stringify({data:{cacheLoaded:this.resolved.cacheLoaded,connected:this.resolved.connected,nodeCount:this.nodes.length,ready:this.resolved.ready},hypothesisId:'H1',location:'src/backend/networking/dht.ts:86',message:'DHT readiness resolved',runId:'pre-fix',sessionId:'ca44a7',timestamp:Date.now()}),headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ca44a7'},method:'POST'}).catch(() => undefined)
        // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7488/ingest/ae9253ff-0376-45a8-b089-19456fa3761b',{body:JSON.stringify({data:{cachedNodeCount:peers.length},hypothesisId:'H1',location:'src/backend/networking/dht.ts:108',message:'DHT cache loaded',runId:'pre-fix',sessionId:'ca44a7',timestamp:Date.now()}),headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ca44a7'},method:'POST'}).catch(() => undefined)
    // #endregion
    for (const peer of peers) this.add(peer)
    this.resolved.cacheLoaded = true
    const {notResolved,resolved} = this.countResolved()
    this.startupTrace.step(`${resolved}/${resolved+notResolved} Loaded cached nodes`)
  }
}
