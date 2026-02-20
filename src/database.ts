import { drizzle } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { tracks, artists, albums } from './schema';

const sqlite = new Database('db.sqlite')

export const startDatabase = () => {
  const db = drizzle(sqlite, { schema: { tracks, artists, albums } })
  migrate(db, { migrationsFolder: "./drizzle" });
  return db
}
