import DHT from 'bittorrent-dht'
import krpc from 'k-rpc'
import { portForward } from './upnp'
import WebSocketClient from './ws/client';
import type { Crypto } from '../crypto';
import { CONFIG } from '../config';

const knownPeers = new Set<`${string}:${number}`>();

const announce = (dht: DHT, room: string, port: number) => {
  dht.announce(room, port, err => { if (err) console.error('ERROR:', 'DHT threw an error during announce', err) })
  dht.lookup(room, err => { if (err) console.error('ERROR:', 'DHT threw an error during lookup', err) })
}

export const discoverPeers = (serverPort: number, dhtPort: number, dhtRoom: string, addPeer: (peer: WebSocketClient) => void, crypto: Crypto) => {
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

    announce(dht, dhtRoom, serverPort)
    setInterval(() => announce(dht, dhtRoom, serverPort), CONFIG.dhtReannounce)

    dht.addNode({ host: 'ddns.yazdani.au', port: 30000 })
    dht.addNode({ host: 'ddns.yazdani.au', port: 50000 })
    dht.addNode({ host: 'ddns.yazdani.au', port: 50001 })
    dht.addNode({ host: 'ddns.yazdani.au', port: 50002 })
  })
  // dht.on('node', node => console.log('LOG:', `Discovered DHT node ${node.host}:${node.port}`))
  dht.on('peer', async peer => {
    if (knownPeers.has(`${peer.host}:${peer.port}`)) return
    knownPeers.add(`${peer.host}:${peer.port}`)
    console.log('LOG:', `Discovered peer via DHT ${peer.host}:${peer.port}`)
    const client = await WebSocketClient.init(`ws://${peer.host}:${peer.port}`, crypto, `ws://${CONFIG.serverHostname}:${serverPort}`)
    if (client !== false) addPeer(client)
  })
  dht.on('announce', async (peer, _infoHash) => {
    if (knownPeers.has(`${peer.host}:${peer.port}`)) return
    const infoHash = _infoHash.toString('hex')
    if (infoHash === dhtRoom) {
      console.log('LOG:', `Received announce from ${peer.host}:${peer.port}`)
      knownPeers.add(`${peer.host}:${peer.port}`)
      const client = await WebSocketClient.init(`ws://${peer.host}:${peer.port}`, crypto, `ws://${CONFIG.serverHostname}:${serverPort}`)
      if (client !== false) addPeer(client)
    }
  })
}
