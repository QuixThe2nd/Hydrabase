import { drizzle } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'
import { tracks, artists, albums, votes } from './schema'

export const startDatabase = () => drizzle(new Database('db.sqlite'), { schema: { tracks, artists, albums, votes } })
