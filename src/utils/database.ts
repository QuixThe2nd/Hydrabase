import { drizzle } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { schema } from '../schema';

const sqlite = new Database('db.sqlite')

export const startDatabase = () => {
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: "./drizzle" });
  return db
}
