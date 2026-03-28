/* eslint-disable max-lines */
import { Parser } from 'expr-eval'

import type { Config, Socket } from '../types/hydrabase'
import type { MessageEnvelope, Request, Response, SearchResult } from '../types/hydrabase-schemas'
import type { Account } from './crypto/Account'
import type { Repositories } from './db'
import type MetadataManager from './metadata'
import type { Identity } from './protocol/HIP1_Identity'

// @ts-expect-error: This is supported by bun
import VERSION from '../../VERSION' with { type: 'text' }
import { formatUptime, logContext, truncateAddress, warn } from '../utils/log'
import { Trace } from '../utils/trace'
import { BRANCH } from './branch'
import { DHT_Node } from './networking/dht'
import { authenticateServerHTTP } from './networking/http'
import { UDP_Client } from './networking/udp/client'
import { authenticatedPeers, UDP_Server } from './networking/udp/server'
import { isAllowedPeer } from './networking/utils'
import WebSocketClient from './networking/ws/client'
import { WebSocketServerConnection } from './networking/ws/server'
import { Peer } from './Peer'
import { PeerMap } from './PeerMap'
import { authenticateServerUDP } from './protocol/HIP5_IdentityDiscovery'
import { compareVersions, parseHydrabaseUserAgent } from './versioning'

const cacheFile = Bun.file('./data/ws-servers.json')
const CURRENT_VERSION = VERSION.trim()
const avg = (numbers: number[]) => numbers.reduce((accumulator, currentValue) => accumulator + currentValue, 0) / numbers.length
const warnIfPeerHasNewerBranchVersion = (peer: Peer): void => {
  const parsed = parseHydrabaseUserAgent(peer.userAgent)
  if (!parsed) return
  if (parsed.branch !== BRANCH) return

  const comparison = compareVersions(parsed.version, CURRENT_VERSION)
  if (comparison === null || comparison <= 0) return

  warn(
    'WARN:',
    `[PEERS] Newer version available on branch ${BRANCH}: local ${CURRENT_VERSION}, peer ${parsed.version} (${peer.username} ${peer.hostname})`,
  )
}

const parser = new Parser()
parser.functions.avg = (...args: number[]) => avg(args)

export const authenticatePeer = async (hostname: `${string}:${number}`, preferTransport: 'TCP' | 'UDP', trace: Trace, udpServer: UDP_Server, account: Account, node: Config['node']): Promise<[number, string] | Identity> => {
  trace.step(`Authenticating peer with ${preferTransport}`)
  const preferredAuth = preferTransport === 'TCP' ? await logContext('HTTP', () => authenticateServerHTTP(hostname, trace)) : await authenticateServerUDP(udpServer, hostname, account, node, trace)
  if (!Array.isArray(preferredAuth)) return preferredAuth
  trace.caughtError(preferredAuth[1])
  trace.step(`Authenticating peer with ${preferTransport === 'TCP' ? 'UDP' : 'TCP'}`)
  const fallbackAuth = preferTransport === 'UDP' ? await logContext('HTTP', () => authenticateServerHTTP(hostname, trace)) : await authenticateServerUDP(udpServer, hostname, account, node, trace)
  return fallbackAuth
}

const checkPluginMatches = (peerResults: Response<Request['type']>, confirmedHashes: Set<bigint>) => {
  const pluginMatches: Record<string, { match: number, mismatch: number }> = {}
  for (const _result of peerResults) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { address, confidence, ...result } = _result
    const hash = BigInt(Bun.hash(JSON.stringify(_result)))
    const entry = pluginMatches[result.plugin_id] ?? { match: 0, mismatch: 0 }
    if (confirmedHashes.has(hash)) entry.match++
    else entry.mismatch++
    pluginMatches[result.plugin_id] = entry
  }
  return pluginMatches
} // TODO: pipe all console.log's to gui

