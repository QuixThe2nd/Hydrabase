
import type { ApiPeer, Config, Connection, NodeStats, StatsVotesPayload } from '../types/hydrabase'
import type { MetadataPlugin } from '../types/hydrabase-schemas'
import type { Account } from './crypto/Account'
import type { Repositories } from './db'
import type { DHT_Node } from './networking/dht'
import type { Peer } from './Peer'
import type PeerManager from './PeerManager'

import { formatBytes, formatUptime, stats, truncateAddress } from '../utils/log'
import { Trace } from '../utils/trace'
import { authenticatedPeers } from './networking/authenticatedPeers'
import { StatsPulseHistory } from './StatsPulseHistory'


export class StatsReporter {
  private readonly cachedPeerPlugins = new Map<`0x${string}`, string[]>()
  private readonly debounceMs = 1000
  private dhtDebounceTimer: NodeJS.Timeout | null = null
  private readonly pulseHistory: StatsPulseHistory
  private readonly seenDhtNodes = new Set<string>()
  private readonly startTime = Date.now()
  private statsDebounceTimer: NodeJS.Timeout | null = null


  constructor(
    private readonly node: Config['node'],
    private readonly account: Account,
    private readonly plugins: MetadataPlugin[],
    private readonly peers: PeerManager,
    private readonly dht: DHT_Node,
    private readonly repos: Repositories,
    private readonly pulseThrottleMs = 2_000,
  ) {
    this.peers.onApiConnected(() => this.debouncedStatsReport())
    this.peers.onPeerConnected((peer) => {
      this.reportPeerConnected(peer.address)
      this.debouncedStatsReport()
    })
    this.peers.onPeerDisconnected(() => this.debouncedStatsReport())
    this.peers.onDataTransfer(() => this.debouncedStatsReport())
    this.dht.onNode(() => this.debouncedDhtReport())
    this.repos.onVotesChanged(() => this.debouncedStatsReport())

    this.debouncedStatsReport()

    this.logStatus()
    setInterval(() => this.logStatus(), 60_000)
    this.pulseHistory = new StatsPulseHistory(this.pulseThrottleMs)
    setInterval(() => this.recordPulse(), 30_000)
  }

  private static asConnection(peer: Peer): Connection {
    return {
      address: peer.address,
      announcedHostnames: [],
      bio: peer.bio,
      confidence: peer.historicConfidence,
      connectionCount: 0,
      connections: [],
      hostname: peer.hostname,
      latency: peer.latency,
      lifetimeDL: peer.lifetimeDL,
      lifetimeUL: peer.lifetimeUL,
      lookupTime: peer.lookupTime,
      plugins: peer.plugins,
      totalDL: peer.totalDL,
      totalUL: peer.totalUL,
      type: peer.type,
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

  private asConnectionWithCount(peer: Peer): Connection {
    const connection = StatsReporter.asConnection(peer)
    const currentConnections = this.getCurrentAnnouncementConnections(peer.address)
    connection.connectionCount = currentConnections.length
    connection.connections = currentConnections
    connection.announcedHostnames = this.peers.getAnnouncedHostnames(peer.address)
    return connection
  }

  // Debounced DHT node reporting
  private debouncedDhtReport(): void {
    if (this.dhtDebounceTimer) clearTimeout(this.dhtDebounceTimer)
    this.dhtDebounceTimer = setTimeout(() => {
      this.reportDhtNodes()
      this.dhtDebounceTimer = null
    }, this.debounceMs)
  }

  // Debounced stats reporting (covers all stats: peers, votes, pulse, etc)
  private debouncedStatsReport(): void {
    if (this.statsDebounceTimer) clearTimeout(this.statsDebounceTimer)
    this.statsDebounceTimer = setTimeout(() => {
      this.reportAll()
      this.statsDebounceTimer = null
    }, this.debounceMs)
  }

  private getCurrentAnnouncementConnections(address: `0x${string}`): `0x${string}`[] {
    const currentlyConnected = new Set(
      this.peers.connectedPeers
        .filter(peer => peer.address !== '0x0')
        .map(peer => peer.address)
    )
    return this.peers
      .getAnnouncementConnections(address)
      .filter(announcerAddress => currentlyConnected.has(announcerAddress))
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
        connection: connectedPeer ? this.asConnectionWithCount(connectedPeer) : undefined,
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
      const transport = peer.type === 'UTP' ? 'UTP' : 'WS'
      const latency = !isNaN(peer.latency) && isFinite(peer.latency) ? `${Math.ceil(peer.latency)}ms` : '?'
      const uptime = formatUptime(peer.uptimeMs)
      const connectionCount = this.getCurrentAnnouncementConnections(peer.address).length
      stats(`  • ${peer.username} (${truncateAddress(peer.address)}) on ${peer.userAgent} via ${transport} ${peer.hostname} — ${latency} latency, up ${uptime}, ${connectionCount} current announcement connection${connectionCount === 1 ? '' : 's'}`)
    }
  }

  private recordPulse(): void {
    // Only include defined connections for pulse history
    const connections = this.knownPeers()
      .map(peer => peer.connection)
      .filter((conn): conn is Connection => Boolean(conn))
      .map(conn => ({ connection: conn }))
    this.pulseHistory.recordPulse(connections)
      this.pulseHistory.recordPulse(connections)
  }

  private report(send: (client: Peer, trace: Trace) => void): void {
    const client = this.peers.apiPeer
    if (client)  {
      const trace = Trace.start('Sending stats to api client', true, true)
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
    this.report((client, trace) => {
      client.sendStatsPeers(this.knownPeers(), trace)
    })
    this.reportPulseBundle()
  }

  private reportPulseBundle(): void {
    this.recordPulse()
    const history = this.pulseHistory.getHistory()
    if (history.length === 0) return
    let latest: import('../types/hydrabase').StatsPulsePayload
    if (history.length > 0 && history[history.length - 1]) {
      latest = history[history.length - 1] as import('../types/hydrabase').StatsPulsePayload
    } else {
      latest = {
        intervalMs: 0,
        timestamp: new Date().toISOString(),
        totalDL: 0,
        totalUL: 0,
      }
    }
    const bundle: import('../types/hydrabase').StatsPulseBundle = { history, latest }
    this.report((client, trace) => {
      client.sendStatsPulseBundle(bundle, trace)
    })
  }

  private reportSelf(): void {
    const statsSelf: NodeStats['self'] = {
      address: this.account.address,
      hostname: this.node.hostname,
      nodeStartTime: this.startTime,
      plugins: this.plugins.map(p => p.id),
      pluginVotes: this.repos.stats.getSelfVotesByPlugin(),
      votes: this.repos.stats.getSelfVotes(),
    }
    this.report((client, trace) => client.sendStatsSelf(statsSelf, trace))
  }

  // throttledReportPulse is now unused due to unified debouncedStatsReport

  private reportVotes(): void {
    const statsVotes: StatsVotesPayload = {
      peers: {
        plugins: this.repos.stats.getKnownPlugins(),
        pluginVotes: this.repos.stats.getPeerVotesByPlugin(),
        votes: this.repos.stats.getPeerVotes(),
      },
      self: {
        pluginVotes: this.repos.stats.getSelfVotesByPlugin(),
        votes: this.repos.stats.getSelfVotes(),
      },
    }
    this.report((client, trace) => client.sendStatsVotes(statsVotes, trace))
  }

  // pulse history trimming is handled in StatsPulseHistory
}
