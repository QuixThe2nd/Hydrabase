import DHT from 'bittorrent-dht'
import krpc from 'k-rpc'
import { portForward } from './upnp'
import WebSocketClient from './ws/client';
import type { WebSocketServerConnection } from './ws/server';

export const discoverPeers = (serverPort: number, dhtPort: number, dhtRoom: string, addPeer: (peer: WebSocketClient | WebSocketServerConnection) => void) => {
  portForward(dhtPort, 'Hydrabase (UDP)', 'UDP');
  const dht = new DHT({
    krpc: krpc(),
    bootstrap: ['router.bittorrent.com:6881', 'router.utorrent.com:6881', 'dht.transmissionbt.com:6881']
  })
  dht.listen(dhtPort, '0.0.0.0', () => console.log(`DHT Listening on port ${dhtPort}`))
  dht.on('error', err => console.error(err))
  dht.on('warning', warning => console.warn(warning))
  dht.on('ready', () => {
    console.log('DHT ready, nodes in table:', dht.toJSON().nodes.map(peer => `${peer.host}:${peer.port}`))
    // dht.announce(dhtRoom, serverPort, err => { if (err) console.error(err) })
    dht.lookup(dhtRoom, err => { if (err) console.error(err) })
  })
  dht.on('node', node => console.log(`New DHT node ${node.host}:${node.port}`))
  dht.on('peer', peer => addPeer(new WebSocketClient(`ws://${peer.host}:${peer.port}`)))
  dht.on('announce', (peer, infoHash) => console.log('announce', peer, infoHash))
}
