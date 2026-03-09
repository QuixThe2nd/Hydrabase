import DHT, { type DHTNode } from 'bittorrent-dht'
import { SHA1 } from 'bun';
import net from 'net'

import type Peers from '../Peers';

import { CONFIG } from '../config';
import { debug, error, log, stats, warn } from '../log';
import { ipToHostname } from './rpc';

export class DHT_Node {
  static readonly nodeId = SHA1.hash(`${CONFIG.hostname}:${CONFIG.port}`, 'hex')
  public readonly resolved = {
    cacheLoaded: false,
    connected: false,
    listening: false,
    ready: false,
  }
  get nodes() {
    return this.dht.toJSON().nodes
  }
  private readonly dht: DHT
  private readonly knownPeers = new Set<`${string}:${number}`>([`${CONFIG.hostname}:${CONFIG.port}`,`${CONFIG.ip}:${CONFIG.port}`])
  private lastResolved = 0

  constructor (peers: Peers, private readonly cacheFile = Bun.file('./data/dht-nodes.json')) {
    this.dht = new DHT({ bootstrap: CONFIG.dhtBootstrapNodes.split(','), host: net.isIP(CONFIG.hostname) ? CONFIG.hostname : CONFIG.ip, krpc: peers.rpc, nodeId: DHT_Node.nodeId })
    this.dht.listen(CONFIG.port, CONFIG.listenAddress, () => {
      debug(`[DHT] Listening on port ${CONFIG.port}`)
      this.resolved.listening = true
    })
    CONFIG.dhtBootstrapNodes.split(',').forEach(node => {
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
      const nodes = this.dht.toJSON().nodes.length
      if (nodes > 1 && !this.resolved.connected) {
        stats(`[DHT] Connected to ${nodes} nodes`)
        this.resolved.connected = true
      }
      if (nodes % 25 === 0 && nodes !== lastNodes) {
        stats(`[DHT] Connected to ${nodes} nodes`)
        lastNodes = nodes
      }
      if (nodes > 50 || !(await this.cacheFile.exists()) || nodes > JSON.parse(await this.cacheFile.text()).length) this.cacheFile.write(JSON.stringify(this.dht.toJSON().nodes))
    })
    this.dht.on('peer', peer => {
      const hostname = ipToHostname.get(`${peer.host}:${peer.port}`) ?? `${peer.host}:${peer.port}`
      if (this.knownPeers.has(hostname)) return
      this.knownPeers.add(hostname)
      debug(`[DHT] Discovered peer ${hostname}`)
      peers.add(hostname)
    })
    this.dht.on('announce', (peer, _infoHash) => {
      const hostname = ipToHostname.get(`${peer.host}:${peer.port}`) ?? `${peer.host}:${peer.port}`
      if (_infoHash.toString('hex') !== DHT_Node.getRoomId()) return
      if (this.knownPeers.has(hostname)) return
      this.knownPeers.add(hostname)
      log(`[DHT] Received announce from ${hostname}`)
      peers.add(hostname)
    })
  }

  static readonly getRoomId = () => Bun.SHA1.hash(CONFIG.dhtRoomSeed + String(Math.round(Date.now()/1000/60/60/6)), 'hex')

  public readonly add = (node: DHTNode) => this.dht.addNode(node)

  public readonly isReady = () => new Promise(res => {
    const id = setInterval(() => {
      const { notResolved, resolved } = this.countResolved()
      if (!CONFIG.requireDhtConnection) this.resolved.connected = true
      if (notResolved === 0) {
        log(`[DHT] Started... ${resolved}/${resolved}`)
        clearInterval(id)
        this.announce()
        setInterval(() => this.announce(), CONFIG.dhtReannounce)
        res(undefined)
      } else if (this.lastResolved !== resolved) {
        log(`[DHT] Starting... ${resolved}/${resolved+notResolved}`)
        this.lastResolved = resolved
      }
    }, 1_000)
  })

  private readonly announce = () => {
    const room = DHT_Node.getRoomId()
     this.dht.announce(room, CONFIG.port, err => { if (err) {warn('WARN:', `[DHT] An error occurred during announce - ${err.message}`)} })
    this.dht.lookup(room, err => { if (err) {error('ERROR:', `[DHT] An error occurred during lookup ${err.message}`)} })
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
