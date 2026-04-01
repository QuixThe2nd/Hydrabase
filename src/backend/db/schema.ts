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

export const searchHistory = sqliteTable('search_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  query: text('query').notNull(),
  result_count: integer('result_count').notNull(),
  timestamp: integer('timestamp').notNull(),
  type: text('type').notNull(),
})

export const peerStats = sqliteTable('peer_stats', {
  address: text('address').primaryKey().notNull(),
  lifetime_dl: integer('lifetime_dl').notNull().default(0),
  lifetime_ul: integer('lifetime_ul').notNull().default(0),
})

export const announcedPeers = sqliteTable('announced_peers', {
  announcedAddress: text('announced_address').notNull(),
  announcerAddress: text('announcer_address').notNull(),
  timestamp: integer('timestamp').notNull(),
}, table => [uniqueIndex('idx_announcer_announced').on(table.announcerAddress, table.announcedAddress)])

export const authenticatedPeer = sqliteTable('authenticated_peers', {
  address: text('address').notNull(),
  bio: text('bio'),
  hostname: text('hostname').notNull().primaryKey(),
  signature: text('signature'),
  userAgent: text('user_agent').notNull(),
  username: text('username').notNull(),
})

export const dhtNode = sqliteTable('dht_nodes', {
  host: text('host').notNull(),
  id: integer('id').primaryKey({ autoIncrement: true }),
  port: integer('port').notNull(),
}, table => [uniqueIndex('idx_dht_node').on(table.host, table.port)])

export const wsServer = sqliteTable('ws_servers', {
  hostname: text('hostname').notNull().primaryKey(),
})

export const setting = sqliteTable('settings', {
  key: text('key').primaryKey().notNull(),
  updated_at: integer('updated_at').notNull(),
  updated_by: text('updated_by').notNull(),
  value: text('value').notNull(),
})

export const schema = { album, announcedPeers, artist, authenticatedPeer, dhtNode, peerStats, searchHistory, setting, soul, track, wsServer } as const
// Bunx drizzle-kit generate --dialect sqlite --schema ./src/db/schema.ts
