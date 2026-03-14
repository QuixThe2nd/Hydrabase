import { sql } from 'drizzle-orm'
import { Parser } from 'expr-eval'

import type { DB } from '..'
import type { PeerStats, PluginAccuracy } from '../../../types/hydrabase'
import type { MetadataPlugin } from '../../../types/hydrabase-schemas'

const avg = (numbers: number[]) => numbers.reduce((a, b) => a + b, 0) / numbers.length

export class PeerRepository {
  constructor(private readonly db: DB, private readonly pluginConfidenceFormula: string) {}

  collectPeerStats(address: `0x${string}`, installedPlugins: MetadataPlugin[]): PeerStats {
    const installedPluginIds = new Set(installedPlugins.map(p => p.id))
    const peerPlugins = this.getPlugins(address)
    let totalMatches = 0
    let totalMismatches = 0

    for (const table of ['tracks', 'artists', 'albums'] as const) {
      for (const { match, mismatch, plugin_id } of this.db.all<PluginAccuracy>(sql.raw(`
        SELECT peer.plugin_id, COUNT(local.id) AS match, COUNT(*) - COUNT(local.id) AS mismatch
        FROM ${table} peer
        LEFT JOIN ${table} local
          ON local.id = peer.id AND local.plugin_id = peer.plugin_id AND local.address = '0x0'
        WHERE peer.address = '${address}'
        GROUP BY peer.plugin_id
      `))) {
        if (installedPluginIds.has(plugin_id)) continue
        totalMatches += match
        totalMismatches += mismatch
      }
    }

    return {
      address,
      peerPlugins,
      sharedPlugins: peerPlugins.filter(pl => installedPluginIds.has(pl)),
      totalMatches,
      totalMismatches,
      votes: {
        albums:  this.countByAddress('albums',  address),
        artists: this.countByAddress('artists', address),
        tracks:  this.countByAddress('tracks',  address),
      },
    }
  }

  countByAddress(table: 'albums' | 'artists' | 'tracks', address: `0x${string}`): number {
    return this.db.all<{ n: number }>(
      sql.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE address = '${address}'`)
    )[0]?.n ?? 0
  }

  getHistoricConfidence(address: `0x${string}`, installedPlugins: MetadataPlugin[]): number {
    const rows = [
      ...this.getMatchStats('tracks',  address),
      ...this.getMatchStats('artists', address),
      ...this.getMatchStats('albums',  address),
    ]

    const merged: Record<string, { match: number; mismatch: number }> = {}
    for (const { match, mismatch, plugin_id } of rows) {
      if (!merged[plugin_id]) merged[plugin_id] = { match: 0, mismatch: 0 }
      merged[plugin_id].match    += match
      merged[plugin_id].mismatch += mismatch
    }

    const installedPluginIds = new Set(installedPlugins.map(p => p.id))
    const scores = Object.entries(merged)
      .filter(([pluginId]) => installedPluginIds.has(pluginId))
      .map(([, { match, mismatch }]) =>
        Parser.evaluate(this.pluginConfidenceFormula, { x: match, y: mismatch })
      )

    return scores.length > 0 ? avg(scores) : 0
  }

  getMatchStats(table: 'albums' | 'artists' | 'tracks', address: `0x${string}`): PluginAccuracy[] {
    return this.db.all<PluginAccuracy>(sql`
      SELECT peer.plugin_id, COUNT(local.id) AS match, COUNT(*) - COUNT(local.id) AS mismatch
      FROM ${sql.raw(table)} peer
      LEFT JOIN ${sql.raw(table)} local
        ON local.id = peer.id AND local.plugin_id = peer.plugin_id AND local.address = '0x0'
      WHERE peer.address = ${address}
      GROUP BY peer.plugin_id
    `)
  }

  getPlugins(address: `0x${string}`): string[] {
    return this.db.all<{ plugin_id: string }>(sql.raw(`
      SELECT DISTINCT plugin_id FROM tracks WHERE address = '${address}' AND confidence = 1
      UNION SELECT DISTINCT plugin_id FROM artists WHERE address = '${address}' AND confidence = 1
      UNION SELECT DISTINCT plugin_id FROM albums WHERE address = '${address}' AND confidence = 1
    `)).map(r => r.plugin_id)
  }
}