const calculatePeerConfidence = (formulas: Config['formulas'], pluginMatches: Record<string, { match: number, mismatch: number }>, installedPlugins: Set<string>) => avg(
  Object.entries(pluginMatches)
    .filter(([pluginId]) => installedPlugins.has(pluginId))
    .map(([, { match, mismatch }]) => Parser.evaluate(formulas.pluginConfidence, { x: match, y: mismatch }))
) // 0-1
// TODO: dedupe usernames
const saveResults = <T extends Request['type']>(formulas: Config['formulas'], peerResults: Response<T>, peerConfidence: number, results: Map<bigint, SearchResult[T] & { confidences: number[] }>, peer: Peer): Map<bigint, SearchResult[T] & { confidences: number[] }> => {
  for (const _result of peerResults) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { address, confidence, ...result } = _result
    const hash = BigInt(Bun.hash(JSON.stringify(result)))
    const finalConfidence = parser.evaluate(formulas.finalConfidence, { x: peerConfidence, y: confidence, z: peer.historicConfidence })
    results.set(hash, { ...result as Exclude<SearchResult[T], 'confidence'>, confidences: [...results.get(hash)?.confidences ?? [], finalConfidence] })
  }
  return results
}

const searchPeer = async <T extends Request['type']>(formulas: Config['formulas'], request: Request & { type: T }, peer: Peer, results: Map<bigint, SearchResult[T] & { confidences: number[] }>, installedPlugins: Set<string>, confirmedHashes: Set<bigint>, trace: Trace): Promise<Map<bigint, SearchResult[T] & { confidences: number[] }>> => {
  const peerResults = await peer.search(request.type, request.query, trace)
  const pluginMatches = checkPluginMatches(peerResults, confirmedHashes)
  const peerConfidence = calculatePeerConfidence(formulas, pluginMatches, installedPlugins)
  return saveResults(formulas, peerResults, peerConfidence, results, peer)
}

const isPeer = (peer: Peer | undefined, address: `0x${string}`): peer is Peer => peer ? true : warn('DEVWARN:', `[PEERS] Peer not found ${address}`)
const isOpened = (peer: Peer | undefined, address: `0x${string}`): boolean => peer ? true : warn('WARN:', `[PEERS] Skipping peer ${address}: connection not open`)

export default class PeerManager {
  private static readonly HELD_MESSAGE_SWEEP_MS = 10_000
  private static readonly RECONNECT_BASE_DELAY_MS = 5_000
  private static readonly RECONNECT_MAX_ATTEMPTS = 10
  private static readonly RECONNECT_MAX_DELAY_MS = 300_000
  public readonly peers = new PeerMap()

  get apiPeer() {
    return this.peers.get('0x0')
  }
  get connectedPeers() {
    return [...this.peers.values()]
  }
  get peerAddresses() {
    return this.peers.addresses
  }

  private readonly heldMessages = new Map<`0x${string}`, MessageEnvelope[]>()
  private readonly heldMessageSweepTimer: NodeJS.Timeout
  private readonly knownPeers = new Set<`${string}:${number}`>()
  private readonly reconnectAttempts = new Map<`${string}:${number}`, number>()
  private readonly reconnectTimers = new Map<`${string}:${number}`, NodeJS.Timeout>()

  constructor(
    private readonly account: Account, 
    private readonly metadataManager: MetadataManager, 
    private readonly repos: Repositories,
    private readonly search: <T extends Request['type']>(type: T, query: string, searchPeers?: boolean) => Promise<Response<T>>,
    public readonly nodeConfig: Config['node'],
    private readonly rpcConfig: Config['rpc'],
    public readonly udpServer: UDP_Server,
  ) {
    this.heldMessageSweepTimer = setInterval(() => {
      this.pruneExpiredHeldMessages()
    }, PeerManager.HELD_MESSAGE_SWEEP_MS)
    this.heldMessageSweepTimer.unref?.()
  }

  // TODO: some mechanism to proactively propagate unsolicited votes
  public async add(_peer: `${string}:${number}` | UDP_Client | WebSocketServerConnection, trace: Trace, preferTransport = this.nodeConfig.preferTransport): Promise<boolean> {
    if (typeof _peer === 'string') {
      const separatorIndex = _peer.lastIndexOf(':')
      if (separatorIndex === -1) return trace.fail('Invalid peer format')

      const hostname = _peer.slice(0, separatorIndex)
      const port = Number(_peer.slice(separatorIndex + 1))
      if (!Number.isInteger(port) || port <= 0 || port > 65535) return trace.fail('Invalid peer port')

      // Keep discovery constrained while allowing local development/test ports.
      if (!isAllowedPeer(hostname, port)) return trace.silentFail('Invalid port range')
    }
    const socket = typeof _peer === 'string' ? await this.toPeer(_peer, preferTransport, trace) : _peer
    if (socket === false) return false
    const peer = new Peer(socket, this, this.repos, this.metadataManager.installedPlugins, this.search)
    warnIfPeerHasNewerBranchVersion(peer)

    socket.onClose(() => logContext('PEERS', () => {
      const uptime = formatUptime(peer.uptimeMs)
      const disconnectTrace = Trace.start(`[PEERS] Peer disconnect: ${peer.username} (${truncateAddress(peer.address)})`)
      disconnectTrace.step(`- ${peer.username} (${truncateAddress(peer.address)}) disconnected after ${uptime}`)
      disconnectTrace.success()
      this.peers.delete(peer.address)
      this.knownPeers.delete(peer.hostname)
      this.scheduleReconnect(peer.hostname)
    }))

    this.peers.set(peer.address, peer)
    cacheFile.write(JSON.stringify([...this.peers.values()].map(peer => peer.hostname)))
    this.announce(peer, trace)
    this.knownPeers.add(peer.hostname)
    this.forwardHeldMessagesForPeer(peer)

    return true
  }

