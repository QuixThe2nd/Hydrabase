import type { ApiPeer, Connection, NodeStats } from '../types/hydrabase'
import type { MetadataPlugin } from '../types/hydrabase-schemas'
import type { Repositories } from './db'
import type { DHT_Node } from './networking/dht'
import type Peers from './Peers'

import { error } from '../utils/log'
import { CONFIG } from './config'

export class StatsReporter {
  constructor(
    private readonly address: `0x${string}`,
    private readonly plugins: MetadataPlugin[],
    private readonly peers: Peers,
    private readonly dht: DHT_Node,
    private readonly repos: Repositories,
    private readonly intervalMs = 10_000
  ) {
    this.report()
    setInterval(() => this.report(), this.intervalMs)
  }

  private collectStats(): NodeStats {
    return {
      dhtNodes: this.dht.nodes.map(({host,port}) => `${host}:${port}`),
      peers: {
        known:   this.knownPeers(),
        plugins: this.repos.stats.getKnownPlugins(),
        votes:   this.repos.stats.getPeerVotes(),
      },
      self: {
        address:  this.address,
        hostname: CONFIG.hostname,
        plugins:  this.plugins.map(p => p.id),
        votes:    this.repos.stats.getSelfVotes(),
      },
      timestamp: new Date().toISOString(),
    }
  }

  private readonly knownPeers = (): ApiPeer[] => {
    const addresses = this.repos.stats.getKnownAddresses()
    return addresses.map(address => ({
      address,
      connection: ((): Connection | undefined => {
        const peer = this.peers.connectedPeers.find(peer => peer.address === address)
        if (!peer) return peer
        return {
          address: peer.address,
          confidence: peer.historicConfidence,
          hostname: peer.hostname,
          latency: peer.latency,
          lookupTime: peer.lookupTime,
          plugins: peer.plugins,
          totalDL: peer.totalDL,
          totalUL: peer.totalUL,
          uptime: peer.uptimeMs,
          userAgent: peer.userAgent,
          username: peer.username,
          votes: {
            albums: 0,
            artists: 0,
            tracks: 0
          },
        }
      })(),
    } satisfies ApiPeer))
  }

  private report(): void {
    const client = this.peers.apiPeer
    try {
      if (client?.isOpened) client.sendStats(this.collectStats())
    } catch (err) {
      error('ERROR:', '[STATS] Failed to collect/send stats', {err})
    }
  }
}
