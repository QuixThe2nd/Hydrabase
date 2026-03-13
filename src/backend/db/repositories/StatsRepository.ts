import { sql } from 'drizzle-orm'

import type { DB } from '..'
import type { Votes } from '../../../types/hydrabase'

export class StatsRepository {
  constructor(private readonly db: DB) {}

  countPeerVotes(table: 'albums' | 'artists' | 'tracks'): number {
    return this.db.all<{ n: number }>(
      sql.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE address != '0x0'`)
    )[0]?.n ?? 0
  }

  countSelfVotes(table: 'albums' | 'artists' | 'tracks'): number {
    return this.db.all<{ n: number }>(
      sql.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE address = '0x0'`)
    )[0]?.n ?? 0
  }

  getKnownAddresses(): `0x${string}`[] {
    return this.db.all<{ address: `0x${string}` }>(sql.raw(`
      SELECT DISTINCT address FROM tracks
      UNION SELECT DISTINCT address FROM artists
      UNION SELECT DISTINCT address FROM albums
    `)).map(r => r.address)
  }

  getKnownPlugins(): string[] {
    return this.db.all<{ plugin_id: string }>(sql.raw(`
      SELECT DISTINCT plugin_id FROM tracks
      UNION SELECT DISTINCT plugin_id FROM artists
      UNION SELECT DISTINCT plugin_id FROM albums
    `)).map(r => r.plugin_id)
  }

  getPeerVotes(): Votes {
    return {
      albums:  this.countPeerVotes('albums'),
      artists: this.countPeerVotes('artists'),
      tracks:  this.countPeerVotes('tracks'),
    }
  }

  getSelfVotes(): Votes {
    return {
      albums:  this.countSelfVotes('albums'),
      artists: this.countSelfVotes('artists'),
      tracks:  this.countSelfVotes('tracks'),
    }
  }
}
