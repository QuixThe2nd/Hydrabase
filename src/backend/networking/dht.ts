import DHT, { type DHTNode } from 'bittorrent-dht'
import { SHA1 } from 'bun';
import krpc from 'k-rpc'
import krpcSocket from 'k-rpc-socket'
import net from 'net'

import type { Config } from '../../types/hydrabase';
import type PeerManager from '../PeerManager';

import { debug, error, log, stats, warn } from '../../utils/log';
import { authenticatedPeers, UDP_Server } from './udp';

export class DHT_Node {
  public readonly resolved = {
    cacheLoaded: false,
    connected: false,
    listening: false,
    ready: false,
  }
  get nodes() {
    return this.dht.toJSON().nodes
  }
  private cacheSize = 0
  private readonly dht: DHT
  private readonly knownPeers: Set<`${string}:${number}`> // TODO: prune old peers, mem leak
  private lastResolved = 0
  constructor (peers: PeerManager, private readonly config: Config['dht'], private readonly node: Config['node'], udpServer: UDP_Server, private readonly cacheFile = Bun.file('./data/dht-nodes.json')) {
    this.knownPeers = new Set<`${string}:${number}`>([`${node.hostname}:${node.port}`,`${node.ip}:${node.port}`])
    const socket = krpc({ id: Buffer.from(DHT_Node.getNodeId(node)), krpcSocket: krpcSocket(udpServer), nodes: config.bootstrapNodes.split(','), timeout: 5_000 })
    this.dht = new DHT({ bootstrap: config.bootstrapNodes.split(','), host: net.isIP(node.hostname) ? node.hostname : node.ip, krpc: socket, nodeId: DHT_Node.getNodeId(node) })
    this.dht.listen(node.port, node.listenAddress, () => {
      debug(`[DHT] Listening on port ${node.port}`)
      this.resolved.listening = true
    })
    config.bootstrapNodes.split(',').forEach(node => {
      const [host, port] = node.split(':') as [string, `${number}`]
      this.dht.addNode({ host, port: Number(port) })
    })
    this.loadCache()
    this.dht.on('error', err => error('ERROR:', '[DHT] An error occurred', {err}))
    this.dht.on('ready', () => {
      log(`[DHT] Ready with ${this.nodes.length} node${this.nodes.length === 1 ? '' : 's'}`)
      this.resolved.ready = true
    })
    let lastNodes = 0
    this.dht.on('node', async () => {
      const nodes = this.nodes.length
      if (nodes > 1 && !this.resolved.connected) {
        stats(`[DHT] Connected to ${nodes} nodes`)
        this.resolved.connected = true
      }
      if (nodes % 25 === 0 && nodes !== lastNodes) {
        stats(`[DHT] Connected to ${nodes} nodes`)
        lastNodes = nodes
      }
      if (nodes > 50 || !(await this.cacheFile.exists()) || (nodes > this.cacheSize && this.cacheSize !== 0)) {
        this.cacheFile.write(JSON.stringify(this.nodes))
        this.cacheSize = nodes
      }
    })
    this.dht.on('peer', peer => {
      const hostname = authenticatedPeers.get(`${peer.host}:${peer.port}`)?.hostname ?? `${peer.host}:${peer.port}`
      if (this.knownPeers.has(hostname)) return
      this.knownPeers.add(hostname)
      debug(`[DHT] Discovered peer ${hostname}`)
      peers.add(hostname)
    })
    this.dht.on('announce', (peer, _infoHash) => {
      const hostname = authenticatedPeers.get(`${peer.host}:${peer.port}`)?.hostname ?? `${peer.host}:${peer.port}`
      if (_infoHash.toString('hex') !== DHT_Node.getRoomId(config.roomSeed)) return
      if (this.knownPeers.has(hostname)) return
      this.knownPeers.add(hostname)
      log(`[DHT] Received announce from ${hostname}`)
      peers.add(hostname)
    })
  }
  static readonly getNodeId = (node: Config['node']) => SHA1.hash(`${node.hostname}:${node.port}`, 'hex')
  static readonly getRoomId = (roomSeed: string) => Bun.SHA1.hash(roomSeed + String(Math.round(Date.now()/1000/60/60/6)), 'hex')
  public readonly add = (node: DHTNode) => this.dht.addNode(node)
  public readonly isReady = () => new Promise<undefined>(res => {
    const id = setInterval(() => {
      const { notResolved, resolved } = this.countResolved()
      if (!this.config.requireConnection) this.resolved.connected = true
      if (notResolved === 0) {
        log(`[DHT] Started... ${resolved}/${resolved}`)
        clearInterval(id)
        this.announce()
        setInterval(() => this.announce(), this.config.reannounce)
        res(undefined)
      } else if (this.lastResolved !== resolved) {
        const pending = Object.entries(this.resolved).filter(([, v]) => !v).map(([k]) => k)
        log(`[DHT] Starting... ${resolved}/${resolved+notResolved} (waiting on: ${pending.join(', ')})`)
        this.lastResolved = resolved
      } // TODO: rate limiting
    }, 1_000)
  })
  private readonly announce = () => {
    const room = DHT_Node.getRoomId(this.config.roomSeed)
    this.dht.announce(room, this.node.port, err => { if (err) warn('WARN:', `[DHT] An error occurred during announce - ${err.message} ${this.nodes.length}`) })
    this.dht.lookup(room, err => { if (err) error('ERROR:', `[DHT] An error occurred during lookup ${err.message}`) })
  }
  private readonly countResolved = () => {
    const resolved = Object.values(this.resolved).filter(resolved => resolved).length
    const notResolved = Object.values(this.resolved).filter(resolved => !resolved).length
    return { notResolved, resolved }
  }
  private readonly loadCache = async () => {
    this.resolved.cacheLoaded = true
    if (!(await this.cacheFile.exists())) return
    const peers: DHTNode[] = await this.cacheFile.json()
    for (const peer of peers) this.add(peer)
    log('[DHT] Loaded cached nodes')
  }
}