  public createAndSendMessage(to: `0x${string}`, payload: string, trace: Trace): void {
    const from = this.account.address
    const timestamp = Date.now()
    const ttl = 86_400_000 // 24 hours
    const sig = this.account.sign(`${from}:${to}:${timestamp}:${payload}`, trace).toString()
    const envelope: MessageEnvelope = { from, payload, sig, timestamp, to, ttl }
    this.sendStoreMessage(envelope, trace)
  }

  public getConfidence(address: `0x${string}`): number { // TODO: Soulsync plugin - https://github.com/Nezreka/SoulSync/blob/main/Support/API.md
    const peer = this.peers.get(address)
    if (!peer) return 0
    return peer.historicConfidence // TODO: tit for tat
  }

  public handleDeliverMessage(envelope: MessageEnvelope, peer: Peer, trace: Trace): void {
    if (this.isEnvelopeExpired(envelope)) {
      trace.step(`[HIP2] Dropping expired delivered message for ${envelope.to} from ${peer.address}`)
      return
    }
    if (envelope.to !== this.account.address) {
      trace.step(`[HIP2] Ignoring delivered message not addressed to this node (${envelope.to})`)
      return
    }
    trace.step(`[HIP2] Received delivered message for ${envelope.to} from ${envelope.from} via ${peer.address}`)
    this.apiPeer?.sendDeliverMessage(envelope, trace)
  }

  public handleStoreMessage(envelope: MessageEnvelope, peer: Peer, trace: Trace): void {
    if (this.isEnvelopeExpired(envelope)) {
      trace.step(`[HIP2] Dropping expired store message for ${envelope.to} from ${peer.address}`)
      return
    }

    const recipientPeer = this.peers.get(envelope.to)
    if (recipientPeer) {
      trace.step(`[HIP2] Recipient ${envelope.to} online; forwarding message from intermediary ${peer.address}`)
      recipientPeer.sendDeliverMessage(envelope, trace)
      return
    }

    const existing = this.heldMessages.get(envelope.to) ?? []
    const envelopeHash = Bun.hash(JSON.stringify(envelope))
    if (existing.some(item => Bun.hash(JSON.stringify(item)) === envelopeHash)) {
      trace.step(`[HIP2] Duplicate store message ignored for recipient ${envelope.to}`)
      return
    }
    existing.push(envelope)
    this.heldMessages.set(envelope.to, existing)
    trace.step(`[HIP2] Stored message for offline recipient ${envelope.to}; held=${existing.length}`)
  }
  // TODO: endpoint soulsync can call with user feedback of "spotify result x is listenbrainz result y"
  public readonly has = (address: `0x${string}`) => this.peers.has(address)

  public async loadCache(bootstrapPeers: string[]) {
    await Promise.all(bootstrapPeers.map(async hostname => {
      const trace = Trace.start(`[PEERS] Connecting to bootstrap peer ${hostname}`)
      await this.add(hostname as `${string}:${number}`, trace)
    }))
    if (!(await cacheFile.exists())) return
    const hostnames: `${string}:${number}`[] = await cacheFile.json()
    for (const hostname of hostnames) if (hostname && !bootstrapPeers.includes(hostname)) {
      const trace = Trace.start(`[PEERS] Connecting to cached peer ${hostname}`)
      await this.add(hostname, trace)
    }
  } // TODO: time based confidence scores - older peers = more trustworthy

