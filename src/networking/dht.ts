import DHT from 'bittorrent-dht'
import krpc from 'k-rpc'
import { portForward } from './upnp'
import WebSocketClient from './ws/client';
import type { Crypto } from '../Crypto';
import { CONFIG } from '../config';

const knownPeers = new Set<`${string}:${number}`>();

const getRoomId = () => Bun.SHA1.hash(CONFIG.dhtRoomSeed + String(Math.round(Date.now()/1000/60/60)), 'hex')

const announce = (dht: DHT, port: number) => {
  const room = getRoomId()
  dht.announce(room, port, err => { if (err) console.error('ERROR:', 'DHT threw an error during announce', err) })
  dht.lookup(room, err => { if (err) console.error('ERROR:', 'DHT threw an error during lookup', err) })
}

export const discoverPeers = (serverPort: number, dhtPort: number, addPeer: (peer: WebSocketClient) => void, crypto: Crypto) => {
  portForward(dhtPort, 'Hydrabase (UDP)', 'UDP');
  const dht = new DHT({
    krpc: krpc(),
    bootstrap: ['router.bittorrent.com:6881', 'router.utorrent.com:6881', 'dht.transmissionbt.com:6881']
  })
  dht.listen(dhtPort, '0.0.0.0', () => console.log('LOG:', `DHT Listening on port ${dhtPort}`))
  dht.on('error', err => console.error('ERROR:', 'DHT the an error', err))
  // dht.on('warning', warning => console.warn('WARN:', 'DHT threw a warning', warning))
  dht.on('ready', () => {
    console.log('LOG:', 'DHT ready', `- ${dht.toJSON().nodes.length} Nodes`)

    announce(dht, serverPort)
    setInterval(() => announce(dht, serverPort), CONFIG.dhtReannounce)

    dht.addNode({ host: 'ddns.yazdani.au', port: 45454 })
    dht.addNode({ host: 'ddns.yazdani.au', port: 45455 })
  })
  // dht.on('node', node => console.log('LOG:', `Discovered DHT node ${node.host}:${node.port}`))
  dht.on('peer', async peer => {
    if (knownPeers.has(`${peer.host}:${peer.port}`) || CONFIG.blacklistedIPs.includes(peer.host)) return
    if (`ws://${peer.host}:${peer.port}` === `ws://${CONFIG.serverHostname}:${serverPort}`) return
    console.log('LOG:', `Discovered peer dht://${peer.host}:${peer.port}`)
    const client = await WebSocketClient.init(crypto, `ws://${peer.host}:${peer.port}`, `ws://${CONFIG.serverHostname}:${serverPort}`)
    if (client === false) return
    addPeer(client)
    knownPeers.add(`${peer.host}:${peer.port}`)
  })
  dht.on('announce', async (peer, _infoHash) => {
    if (_infoHash.toString('hex') !== getRoomId()) return
    if (knownPeers.has(`${peer.host}:${peer.port}`) || CONFIG.blacklistedIPs.includes(peer.host)) return
    if (`ws://${peer.host}:${peer.port}` === `ws://${CONFIG.serverHostname}:${serverPort}`) return
    console.log('LOG:', `Received announce from dht://${peer.host}:${peer.port}`)
    const client = await WebSocketClient.init(crypto, `ws://${peer.host}:${peer.port}`, `ws://${CONFIG.serverHostname}:${serverPort}`)
    if (client === false) return
    addPeer(client)
    knownPeers.add(`${peer.host}:${peer.port}`)
  })
}
