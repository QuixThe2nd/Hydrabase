import type { ApiPeer, Config, Connection, NodeStats, StatsPulsePayload, StatsVotesPayload } from '../types/hydrabase'
import type { MetadataPlugin } from '../types/hydrabase-schemas'
import type { Account } from './crypto/Account'
import type { Repositories } from './db'
import type { DHT_Node } from './networking/dht'
import type { Peer } from './Peer'
import type PeerManager from './PeerManager'

import { formatBytes, formatUptime, stats, truncateAddress } from '../utils/log'
import { Trace } from '../utils/trace'
import { authenticatedPeers } from './networking/udp/server'

export class StatsReporter {
  private readonly cachedPeerPlugins = new Map<`0x${string}`, string[]>()
  private readonly seenDhtNodes = new Set<string>()
  private readonly startTime = Date.now()

  constructor(
    private readonly node: Config['node'],
    private readonly account: Account,
    private readonly plugins: MetadataPlugin[],
    private readonly peers: PeerManager,
    private readonly dht: DHT_Node,
    private readonly repos: Repositories,
    private readonly peersIntervalMs = 2_000,
    private readonly votesIntervalMs = 5_000,
    private readonly dhtIntervalMs = 2_000,
    private readonly timestampIntervalMs = 1_000
  ) {
    this.peers.onApiConnected(() => this.reportAll())
    this.peers.onPeerConnected((peer) => {
      this.reportPeerConnected(peer.address)
      this.reportPeers()
    })

    this.reportAll()
    setInterval(() => this.reportPeers(), this.peersIntervalMs)
    setInterval(() => this.reportVotes(), this.votesIntervalMs)
    setInterval(() => this.reportDhtNodes(), this.dhtIntervalMs)
    setInterval(() => this.reportTimestamp(), this.timestampIntervalMs)

    this.logStatus()
    setInterval(() => this.logStatus(), 60_000)
  }

  private static asConnection(peer: Peer): Connection {
    return {
      address: peer.address,
      bio: peer.bio,
      confidence: peer.historicConfidence,
      hostname: peer.hostname,
      latency: peer.latency,
      lifetimeDL: peer.lifetimeDL,
      lifetimeUL: peer.lifetimeUL,
      lookupTime: peer.lookupTime,
      plugins: peer.plugins,
      totalDL: peer.totalDL,
      totalUL: peer.totalUL,
      uptime: peer.uptimeMs,
      userAgent: peer.userAgent,
      username: peer.username,
      votes: {
        albums: 0,
        artists: 0,
        tracks: 0
      },
    }
  }

  private getKnownPlugins(address: `0x${string}`, connectedPeer: Peer | undefined): string[] {
    if (connectedPeer?.plugins.length) {
      this.cachedPeerPlugins.set(address, [...connectedPeer.plugins])
      return connectedPeer.plugins
    }
    const cached = this.cachedPeerPlugins.get(address)
    if (cached?.length) return cached
    const fromDb = this.repos.peer.getPlugins(address)
    if (fromDb.length) this.cachedPeerPlugins.set(address, fromDb)
    return fromDb
  }

  private readonly knownPeers = (): ApiPeer[] => {
    const connectedByAddress = new Map(this.peers.connectedPeers.map(peer => [peer.address, peer]))
    const authByAddress = new Map(
      [...authenticatedPeers.values()]
        .filter(identity => identity.address !== '0x0')
        .map(identity => [identity.address, identity])
    )
    const addresses = new Set<`0x${string}`>([
      ...this.repos.stats.getKnownAddresses(),
      ...connectedByAddress.keys(),
      ...authByAddress.keys(),
    ])
    return [...addresses].map((address) => {
      const connectedPeer = connectedByAddress.get(address)
      const knownPlugins = this.getKnownPlugins(address, connectedPeer)
      const identity = authByAddress.get(address)
      return {
        address,
        ...(knownPlugins.length ? { knownPlugins } : {}),
        ...(identity ? {
          auth: {
            ...(identity.bio ? { bio: identity.bio } : {}),
            hostname: identity.hostname,
            userAgent: identity.userAgent,
            username: identity.username,
          },
        } : {}),
        connection: connectedPeer ? StatsReporter.asConnection(connectedPeer) : undefined,
      } satisfies ApiPeer
    })
  }

