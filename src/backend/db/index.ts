import { Database } from 'bun:sqlite'
import { BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import fs from 'fs';

import { AlbumRepository } from './repositories/AlbumRepository';
import { ArtistRepository } from './repositories/ArtistRepository';
import { TrackRepository } from './repositories/TrackRepository';
import { schema } from './schema';

if (!(await Bun.file('data').exists())) {fs.mkdirSync('data', { recursive: true })}
const sqlite = new Database('data/db.sqlite')

export type DB = BunSQLiteDatabase<typeof schema>
export interface Repositories {
  album: AlbumRepository
  artist: ArtistRepository
  track: TrackRepository
}

export const startDatabase = (): { db: DB, repos: Repositories } => {
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: "./drizzle" });
  return {
    db,
    repos: {
      album: new AlbumRepository(db),
      artist: new ArtistRepository(db),
      track: new TrackRepository(db)
    }
  }
}
