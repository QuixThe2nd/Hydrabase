import { and, eq, like, or } from 'drizzle-orm'

import type { DB } from '..'
import type { Track } from '../../../types/hydrabase-schemas'

import { schema } from '../schema'

export class TrackRepository {
  constructor(private readonly db: DB) {}

  lookupByArtistIds(artistIds: Map<string, string>, includePeers = true): Track[] {
    return this.db.select().from(schema.track)
      .where(and(or(...artistIds.entries().map(([pluginId, artistId]) => and(eq(schema.track.plugin_id, pluginId), eq(schema.track.artist_id, artistId)))), includePeers ? undefined : eq(schema.track.address, '0x0')))
      .all()
      .filter(row => row.name && row.image_url && row.external_urls)
      .map(row => ({
        ...row,
        address: row.address as `0x${string}`,
        artists: row.artists.split(','),
        external_urls: JSON.parse(row.external_urls),
      }))
  }

  searchByName(query: string, includePeers = true): Track[] {
    return this.db.select().from(schema.track)
      .where(and(like(schema.track.name, `%${query}%`), includePeers ? undefined : eq(schema.track.address, '0x0')))
      .all()
      .map(row => ({
        ...row,
        address: row.address as `0x${string}`,
        artists: row.artists.split(','),
        external_urls: JSON.parse(row.external_urls),
      }))
  }

  upsertFromPeer(result: Track, peerAddress: `0x${string}`) {
    const set = {
      ...result,
      address: peerAddress,
      artists: result.artists.join(','),
      external_urls: JSON.stringify(result.external_urls),
    }
    this.db.insert(schema.track).values(set).onConflictDoUpdate({ set, target: [schema.track.id, schema.track.plugin_id, schema.track.address] }).run()
  }
    
  upsertFromPlugin(result: Track) {
    const set = {
      ...result,
      address: '0x0',
      artists: result.artists.join(','),
      confidence: 1,
      external_urls: JSON.stringify(result.external_urls),
    }
    this.db.insert(schema.track).values(set).onConflictDoUpdate({ set, target: [schema.track.id, schema.track.plugin_id, schema.track.address] }).run()
  }
}
