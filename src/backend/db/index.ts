import { Database } from 'bun:sqlite'
import { BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import fs from 'fs'

import { AlbumRepository } from './repositories/AlbumRepository'
import { ArtistRepository } from './repositories/ArtistRepository'
import { AuthenticatedPeerRepository } from './repositories/AuthenticatedPeerRepository'
import { DhtNodeRepository } from './repositories/DhtNodeRepository'
import { PeerRepository } from './repositories/PeerRepository'
import { SearchHistoryRepository } from './repositories/SearchHistoryRepository'
import { SettingsRepository } from './repositories/SettingsRepository'
import { StatsRepository } from './repositories/StatsRepository'
import { TrackRepository } from './repositories/TrackRepository'
import { WsServerRepository } from './repositories/WsServerRepository'
import { schema } from './schema'

export type DB = BunSQLiteDatabase<typeof schema>
export interface Repositories {
  album: AlbumRepository
  artist: ArtistRepository
  authenticatedPeer: AuthenticatedPeerRepository
  dhtNode: DhtNodeRepository
  onVotesChanged: (handler: () => void) => void
  peer: PeerRepository
  searchHistory: SearchHistoryRepository
  settings: SettingsRepository
  stats: StatsRepository
  track: TrackRepository
  wsServer: WsServerRepository
}

export const startDatabase = async (pluginConfidenceFormula: string): Promise<Repositories> => {
  if (!(await Bun.file('data').exists())) fs.mkdirSync('data', { recursive: true })
  const sqlite = new Database('data/db.sqlite')
  sqlite.run('PRAGMA busy_timeout = 5000')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './drizzle' })
  const album = new AlbumRepository(db)
  const artist = new ArtistRepository(db)
  const track = new TrackRepository(db)
  const onVotesChanged = (handler: () => void): void => {
    album.onChanged(handler)
    artist.onChanged(handler)
    track.onChanged(handler)
  }
  return {
    album,
    artist,
    authenticatedPeer: new AuthenticatedPeerRepository(db),
    dhtNode: new DhtNodeRepository(db),
    onVotesChanged,
    peer: new PeerRepository(db, pluginConfidenceFormula),
    searchHistory: new SearchHistoryRepository(db),
    settings: new SettingsRepository(db),
    stats: new StatsRepository(db),
    track,
    wsServer: new WsServerRepository(db),
  }
}
