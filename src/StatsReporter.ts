import { sql } from 'drizzle-orm'
import type { DB } from './db'
import type { MetadataPlugin } from './Metadata'
import type { Peer } from './networking/ws/peer'

export interface NodeStats {
  timestamp: string
  address: `0x${string}`
  plugins: string[]
  connectedPeers: number
  peers: Array<{
    address: `0x${string}`
    hostname: string | undefined
    historicConfidence: number
  }>
  dhtNodes: string
  cache: {
    tracks: number
    artists: number
    albums: number
  }
  peerData: {
    tracks: number
    artists: number
    albums: number
  }
}

const COUNT_CACHE_SQL = (table: 'tracks' | 'artists' | 'albums') => sql.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE address = '0x0'`)
const COUNT_PEER_SQL = (table: 'tracks' | 'artists' | 'albums') => sql.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE address != '0x0'`)

export class StatsReporter {
  private timer: ReturnType<typeof setInterval>

  constructor(
    private readonly address: `0x${string}`,
    private readonly plugins: MetadataPlugin[],
    private readonly getPeers: () => Record<`0x${string}`, Peer>,
    private readonly db: DB,
    private readonly intervalMs = 60_000
  ) {
    this.report()
    this.timer = setInterval(() => this.report(), this.intervalMs)
    console.log('LOG:', `Reporting stats every ${this.intervalMs / 1000}s`)
  }

  private collectStats(): NodeStats {
    const peers = this.getPeers()

    const countRow = (rawSql: ReturnType<typeof sql.raw>) => this.db.all<{ n: number }>(rawSql)[0]?.n ?? 0

    return {
      timestamp: new Date().toISOString(),
      address: this.address,
      plugins: this.plugins.map(p => p.id),
      connectedPeers: Object.keys(peers).filter(a => a !== '0x0').length,
      peers: Object.entries(peers)
        .filter(([address]) => address !== '0x0')
        .map(([, { address, hostname, historicConfidence }]) => ({ address, hostname, historicConfidence })),
      cache: {
        tracks:  countRow(COUNT_CACHE_SQL('tracks')),
        artists: countRow(COUNT_CACHE_SQL('artists')),
        albums:  countRow(COUNT_CACHE_SQL('albums')),
      },

      peerData: {
        tracks:  countRow(COUNT_PEER_SQL('tracks')),
        artists: countRow(COUNT_PEER_SQL('artists')),
        albums:  countRow(COUNT_PEER_SQL('albums')),
      },
    }
  }

  private async report(): Promise<void> {
    const client = this.getPeers()['0x0']
    try {
      const stats = this.collectStats()
      console.log('LOG:', `${client?.isOpened ? 'Sending stats to client - ' : ''}${stats.connectedPeers} peers, ${stats.cache.tracks + stats.peerData.tracks} tracks`)
      if (client?.isOpened) client.sendStats(stats)
    } catch (err) {
      console.error('ERROR:', 'StatsReporter failed to collect/send stats', err as any)
    }
  }
}