import { schema } from '../schema'
import type { TrackSearchResult } from '../../Metadata'
import type { DB } from '..'

export class TrackRepository {
  constructor(private readonly db: DB) {}

  upsertFromPlugin(result: TrackSearchResult) {
    this.db.insert(schema.track).values({
      ...result,
      artists: result.artists.join(','),
      external_urls: JSON.stringify(result.external_urls),
      address: '0x0',
      confidence: 1,
    }).onConflictDoNothing().run()
  }

  upsertFromPeer(result: TrackSearchResult, peerAddress: `0x${string}`) {
    this.db.insert(schema.track).values({
      ...result,
      artists: result.artists.join(','),
      external_urls: JSON.stringify(result.external_urls),
      address: peerAddress,
    }).onConflictDoNothing().run()
  }
}
