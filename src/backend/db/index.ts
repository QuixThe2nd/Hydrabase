import { Database } from 'bun:sqlite'
import { BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import fs from 'fs';

import { AlbumRepository } from './repositories/AlbumRepository';
import { ArtistRepository } from './repositories/ArtistRepository';
import { PeerRepository } from './repositories/PeerRepository';
import { StatsRepository } from './repositories/StatsRepository';
import { TrackRepository } from './repositories/TrackRepository';
import { schema } from './schema';

if (!(await Bun.file('data').exists())) {fs.mkdirSync('data', { recursive: true })}
const sqlite = new Database('data/db.sqlite')

export type DB = BunSQLiteDatabase<typeof schema>
export interface Repositories {
  album: AlbumRepository
  artist: ArtistRepository
  peer: PeerRepository
  stats: StatsRepository
  track: TrackRepository
}

export const startDatabase = (): Repositories => {
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: "./drizzle" });
  return {
    album: new AlbumRepository(db),
    artist: new ArtistRepository(db),
    peer: new PeerRepository(db),
    stats: new StatsRepository(db),
    track: new TrackRepository(db),
  }
}
