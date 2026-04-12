import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { drizzle } from 'drizzle-orm/bun-sqlite'

import type { ApiPeer, Config } from '../types/hydrabase'
import type { Account } from './crypto/Account'
import type { Repositories } from './db'
import type { DHT_Node } from './networking/dht'
import type { Peer } from './Peer'
import type PeerManager from './PeerManager'

import { StatsRepository } from './db/repositories/StatsRepository'
import { schema } from './db/schema'
import { StatsReporter } from './StatsReporter'

const remoteAddress = '0xabc123' as const

const createStatsDb = () => {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE tracks (
      address TEXT NOT NULL,
      plugin_id TEXT NOT NULL,
      confidence REAL NOT NULL
    );
    CREATE TABLE artists (
      address TEXT NOT NULL,
      plugin_id TEXT NOT NULL,
      confidence REAL NOT NULL
    );
    CREATE TABLE albums (
      address TEXT NOT NULL,
      plugin_id TEXT NOT NULL,
      confidence REAL NOT NULL
    );
  `)
  return { db: drizzle(sqlite, { schema }), sqlite }
}

const createPeerManager = (peer: Peer): PeerManager => ({
  apiPeer: undefined,
  connectedPeers: [peer],
  getAnnouncedHostnames: () => [],
  getAnnouncementConnections: () => [],
  onApiConnected: () => undefined,
  onDataTransfer: () => undefined,
  onPeerConnected: () => undefined,
  onPeerDisconnected: () => undefined,
  peers: new Map([[peer.address, peer]]),
} as unknown as PeerManager)

const createConnectedPeer = (): Peer => ({
  address: remoteAddress,
  bio: undefined,
  historicConfidence: 0.75,
  hostname: 'peer.test:8080',
  latency: 42,
  lifetimeDL: 10,
  lifetimeUL: 20,
  lookupTime: 15,
  plugins: ['Spotify'],
  totalDL: 1,
  totalUL: 2,
  type: 'CLIENT',
  uptimeMs: 5_000,
  userAgent: 'Hydrabase/test',
  username: 'RemotePeer',
} as unknown as Peer)

const createRepos = (statsRepo: StatsRepository): Repositories => ({
  onVotesChanged: () => undefined,
  peer: {} as Repositories['peer'],
  stats: statsRepo,
} as unknown as Repositories)

describe('StatsReporter', () => {
  const realSetInterval = globalThis.setInterval

  beforeEach(() => {
    globalThis.setInterval = (() => 0) as unknown as typeof setInterval
  })

  afterEach(() => {
    globalThis.setInterval = realSetInterval
  })

  it('surfaces announced remote plugins rather than inferred plugin IDs', () => {
    const { db, sqlite } = createStatsDb()
    sqlite.exec(`INSERT INTO tracks (address, plugin_id, confidence) VALUES ('${remoteAddress}', 'Spotify', 1)`)

    const statsRepo = new StatsRepository(db)
    const peer = createConnectedPeer()
    const reporter = new StatsReporter(
      {
        connectMessage: 'hello',
        hostname: 'local.test',
        ip: '127.0.0.1',
        listenAddress: '127.0.0.1',
        port: 3000,
        preferTransport: 'TCP',
        username: 'LocalNode',
      } satisfies Config['node'],
      { address: '0x0' } as unknown as Account,
      [],
      createPeerManager(peer),
      { nodes: [], onNode: () => undefined } as unknown as DHT_Node,
      createRepos(statsRepo),
    )

    const peers = (reporter as unknown as { knownPeers: () => ApiPeer[] }).knownPeers()

    expect(peers).toHaveLength(1)
    expect(peers[0]?.address).toBe(remoteAddress)
    expect(peers[0]?.connection?.plugins).toEqual(['Spotify'])
    expect(peers[0]).not.toHaveProperty('knownPlugins')
  })
})