  public async requestAll<T extends Request['type']>(formulas: Config['formulas'], request: Request & { type: T }, confirmedHashes: Set<bigint>, installedPlugins: Set<string>, trace: Trace): Promise<Map<bigint, SearchResult[T]>> {
    const results = new Map<bigint, SearchResult[T] & { confidences: number[] }>()
    trace.step(`[PEERS] Searching ${this.peerAddresses.length} peer${this.peerAddresses.length === 1 ? '' : 's'} for ${request.type}: ${request.query}`)
    for (const address of this.peerAddresses) {
      const peer = this.peers.get(address)
      if (!isPeer(peer, address)) continue
      if (!isOpened(peer, address)) continue
      (await searchPeer(formulas, request, peer, results, installedPlugins, confirmedHashes, trace)).entries().map(([hash,item]) => results.set(BigInt(hash), item))
    }
    trace.step(`[PEERS] Received ${results.size} results`)
    return new Map<bigint, SearchResult[T]>(results.entries().map(([hash, result]) => ([hash, { ...result, confidence: avg(result.confidences) }])))
  }

  public sendStoreMessage(envelope: MessageEnvelope, trace: Trace): number {
    if (this.isEnvelopeExpired(envelope)) {
      trace.step(`[HIP2] Not sending expired store message for ${envelope.to}`)
      return 0
    }

    const recipientPeer = this.peers.get(envelope.to)
    if (recipientPeer) {
      recipientPeer.sendDeliverMessage(envelope, trace)
      trace.step(`[HIP2] Recipient ${envelope.to} online; sent DELIVER_MESSAGE directly`)
      return 1
    }

    let sent = 0
    for (const peer of this.connectedPeers) {
      if (peer.address === '0x0') continue
      if (peer.address === envelope.to) continue
      peer.sendStoreMessage(envelope, trace)
      sent++
    }
    trace.step(`[HIP2] Sent STORE_MESSAGE for ${envelope.to} to ${sent} online peer${sent === 1 ? '' : 's'}`)
    return sent
  }

  private announce(newPeer: Peer, trace: Trace) {
    if (newPeer.address === '0x0') return
    trace.step('[PEERS] Announcing peers')
    for (const peerAddress of this.peerAddresses) {
      const existingPeer = this.peers.get(peerAddress)
      if (!existingPeer) {
        warn('DEVWARN:', `[PEERS] Peer not found ${peerAddress}`)
        continue
      }
      newPeer.announcePeer(existingPeer, trace)
      existingPeer.announcePeer(newPeer, trace)
    }
  }

  private forwardHeldMessagesForPeer(peer: Peer) {
    const held = this.heldMessages.get(peer.address)
    if (!held || held.length === 0) return

    const trace = Trace.start(`[HIP2] Forwarding ${held.length} held message${held.length === 1 ? '' : 's'} to ${peer.username} ${peer.address}`)
    const now = Number(new Date())
    const valid = held.filter(message => !this.isEnvelopeExpired(message, now))

    if (valid.length === 0) {
      this.heldMessages.delete(peer.address)
      trace.step('[HIP2] All held messages had expired before delivery')
      trace.success()
      return
    }

    for (const message of valid) peer.sendDeliverMessage(message, trace)
    this.heldMessages.delete(peer.address)
    trace.success()
  }

  // eslint-disable-next-line class-methods-use-this
  private isEnvelopeExpired(envelope: MessageEnvelope, now = Number(new Date())): boolean {
    return envelope.timestamp + envelope.ttl <= now
  }

  private pruneExpiredHeldMessages() {
    const now = Number(new Date())
    for (const [recipient, messages] of this.heldMessages.entries()) {
      const valid = messages.filter(message => !this.isEnvelopeExpired(message, now))
      if (valid.length === 0) this.heldMessages.delete(recipient)
      else if (valid.length !== messages.length) this.heldMessages.set(recipient, valid)
    }
  }

