import DHT from 'bittorrent-dht'
import krpc from 'k-rpc'
import { portForward } from './upnp'

const knownPeers = new Set<`${string}:${number}`>();

export const discoverPeers = (serverPort: number, dhtPort: number, dhtRoom: string, addPeer: (hostname: `ws://${string}`) => void) => {
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
    dht.announce(dhtRoom, serverPort, err => { if (err) console.error('ERROR:', 'DHT threw an error during announce', err) })
    dht.lookup(dhtRoom, err => { if (err) console.error('ERROR:', 'DHT threw an error during lookup', err) })
    dht.addNode({ host: 'ddns.yazdani.au', port: 30000 })
    dht.addNode({ host: 'ddns.yazdani.au', port: 40000 })
  })
  // dht.on('node', node => console.log('LOG:', `Discovered DHT node ${node.host}:${node.port}`))
  dht.on('peer', peer => {
    if (knownPeers.has(`${peer.host}:${peer.port}`)) return
    knownPeers.add(`${peer.host}:${peer.port}`)
    console.log('LOG:', `Discovered peer via DHT ${peer.host}:${peer.port}`)
    addPeer(`ws://${peer.host}:${peer.port}`)
  })
  dht.on('announce', (peer, _infoHash) => {
    if (knownPeers.has(`${peer.host}:${peer.port}`)) return
    const infoHash = _infoHash.toString('hex')
    if (infoHash === dhtRoom) {
      knownPeers.add(`${peer.host}:${peer.port}`)
      console.log('LOG:', `Received announce from ${peer.host}:${peer.port} on ${infoHash}`)
      addPeer(`ws://${peer.host}:${peer.port}`)
    }
  })
}
