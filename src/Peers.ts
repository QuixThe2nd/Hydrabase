import Peer from './Peer'
import type { Request } from './Messages'
import type { SearchResult } from './Metadata'

export default class Peers {
  private readonly peers: Peer[] = []

  constructor(hostnames: string[]) {
    for (const hostname of hostnames) this.peers.push(new Peer(hostname))
  }

  async requestAll<T extends string>(request: Request, hashes: Record<T, bigint>) {
    const results: { [peer: string]: { response: Record<T, SearchResult[]>, confidence: number } } = {} // TODO: treat conflicting responses as votes, so we dont need to distinguish between peers
    for (const peer of this.peers) {
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

      results[peer.hostname] = {
        response,
        confidence
      }
    }
    return results;
  }
}