  private logStatus(): void {
    const peerCount = this.peers.connectedPeers.filter(p => p.address !== '0x0').length
    const dhtCount = this.dht.nodes.length
    const totalUL = this.peers.connectedPeers.reduce((sum, peer) => sum + peer.totalUL, 0)
    const totalDL = this.peers.connectedPeers.reduce((sum, peer) => sum + peer.totalDL, 0)
    const uptime = formatUptime(Date.now() - this.startTime)
    stats(`${peerCount} peers | ${dhtCount} DHT node${dhtCount === 1 ? '' : 's'} | ↑ ${formatBytes(totalUL)} ↓ ${formatBytes(totalDL)} | uptime ${uptime}`)
    for (const peer of this.peers.peers.values()) {
      const transport = peer.type === 'UDP' ? 'UDP' : 'WS'
      const latency = !isNaN(peer.latency) && isFinite(peer.latency) ? `${Math.ceil(peer.latency)}ms` : '?'
      const uptime = formatUptime(peer.uptimeMs)
      stats(`  • ${peer.username} (${truncateAddress(peer.address)}) on ${peer.userAgent} via ${transport} ${peer.hostname} — ${latency} latency, up ${uptime}`)
    }
  }

  private report(send: (client: Peer, trace: Trace) => void): void {
    const client = this.peers.apiPeer
    if (client)  {
      const trace = Trace.start('Sending stats to api client')
      try {
        send(client, trace)
        trace.success()
      } catch (err) {
        trace.fail('[STATS] Failed to collect/send stats', err)
      }
    }
  }

  private reportAll(): void {
    this.reportSelf()
    this.reportDhtNodes()
    this.reportPeers()
    this.reportVotes()
    this.reportTimestamp()
  }

  private reportDhtNodes(): void {
    const nodes = this.dht.nodes.map(({ host, port }: { host: string; port: number }) => `${host}:${port}`)
    this.report((client, trace) => client.sendStatsDhtNodes(nodes, trace))
    for (const node of nodes) {
      if (this.seenDhtNodes.has(node)) continue
      this.seenDhtNodes.add(node)
      this.report((client, trace) => client.sendStatsDhtNodeConnected(node, trace))
    }
  }

  
  private reportPeerConnected(address: `0x${string}`): void {
    const connected = this.knownPeers().find(peer => peer.address === address)
    if (!connected) return
    this.report((client, trace) => client.sendStatsPeerConnected(connected, trace))
  }

  private reportPeers(): void {
    const knownPeers = this.knownPeers()
    const pulse = knownPeers.reduce((totals, peer) => ({
      totalDL: totals.totalDL + (peer.connection?.totalDL ?? 0),
      totalUL: totals.totalUL + (peer.connection?.totalUL ?? 0),
    }), { totalDL: 0, totalUL: 0 })
    const timestamp = new Date().toISOString()
    const statsPulse: StatsPulsePayload = {
      intervalMs: this.peersIntervalMs,
      timestamp,
      totalDL: pulse.totalDL,
      totalUL: pulse.totalUL,
    }
    this.report((client, trace) => {
      client.sendStatsPeers(knownPeers, trace)
      client.sendStatsPulse(statsPulse, trace)
    })
  }

  private reportSelf(): void {
    const statsSelf: NodeStats['self'] = {
      address: this.account.address,
      hostname: this.node.hostname,
      plugins: this.plugins.map(p => p.id),
      votes: this.repos.stats.getSelfVotes(),
    }
    this.report((client, trace) => client.sendStatsSelf(statsSelf, trace))
  }

  private reportTimestamp(): void {
    this.report((client, trace) => client.sendStatsTimestamp(new Date().toISOString(), trace))
  }

  private reportVotes(): void {
    const statsVotes: StatsVotesPayload = {
      peers: {
        plugins: this.repos.stats.getKnownPlugins(),
        votes: this.repos.stats.getPeerVotes(),
      },
      self: {
        votes: this.repos.stats.getSelfVotes(),
      },
    }
    this.report((client, trace) => client.sendStatsVotes(statsVotes, trace))
  }
}
