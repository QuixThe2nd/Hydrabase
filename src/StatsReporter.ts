import { sql } from 'drizzle-orm'
import type { DB } from './db'
import type { MetadataPlugin } from './Metadata'
import type { Peer } from './networking/ws/peer'
import type { DHTNode } from 'bittorrent-dht'

export interface ApiPeer {
  status: "connected" | "disconnected";
  address: `0x${string}`
  hostname: string | undefined
  confidence: number
  latency: number
  uptime: number
  rxTotal: number
  txTotal: number
  plugins: string[]
}

export interface NodeStats {
  timestamp: string
  address: `0x${string}`
  installedPlugins: string[]
  knownPlugins: string[]
  knownPeers: `0x${string}`[]
  connectedPeers: number
  peers: ApiPeer[]
  dhtNodes: string[]
  votes: {
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

const COUNT_VOTES_SQL = (table: 'tracks' | 'artists' | 'albums') => sql.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE address = '0x0'`)
const COUNT_PEER_SQL = (table: 'tracks' | 'artists' | 'albums') => sql.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE address != '0x0'`)

export class StatsReporter {
  constructor(
    private readonly address: `0x${string}`,
    private readonly plugins: MetadataPlugin[],
    private readonly getPeers: () => Record<`0x${string}`, Peer>,
    private readonly db: DB,
    private readonly dht: { getNodes: () => DHTNode[] },
    private readonly intervalMs = 10_000
  ) {
    this.report()
    setInterval(() => this.report(), this.intervalMs)
    console.log('LOG:', `Reporting stats every ${this.intervalMs / 1000}s`)
  }

  private async collectStats(): Promise<NodeStats> {
    const peers = this.getPeers()

    const countRow = (rawSql: ReturnType<typeof sql.raw>) => this.db.all<{ n: number }>(rawSql)[0]?.n ?? 0

    return {
      timestamp: new Date().toISOString(),
      address: this.address,
      installedPlugins: this.plugins.map(p => p.id),
      knownPlugins: this.knownPlugins(),
      knownPeers: this.knownPeers(),
      connectedPeers: Object.keys(peers).filter(a => a !== '0x0').length,
      peers: await Promise.all(Object.entries(peers)
        .filter(([address]) => address !== '0x0')
        .map(async ([, { address, hostname, historicConfidence, averageLatencyMs, uptimeMs, rxTotal, txTotal, isOpened, plugins }]) => (
          { address, hostname, confidence: historicConfidence, latency: averageLatencyMs, uptime: uptimeMs, rxTotal, txTotal, status: isOpened ? 'connected' : 'disconnected', plugins: plugins.map(({id}) => id) }
        ))),
      votes: {
        tracks:  countRow(COUNT_VOTES_SQL('tracks')),
        artists: countRow(COUNT_VOTES_SQL('artists')),
        albums:  countRow(COUNT_VOTES_SQL('albums')),
      },
      dhtNodes: this.dht.getNodes().map(({host,port}) => `${host}:${port}`),
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
      const stats = await this.collectStats()
      console.log('LOG:', `${client?.isOpened ? 'Sending stats to client - ' : ''}${stats.connectedPeers} peers, ${stats.votes.tracks + stats.peerData.tracks} track votes`)
      if (client?.isOpened) client.sendStats(stats)
    } catch (err) {
      console.error('ERROR:', 'StatsReporter failed to collect/send stats', err)
    }
  }

  private knownPlugins(): string[] {
    const rows = this.db.all<{ plugin_id: string }>(sql.raw(`
      SELECT DISTINCT plugin_id FROM tracks
      UNION
      SELECT DISTINCT plugin_id FROM artists
      UNION
      SELECT DISTINCT plugin_id FROM albums
    `))
    return rows.map(r => r.plugin_id)
  }

  private knownPeers(): `0x${string}`[] {
    const rows = this.db.all<{ address: `0x${string}` }>(sql.raw(`
      SELECT DISTINCT address FROM tracks
      UNION
      SELECT DISTINCT address FROM artists
      UNION
      SELECT DISTINCT address FROM albums
    `))
    return rows.map(r => r.address)
  }
}