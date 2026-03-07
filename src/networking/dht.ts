import DHT, { type DHTNode } from 'bittorrent-dht'

import type Peers from '../Peers';

import { CONFIG } from '../config';
import { error, log, warn } from '../log';
import WebSocketClient from './ws/client';

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
  private readonly dht: DHT
  private readonly knownPeers = new Set<`${string}:${number}`>()
  private lastResolved = 0
  private retryTimeout: NodeJS.Timeout | undefined

  constructor (peers: Peers, private readonly cacheFile = Bun.file('./data/dht-nodes.json')) {
    this.dht = new DHT({ krpc: peers.rpc })
    this.dht.listen(CONFIG.dhtPort, '0.0.0.0', () => {
      log(`[DHT] Listening on port ${CONFIG.dhtPort}`)
      this.resolved.listening = true
    })
    CONFIG.dhtBootstrapNodes.split(',').forEach(node => {
      const [host, port] = node.split(':') as [string, `${number}`]
      this.dht.addNode({ host, port: Number(port) })
    })
    this.dht.on('error', err => error('ERROR:', '[DHT] An error occurred', {err}))
    this.dht.on('ready', () => {
      log(`[DHT] Ready with ${this.nodes.length} nodes`)
      this.resolved.ready = true
      this.loadCache()
    })
    let lastNodes = 0
    this.dht.on('node', () => {
      const nodes = this.dht.toJSON().nodes.length
      if (nodes > 1 && !this.resolved.connected) {
        log(`[DHT] Connected to ${nodes} nodes`)
        this.resolved.connected = true
      }
      if (nodes % 25 === 0 && nodes !== lastNodes) {
        log(`[DHT] Connected to ${nodes} nodes`)
        lastNodes = nodes
      }
      this.cacheFile.write(JSON.stringify(this.dht.toJSON().nodes))
    })
    this.dht.on('peer', async peer => {
      if (`${peer.host}:${peer.port}` === `${CONFIG.externalIp}:${CONFIG.serverPort}`) return // TODO: upgrade from external ip to domain if any
      if (this.knownPeers.has(`${peer.host}:${peer.port}`)) return
      this.knownPeers.add(`${peer.host}:${peer.port}`)
      log(`[DHT] Discovered peer ws://${peer.host}:${peer.port}`)
      const client = await WebSocketClient.init(peers, `${peer.host}:${peer.port}`)
      if (client === false) return
      peers.add(client)
    })
    this.dht.on('announce', async (peer, _infoHash) => {
      if (_infoHash.toString('hex') !== DHT_Node.getRoomId()) return
      if (this.knownPeers.has(`${peer.host}:${peer.port}`)) return
      if (`ws://${peer.host}:${peer.port}` === `ws://${CONFIG.externalIp}:${CONFIG.serverPort}`) return // TODO: upgrade from external ip to domain if any
      log(`[DHT] Received announce from ws://${peer.host}:${peer.port}`)
      const client = await WebSocketClient.init(peers, `${peer.host}:${peer.port}`)
      if (client === false) return
      peers.add(client)
      this.knownPeers.add(`${peer.host}:${peer.port}`)
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
    if (this.nodes.length <= 1) {
      warn('WARN:', '[DHT] Waiting for nodes...')
      this.retryTimeout = setTimeout(() => this.announce(), 10_000)
      return
    }
    clearTimeout(this.retryTimeout)
    const room = DHT_Node.getRoomId()
     this.dht.announce(room, CONFIG.serverPort, err => { if (err) {error('ERROR:', '[DHT] An error occurred during announce', {err})} })
    this.dht.lookup(room, err => { if (err) {error('ERROR:', '[DHT] An error occurred during lookup', {err})} })
  }

  private readonly countResolved = () => {
    const resolved = Object.values(this.resolved).filter(resolved => resolved).length
    const notResolved = Object.values(this.resolved).filter(resolved => !resolved).length
    return { notResolved, resolved }
  }

  private readonly loadCache = async () => {
    log('[DHT] Loading cached nodes...')
    const cacheFile = Bun.file('./data/dht-nodes.json')
    if (!(await cacheFile.exists())) return
    const peers: DHTNode[] = await cacheFile.json()
    for (const peer of peers) this.add(peer)
    log('[DHT] Loaded cached nodes')
    this.resolved.cacheLoaded = true
  }
}
