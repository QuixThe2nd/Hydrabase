import { schema } from '../schema'
import type { AlbumSearchResult } from '../../Metadata'
import type { DB } from '..'

export class AlbumRepository {
  constructor(private readonly db: DB) {}

  upsertFromPlugin(result: AlbumSearchResult) {
    this.db.insert(schema.album).values({
      ...result,
      artists: result.artists.join(','),
      external_urls: JSON.stringify(result.external_urls),
      address: '0x0',
      confidence: 1,
    }).onConflictDoNothing().run()
  }

  upsertFromPeer(result: AlbumSearchResult, peerAddress: `0x${string}`) {
    this.db.insert(schema.album).values({
      ...result,
      artists: result.artists.join(','),
      external_urls: JSON.stringify(result.external_urls),
      address: peerAddress,
    }).onConflictDoNothing().run()
  }
}