  private scheduleReconnect(hostname: `${string}:${number}`) {
    if (hostname === 'API:4545') return
    const existing = this.reconnectTimers.get(hostname)
    if (existing) clearTimeout(existing)

    const attempt = (this.reconnectAttempts.get(hostname) ?? 0) + 1
    if (attempt > PeerManager.RECONNECT_MAX_ATTEMPTS) {
      warn('WARN:', `[PEERS] Giving up reconnection to ${hostname} after ${PeerManager.RECONNECT_MAX_ATTEMPTS} attempts`)
      this.reconnectAttempts.delete(hostname)
      this.reconnectTimers.delete(hostname)
      return
    }

    const delay = Math.min(PeerManager.RECONNECT_BASE_DELAY_MS * 2**(attempt - 1), PeerManager.RECONNECT_MAX_DELAY_MS)

    this.reconnectAttempts.set(hostname, attempt)
    const trace = Trace.start(`[PEERS] Reconnecting to ${hostname} (attempt ${attempt}/${PeerManager.RECONNECT_MAX_ATTEMPTS}, delay ${delay / 1000}s)`)

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(hostname)
      this.knownPeers.delete(hostname)
      const success = await this.add(hostname, trace)
      if (success) {
        trace.success()
        this.reconnectAttempts.delete(hostname)
      } else {
        trace.fail('Reconnection failed')
        this.scheduleReconnect(hostname)
      }
    }, delay)
    this.reconnectTimers.set(hostname, timer)
  }

  private shouldAuthenticate(hostname: `${string}:${number}`): string | true {
    if (hostname === `${this.nodeConfig.hostname}:${this.nodeConfig.port}` || hostname === `${this.nodeConfig.ip}:${this.nodeConfig.port}`) return `[PEERS] Not connecting to self ${hostname}`
    if (this.knownPeers.has(hostname)) return `[PEERS] Already connected to peer ${hostname}`
    return true
  }

  private shouldConnect(hostname: `${string}:${number}`, identity: Identity): string | true {
    if (this.has(identity.address)) return `[PEERS] Already connected/connecting to peer ${identity.username} ${identity.address} ${identity.hostname}`
    if (identity.address === this.account.address) return `[PEERS] Not connecting to self ${identity.address}`
    if (identity.hostname === `${this.nodeConfig.hostname}:${this.nodeConfig.port}`) return `[PEERS] Not connecting to self ${hostname}`
    if (identity.hostname === `${this.nodeConfig.ip}:${this.nodeConfig.port}`) return `[PEERS] Not connecting to self ${hostname}`
    if (identity.hostname !== hostname && this.knownPeers.has(identity.hostname)) return `[PEERS] Not connecting to self ${hostname}`
    if (this.peers.has(identity.address)) return `[PEERS] Skipping connection to ${identity.username} ${identity.address} - already connected`
    return true
  }

  private async toPeer(hostname: `${string}:${number}`, preferTransport: 'TCP' | 'UDP', trace: Trace): Promise<false | Socket> {
    trace.step('Creating socket')
    const shouldAuthenticate = this.shouldAuthenticate(authenticatedPeers.get(hostname)?.hostname ?? hostname)
    if (typeof shouldAuthenticate === 'string') return trace.softFail(shouldAuthenticate)
    const identity = await authenticatePeer(hostname, preferTransport, trace, this.udpServer, this.account, this.nodeConfig)
    if (Array.isArray(identity)) return trace.softFail(identity[1])

    const shouldConnect = this.shouldConnect(authenticatedPeers.get(hostname)?.hostname ?? hostname, identity)
    if (typeof shouldConnect === 'string') return trace.softFail(shouldConnect)

    const firstSocket = await this.toSocket(hostname, preferTransport, trace, identity)
    if (typeof firstSocket === 'object') {
      trace.success()
      return firstSocket
    }
    if (typeof firstSocket === 'string') return trace.softFail(firstSocket)
    trace.caughtError('Peer verification failed')

    const socket = await this.toSocket(hostname, preferTransport === 'TCP' ? 'UDP' : 'TCP', trace, identity)
    if (typeof socket === 'string') return trace.softFail(socket)
    trace.success()
    return socket
  }
  
  private async toSocket(hostname: `${string}:${number}`, preferTransport: 'TCP' | 'UDP', trace: Trace, identity: Identity): Promise<false | Socket | string> {
    trace.step(`PeerManager.add(${hostname}, ${preferTransport})`)
    if (hostname === `${this.nodeConfig.hostname}:${this.nodeConfig.port}` || hostname === `${this.nodeConfig.ip}:${this.nodeConfig.port}`) return 'Attempted to connect to self'
    return preferTransport === 'TCP' ? await WebSocketClient.init(identity, this.account, this.nodeConfig) : UDP_Client.connectToAuthenticatedPeer(this.udpServer.socket, identity, this.rpcConfig, DHT_Node.getNodeId(this.nodeConfig), trace) || false
  }
}
