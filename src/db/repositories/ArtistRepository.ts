import { schema } from '../schema'
import type { ArtistSearchResult } from '../../Metadata'
import type { DB } from '..'

export class ArtistRepository {
  constructor(private readonly db: DB) {}

  upsertFromPlugin(result: ArtistSearchResult) {
    this.db.insert(schema.artist).values({
      ...result,
      genres: result.genres.join(','),
      external_urls: JSON.stringify(result.external_urls),
      address: '0x0',
      confidence: Number.MAX_SAFE_INTEGER,
    }).onConflictDoNothing().run()
  }

  upsertFromPeer(result: ArtistSearchResult, peerAddress: `0x${string}`) {
    this.db.insert(schema.artist).values({
      ...result,
      genres: result.genres.join(','),
      external_urls: JSON.stringify(result.external_urls),
      address: peerAddress,
    }).onConflictDoNothing().run()
  }
}
