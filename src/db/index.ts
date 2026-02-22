import { BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { schema } from './schema';
import { AlbumRepository } from './repositories/AlbumRepository';
import { ArtistRepository } from './repositories/ArtistRepository';
import { TrackRepository } from './repositories/TrackRepository';

const sqlite = new Database('db.sqlite')

export type DB = BunSQLiteDatabase<typeof schema>
export interface Repositories {
  track: TrackRepository
  album: AlbumRepository
  artist: ArtistRepository
}

export const startDatabase = (): Repositories => {
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: "./drizzle" });
  return {
    track: new TrackRepository(db),
    album: new AlbumRepository(db),
    artist: new ArtistRepository(db)
  }
}
