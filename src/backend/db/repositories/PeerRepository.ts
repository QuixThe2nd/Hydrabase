import { sql } from 'drizzle-orm'
import { Parser } from 'expr-eval'

import type { DB } from '..'
import type { PeerStats, PluginAccuracy } from '../../../types/hydrabase'
import type { MetadataPlugin } from '../../../types/hydrabase-schemas'

const avg = (numbers: number[]) => numbers.reduce((a, b) => a + b, 0) / numbers.length

export class PeerRepository {
  constructor(private readonly db: DB, private pluginConfidenceFormula: string) {}

  accumulateSessionStats(address: `0x${string}`, sessionUL: number, sessionDL: number): void {
    try {
      this.db.run(sql.raw(`
        INSERT INTO peer_stats (address, lifetime_ul, lifetime_dl) 
        VALUES ('${address}', ${sessionUL}, ${sessionDL})
        ON CONFLICT(address) DO UPDATE SET
          lifetime_ul = lifetime_ul + ${sessionUL},
          lifetime_dl = lifetime_dl + ${sessionDL}
      `))
    } catch {
      // Table might not exist on old databases; will be created on next migration
    }
  }

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

  getConnectionCount(address: `0x${string}`): number {
    try {
      const result = this.db.all<{ count: number }>(sql.raw(`
        SELECT COUNT(DISTINCT announcer_address) AS count FROM announced_peers 
        WHERE announced_address = '${address}'
      `))
      return result[0]?.count ?? 0
    } catch {
      // Table might not exist on old databases
      return 0
    }
  }

  getConnections(address: `0x${string}`): `0x${string}`[] {
    try {
      const result = this.db.all<{ announcer_address: string }>(sql.raw(`
        SELECT DISTINCT announcer_address FROM announced_peers 
        WHERE announced_address = '${address}'
      `))
      return result.map(r => r.announcer_address as `0x${string}`)
    } catch {
      // Table might not exist on old databases
      return []
    }
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

  getLifetimeStats(address: `0x${string}`): { lifetimeDL: number; lifetimeUL: number } {
    try {
      const [result] = this.db.all<{ lifetime_dl: number; lifetime_ul: number }>(sql.raw(`
        SELECT lifetime_dl, lifetime_ul FROM peer_stats WHERE address = '${address}'
      `))
      return result ? { lifetimeDL: result.lifetime_dl, lifetimeUL: result.lifetime_ul } : { lifetimeDL: 0, lifetimeUL: 0 }
    } catch {
      // Table might not exist on old databases; will be created on next migration
      return { lifetimeDL: 0, lifetimeUL: 0 }
    }
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

  recordAnnouncement(announcedAddress: `0x${string}`, announcerAddress: `0x${string}`): void {
    try {
      this.db.run(sql.raw(`
        INSERT INTO announced_peers (announced_address, announcer_address, timestamp) 
        VALUES ('${announcedAddress}', '${announcerAddress}', ${Date.now()})
        ON CONFLICT(announcer_address, announced_address) DO UPDATE SET
          timestamp = ${Date.now()}
      `))
    } catch {
      // Table might not exist on old databases; will be created on next migration
    }
  }

  setPluginConfidenceFormula(formula: string): void {
    this.pluginConfidenceFormula = formula
  }
}
