import { sql } from 'drizzle-orm'

import type { DB } from './db'
import type { MetadataPlugin } from './Metadata'
import type { DHT_Node } from './networking/dht'
import type Peers from './Peers'

import { CONFIG } from './config'
import { error } from './log'

export interface ApiPeer {
  address: `0x${string}`
  connection: Connection | undefined
}

export interface Connection {
  confidence: number
  hostname: string
  latency: number
  lookupTime: number
  plugins: string[]
  totalDL: number
  totalUL: number
  uptime: number
  userAgent: string
  username: string
  votes: Votes
}

export interface NodeStats {
  dhtNodes: string[]
  peers: {
    known: ApiPeer[]
    plugins: string[]
    votes: Votes
  }
  self: {
    address: `0x${string}`
    hostname: string
    plugins: string[]
    votes: Votes
  }
  timestamp: string
}

export interface Votes {
  albums: number
  artists: number
  tracks: number
}

const countVotesSql = (table: 'albums' | 'artists' | 'tracks') => sql.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE address = '0x0'`)
const countPeerSql = (table: 'albums' | 'artists' | 'tracks') => sql.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE address != '0x0'`)

export class StatsReporter {
  constructor(
    private readonly address: `0x${string}`,
    private readonly plugins: MetadataPlugin[],
    private readonly peers: Peers,
    private readonly dht: DHT_Node,
    private readonly db: DB,
    private readonly intervalMs = 10_000
  ) {
    this.report()
    setInterval(() => this.report(), this.intervalMs)
  }

  private collectStats(): NodeStats {
    const countRow = (rawSql: ReturnType<typeof sql.raw>) => this.db.all<{ n: number }>(rawSql)[0]?.n ?? 0

    return {
      dhtNodes: this.dht.nodes.map(({host,port}) => `${host}:${port}`),
      peers: {
        known: this.knownPeers(),
        plugins: this.knownPlugins(),
        votes: {
          albums:  countRow(countPeerSql('albums')),
          artists: countRow(countPeerSql('artists')),
          tracks:  countRow(countPeerSql('tracks')),
        }
      },
      self: {
        address: this.address,
        hostname: CONFIG.domainName ?? CONFIG.externalIp,
        plugins: this.plugins.map(p => p.id),
        votes: {
          albums:  countRow(countVotesSql('albums')),
          artists: countRow(countVotesSql('artists')),
          tracks:  countRow(countVotesSql('tracks')),
        },
      },
      timestamp: new Date().toISOString(),
    }
  }

  private readonly knownPeers = (): ApiPeer[] => {
    const addresses = this.db.all<{ address: `0x${string}` }>(sql.raw(`SELECT DISTINCT address FROM tracks
      UNION SELECT DISTINCT address FROM artists
      UNION SELECT DISTINCT address FROM albums`)).map(r => r.address)
    return addresses.map(address => ({
      address,
      connection: ((): Connection | undefined => {
        const peer = this.peers.connectedPeers.find(peer => peer.address === address)
        if (!peer) return peer
        return {
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
          votes: peer.votes,
        }
      })(),
    } satisfies ApiPeer))
  }

  private readonly knownPlugins = (): string[] => this.db.all<{ plugin_id: string }>(sql.raw(`SELECT DISTINCT plugin_id FROM tracks
    UNION SELECT DISTINCT plugin_id FROM artists
    UNION SELECT DISTINCT plugin_id FROM albums`)).map(r => r.plugin_id)

  private report(): void {
    const client = this.peers.apiPeer
    try {
      if (client?.isOpened) client.sendStats(this.collectStats())
    } catch (err) {
      error('ERROR:', '[STATS] Failed to collect/send stats', {err})
    }
  }
}
