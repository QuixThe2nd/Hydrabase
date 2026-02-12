import Peer from './Peer'
import type { Request } from './Messages'
import type { SearchResult } from './Metadata'
import DHT from 'bittorrent-dht'
import krpc from 'k-rpc'
import { portForward } from '.'

export default class Peers {
  private readonly peers: { [hostname: string]: Peer } = {}

  constructor(serverPort: number, dhtPort: number, dhtRoom: string) {
    portForward(dhtPort, 'Hydrabase DHT', 'UDP');
    const dht = new DHT({ krpc: krpc() })
    dht.listen(dhtPort, '0.0.0.0', () => {
      console.log(`DHT Listening on port ${dhtPort}`)
      dht.announce(dhtRoom, serverPort, err => { if (err) console.error(err) })
      dht.lookup(dhtRoom, (err) => { if (err) console.error(err) })
    })
    dht.on('peer', peer => this.addPeer(`ws://${peer.host}:${peer.port}`))
  }

  public addPeer(hostname: string) {
    if (!(hostname in this.peers)) this.peers[hostname] = new Peer(hostname)
  }

  public async requestAll<P extends string>(request: Request, hashes: Record<P, bigint>) {
    const results: { [plugin: string]: { [hash: number]: { result: SearchResult[], confidence: { current: number, historic: number }[] } } } = {}
    for (const hostname in this.peers) {
      const peer = this.peers[hostname]!
      const response = await peer.sendRequest(request)

      // Compare Results
      const responseHashes: Record<string, bigint> = {}
      const responseMatches: Partial<Record<P, boolean>> = {}
      for (const pluginId in response) {
        const result = response[pluginId]!
        const hash = BigInt(Bun.hash(JSON.stringify(result)))
        responseHashes[pluginId] = hash;
        if (pluginId in hashes) responseMatches[pluginId as P] = hashes[pluginId as P] === hash;
      }

      // Calculate Certainty
      const validMatches = Object.entries(responseMatches).filter(([,matched]) => matched).map(([pluginId]) => pluginId).length
      const invalidMatches = Object.entries(responseMatches).filter(([,matched]) => !matched).map(([pluginId]) => pluginId).length
      const matches = validMatches + invalidMatches
      // const noMatches = Object.keys(hashes).length - matches;
      const confidence = validMatches / matches
      peer.points += confidence;

      for (const pluginId in response) {
        const hash = responseHashes[pluginId]!;
        const result = response[pluginId]!;
        if (!(pluginId in results)) results[pluginId] = {}
        results[pluginId]![Number(hash)] = { result, confidence: [...results[pluginId]![Number(hash)]?.confidence ?? [], { current: confidence, historic: peer.points }] }
      }
    }
    return results;
  }
}
