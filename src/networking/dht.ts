import DHT, { type DHTNode } from 'bittorrent-dht'
import krpc from 'k-rpc'

import type { Account } from '../Crypto/Account';
import type Peers from '../Peers';

import { CONFIG } from '../config';
import { error, log } from '../log';
import { portForward } from './upnp'
import WebSocketClient from './ws/client';

export class DHT_Node {
  get nodes() {
    return this.dht.toJSON().nodes
  }

  private readonly dht: DHT
  private readonly knownPeers = new Set<`${string}:${number}`>();
  private retryTimeout: NodeJS.Timeout | undefined

  private constructor (account: Account, peers: Peers, onReady: () => void, private readonly cacheFile = Bun.file('./data/dht-nodes.json')) {
    portForward(CONFIG.dhtPort, 'Hydrabase (UDP)', 'UDP');
    this.dht = new DHT({ bootstrap: ['router.bittorrent.com:6881', 'router.utorrent.com:6881', 'dht.transmissionbt.com:6881'], krpc: krpc() })
    this.dht.listen(CONFIG.dhtPort, '0.0.0.0', () => log(`[DHT] Listening on port ${CONFIG.dhtPort}`))
    this.dht.on('error', err => error('ERROR:', '[DHT] An error occurred', {err}))
    // This.dht.on('warning', warning => warn('WARN:', '[DHT] A warning was thrown', warning))
    this.dht.on('ready', () => {
      log(`[DHT] Ready with ${this.nodes.length} nodes`)
      this.announce()
      setInterval(() => this.announce(), CONFIG.dhtReannounce)
      onReady()
    })
    let lastNodes = 0
    this.dht.on('node', () => {
      const nodes = this.dht.toJSON().nodes.length
      if (nodes % 25 === 0 && nodes !== lastNodes) {
        log(`[DHT] Connected to ${nodes} nodes`)
        lastNodes = nodes
      }
      this.cacheFile.write(JSON.stringify(this.dht.toJSON().nodes))
      // Log(`[DHT] Discovered node ${node.host}:${node.port}`)
    })
    this.dht.on('peer', async peer => {
      if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.|::1$|fc|fd)/i.test(peer.host)) return
      if (`ws://${peer.host}:${peer.port}` === `ws://${CONFIG.hostname}:${CONFIG.serverPort}`) return
      if (this.knownPeers.has(`${peer.host}:${peer.port}`)) return
      this.knownPeers.add(`${peer.host}:${peer.port}`)
      log(`[DHT] Discovered peer ws://${peer.host}:${peer.port}`)
      const client = await WebSocketClient.init(peers, account, `ws://${peer.host}:${peer.port}`)
      if (client === false) return
      peers.add(client)
    })
    this.dht.on('announce', async (peer, _infoHash) => {
      if (_infoHash.toString('hex') !== DHT_Node.getRoomId()) return
      if (this.knownPeers.has(`${peer.host}:${peer.port}`)) return
      if (`ws://${peer.host}:${peer.port}` === `ws://${CONFIG.hostname}:${CONFIG.serverPort}`) return
      log(`[DHT] Received announce from ws://${peer.host}:${peer.port}`)
      const client = await WebSocketClient.init(peers, account, `ws://${peer.host}:${peer.port}`)
      if (client === false) return
      peers.add(client)
      this.knownPeers.add(`${peer.host}:${peer.port}`)
    })
  }

  static readonly getRoomId = () => Bun.SHA1.hash(CONFIG.dhtRoomSeed + String(Math.round(Date.now()/1000/60/60/6)), 'hex')

  static readonly init = (account: Account, peers: Peers, cacheFile = Bun.file('./data/dht-nodes.json')) => new Promise<DHT_Node>(resolve => {
    const node = new DHT_Node(account, peers, () => resolve(node))
    cacheFile.exists().then(async exists => {
      if (!exists) return
      const peers: DHTNode[] = await cacheFile.json()
      for (const peer of peers) node.add(peer)
    })
  })

  public readonly add = (node: DHTNode) => this.dht.addNode(node)

  private readonly announce = () => {
    if (this.nodes.length <= 1) {
      log('[DHT] Waiting for nodes')
      this.retryTimeout = setTimeout(() => this.announce(), 5_000)
      return
    }
    clearTimeout(this.retryTimeout)
    const room = DHT_Node.getRoomId()
    this.dht.announce(room, CONFIG.serverPort, err => { if (err) {error('ERROR:', '[DHT] An error occurred during announce', {err})} })
    this.dht.lookup(room, err => { if (err) {error('ERROR:', '[DHT] An error occurred during lookup', {err})} })
  }
}
