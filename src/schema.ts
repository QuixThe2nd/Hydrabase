import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const schema = {
  track: sqliteTable('tracks', {
    id: text('id').notNull(),
    plugin_id: text('plugin_id').notNull(),
    name: text('name').notNull(),
    artists: text('artists').notNull(),
    album: text('album').notNull(),
    duration_ms: integer().notNull(),
    popularity: integer().notNull(),
    preview_url: text('preview_url').notNull(),
    external_urls: text('external_urls').notNull(),
    image_url: text('image_url').notNull(),
    address: text('address').notNull(),
    confidence: integer('confidence').notNull(),
  }, table => [uniqueIndex('idx_plugin_track').on(table.plugin_id, table.id, table.address)]),
  artist: sqliteTable('artists', {
    id: text('id').notNull(),
    plugin_id: text('plugin_id').notNull(),
    name: text('name').notNull(),
    popularity: integer('popularity').notNull(),
    genres: text('genres').notNull(),
    followers: integer('followers').notNull(),
    external_urls: text('external_urls').notNull(),
    image_url: text('image_url').notNull(),
    address: text('address').notNull(),
    confidence: integer('confidence').notNull(),
  }, table => [uniqueIndex('idx_plugin_artist').on(table.plugin_id, table.id, table.address)]),
  album: sqliteTable('albums', {
    id: text('id').notNull(),
    plugin_id: text('plugin_id').notNull(),
    name: text('name'),
    artists: text('artists'),
    release_date: text('release_date'),
    total_tracks: integer('total_tracks'),
    album_type: text('album_type'),
    image_url: text('image_url'),
    external_urls: text('external_urls'),
    address: text('address').notNull(),
    confidence: integer('confidence').notNull(),
  }, table => [uniqueIndex('idx_plugin_album').on(table.plugin_id, table.id, table.address)])
} as const
// bunx drizzle-kit generate --dialect sqlite --schema ./src/schema.ts
