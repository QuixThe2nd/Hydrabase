import { and, eq, like, or } from 'drizzle-orm'

import type { DB } from '..'
import type { Album } from '../../../types/hydrabase-schemas'

import { schema } from '../schema'

export class AlbumRepository {
  constructor(private readonly db: DB) {}

  lookupByArtistIds(artistIds: Map<string, string>, includePeers = true): Album[] {
    return this.db.select().from(schema.album)
      .where(and(or(...artistIds.entries().map(([pluginId, artistId]) => and(eq(schema.album.plugin_id, pluginId), eq(schema.album.artist_id, artistId)))), includePeers ? undefined : eq(schema.album.address, '0x0')))
      .all()
      .filter(row => row.name && row.image_url && row.external_urls)
      .map(row => ({
        ...row,
        address: row.address as `0x${string}`,
        album_type: row.album_type ?? '',
        artists: row.artists?.split(',') ?? [],
        external_urls: JSON.parse(row.external_urls ?? ''),
        image_url: row.image_url ?? '',
        name: row.name ?? '',
        release_date: row.release_date ?? '',
        total_tracks: row.total_tracks ?? 0,
      }))
  }
  
  lookupBySoulId(soulId: string, includePeers = true): Album[] {
    return this.db.select().from(schema.album)
      .where(and(eq(schema.album.soul_id, soulId), includePeers ? undefined : eq(schema.album.address, '0x0')))
      .all()
      .map(row => ({
        ...row,
        address: row.address as `0x${string}`,
        album_type: row.album_type ?? '',
        artists: row.artists?.split(',') ?? [],
        external_urls: JSON.parse(row.external_urls ?? ''),
        image_url: row.image_url ?? '',
        name: row.name ?? '',
        release_date: row.release_date ?? '',
        total_tracks: row.total_tracks ?? 0,
      }))
  }

  searchByName(query: string, includePeers = true): Album[] {
    return this.db.select().from(schema.album)
      .where(and(like(schema.album.name, `%${query}%`), includePeers ? undefined : eq(schema.album.address, '0x0')))
      .all()
      .filter(row => row.name && row.image_url && row.external_urls) // Nullable cols
      .map(row => ({
        ...row,
        address: row.address as `0x${string}`,
        album_type: row.album_type ?? '',
        artists: row.artists?.split(',') ?? [],
        external_urls: JSON.parse(row.external_urls ?? ''),
        image_url: row.image_url ?? '',
        name: row.name ?? '',
        release_date: row.release_date ?? '',
        total_tracks: row.total_tracks ?? 0,
      }))
  }
  
  upsertFromPeer(result: Album, peerAddress: `0x${string}`) {
    const set = {
      ...result,
      address: peerAddress,
      artists: result.artists.join(','),
      external_urls: JSON.stringify(result.external_urls),
    }
    this.db.insert(schema.album).values(set).onConflictDoUpdate({ set, target: [schema.album.id, schema.album.plugin_id, schema.album.address] }).run()
  }

  upsertFromPlugin(result: Album) {
    const set = {
      ...result,
      address: '0x0',
      artists: result.artists.join(','),
      confidence: 1,
      external_urls: JSON.stringify(result.external_urls),
    }
    this.db.insert(schema.album).values(set).onConflictDoUpdate({ set, target: [schema.album.id, schema.album.plugin_id, schema.album.address] }).run()
  }
}
