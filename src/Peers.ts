import Peer from './Peer'
import type { Request } from './Messages'
import type { SearchResult } from './Metadata'
import DHT from 'bittorrent-dht'
import krpc from 'k-rpc'

export default class Peers {
  private readonly peers: { [hostname: string]: Peer } = {}

  constructor(serverPort: number, dhtPort: number, dhtRoom: string) {
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

  public async requestAll<T extends string>(request: Request, hashes: Record<T, bigint>) {
    const results: { [peer: string]: { response: Record<T, SearchResult[]>, confidence: number } } = {} // TODO: treat conflicting responses as votes, so we dont need to distinguish between peers
    for (const hostname in this.peers) {
      const peer = this.peers[hostname]!
      const response = await peer.sendRequest(request)

      // Compare Results
      const responseMatches: Partial<Record<T, boolean>> = {}
      for (const id in response) {
        const result = response[id]!
        const hash = BigInt(Bun.hash(JSON.stringify(result)))
        if (id in hashes) responseMatches[id as T] = hashes[id as T] === hash;
      }

      // Calculate Certainty
      const validMatches = Object.entries(responseMatches).filter(([,matched]) => matched).map(([pluginId]) => pluginId).length
      const invalidMatches = Object.entries(responseMatches).filter(([,matched]) => !matched).map(([pluginId]) => pluginId).length
      const matches = validMatches + invalidMatches
      // const noMatches = Object.keys(hashes).length - matches;
      const confidence = validMatches / matches // TODO: record historical confidence levels and use as weighting for future confidence levels

      results[peer.hostname] = { response, confidence }
    }
    return results;
  }
}
