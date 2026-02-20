import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const tracks = sqliteTable('tracks', {
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
}, table => [uniqueIndex('idx_plugin_track').on(table.plugin_id, table.id)])

export const artists = sqliteTable('artists', {
  id: text('id').notNull(),
  plugin_id: text('plugin_id').notNull(),
  name: text('name').notNull(),
  popularity: integer('popularity').notNull(),
  genres: text('genres').notNull(),
  followers: integer('followers').notNull(),
  external_urls: text('external_urls').notNull(),
  image_url: text('image_url').notNull(),
}, table => [uniqueIndex('idx_plugin_artist').on(table.plugin_id, table.id)])

export const albums = sqliteTable('albums', {
  id: text('id').notNull(),
  plugin_id: text('plugin_id').notNull(),
  name: text('name'),
  artists: text('artists'),
  release_date: text('release_date'),
  total_tracks: integer('total_tracks'),
  album_type: text('album_type'),
  image_url: text('image_url'),
  external_urls: text('external_urls'),
}, table => [uniqueIndex('idx_plugin_album').on(table.plugin_id, table.id)])

export const votes = sqliteTable('votes', {
  type: text('type').notNull(),
  id: text('id').notNull(),
  plugin_id: text('plugin_id').notNull(),
  address: text('address').notNull(),
  confidence: integer('confidence').notNull(),
}, table => [uniqueIndex('idx_vote').on(table.type, table.plugin_id, table.id, table.address)])
