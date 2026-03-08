import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const track = sqliteTable('tracks', {
    address: text('address').notNull(),
    album: text('album').notNull(),
    artist_id: text('artist_id'),
    artists: text('artists').notNull(),
    confidence: real('confidence').notNull(),
    duration_ms: integer().notNull(),
    external_urls: text('external_urls').notNull(),
    id: text('id').notNull(),
    image_url: text('image_url').notNull(),
    name: text('name').notNull(),
    plugin_id: text('plugin_id').notNull(),
    popularity: integer().notNull(),
    preview_url: text('preview_url').notNull(),
    soul_id: text('soul_id').notNull(),
  }, table => [uniqueIndex('idx_plugin_track').on(table.plugin_id, table.id, table.address)])

export const artist = sqliteTable('artists', {
    address: text('address').notNull(),
    confidence: real('confidence').notNull(),
    external_urls: text('external_urls').notNull(),
    followers: integer('followers').notNull(),
    genres: text('genres').notNull(),
    id: text('id').notNull(),
    image_url: text('image_url').notNull(),
    name: text('name').notNull(),
    plugin_id: text('plugin_id').notNull(),
    popularity: integer('popularity').notNull(),
    soul_id: text('soul_id').notNull(),
  }, table => [uniqueIndex('idx_plugin_artist').on(table.plugin_id, table.id, table.address)])

export const album = sqliteTable('albums', {
    address: text('address').notNull(),
    album_type: text('album_type'),
    artist_id: text('artist_id'),
    artists: text('artists'),
    confidence: real('confidence').notNull(),
    external_urls: text('external_urls'),
    id: text('id').notNull(),
    image_url: text('image_url'),
    name: text('name'),
    plugin_id: text('plugin_id').notNull(),
    release_date: text('release_date'),
    soul_id: text('soul_id').notNull(),
    total_tracks: integer('total_tracks'),
  }, table => [uniqueIndex('idx_plugin_album').on(table.plugin_id, table.id, table.address)])

export const soul = sqliteTable('soul', {
    address: text('address').notNull(),
    idA: text('idA').notNull(),
    idB: text('idB').notNull(),
    plugin_idA: text('plugin_idA').notNull(),
    plugin_idB: text('plugin_idB').notNull(),
    soul_id: text('soul_id').notNull(),
  }, table => [uniqueIndex('idx_soul').on(table.plugin_idA, table.plugin_idB, table.address)])
export const schema = { album, artist, soul, track } as const
// Bunx drizzle-kit generate --dialect sqlite --schema ./src/db/schema.ts
