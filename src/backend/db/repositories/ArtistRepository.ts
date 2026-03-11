import { and, eq, like } from 'drizzle-orm'

import type { DB } from '..'
import type { Artist } from '../../../types/hydrabase-schemas'

import { schema } from '../schema'

export class ArtistRepository {
  constructor(private readonly db: DB) {}

  lookupBySoulId(soulId: string, includePeers = true): Artist[] {
    return this.db.select().from(schema.artist)
      .where(and(eq(schema.artist.soul_id, soulId), includePeers ? undefined : eq(schema.artist.address, '0x0')))
      .all()
      .map(row => ({
        ...row,
        address: row.address as `0x${string}`,
        external_urls: JSON.parse(row.external_urls),
        genres: row.genres.split(','),
      }))
  }

  searchByName(query: string, includePeers = true): Artist[] {
    return this.db.select().from(schema.artist)
      .where(and(like(schema.artist.name, `%${query}%`), includePeers ? undefined : eq(schema.artist.address, '0x0')))
      .all()
      .map(row => ({
        ...row,
        address: row.address as `0x${string}`,
        external_urls: JSON.parse(row.external_urls),
        genres: row.genres.split(','),
      }))
  }

  upsertFromPeer(result: Artist, peerAddress: `0x${string}`) {
    const set = {
      ...result,
      address: peerAddress,
      external_urls: JSON.stringify(result.external_urls),
      genres: result.genres.join(','),
    }
    this.db.insert(schema.artist).values(set).onConflictDoUpdate({ set, target: [schema.artist.id, schema.artist.plugin_id, schema.artist.address] }).run()
  }

  upsertFromPlugin(result: Artist) {
    const set = {
      ...result,
      address: '0x0',
      confidence: 1,
      external_urls: JSON.stringify(result.external_urls),
      genres: result.genres.join(','),
    }
    this.db.insert(schema.artist).values(set).onConflictDoUpdate({ set, target: [schema.artist.id, schema.artist.plugin_id, schema.artist.address] }).run()
  }
}
