/* eslint-disable max-lines */
import type { UTPSocket } from 'utp-socket'

import { Parser } from 'expr-eval'

import type { Config, Socket } from '../types/hydrabase'
import type { MessageEnvelope, Request, Response, SearchResult } from '../types/hydrabase-schemas'
import type { Account } from './crypto/Account'
import type { Repositories } from './db'
import type MetadataManager from './metadata'
import type { Identity } from './protocol/HIP1_Identity'
import type { MessagePacket } from './protocol/HIP2_Messaging'

// @ts-expect-error: This is supported by bun
import VERSION from '../../VERSION' with { type: 'text' }
import { formatUptime, logContext, truncateAddress, warn } from '../utils/log'
import { Trace } from '../utils/trace'
import { BRANCH } from './branch'
import { authenticatedPeers } from './networking/authenticatedPeers'
import { authenticateServerHTTP } from './networking/http'
import { isAllowedPeer } from './networking/utils'
import { UTPClient } from './networking/utp/client'
import WebSocketClient from './networking/ws/client'
import { Peer } from './Peer'
import { PeerMap } from './PeerMap'
import { RuntimeSettingsManager } from './RuntimeSettingsManager'
import { compareVersions, parseHydrabaseUserAgent } from './versioning'

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

export const authenticatePeer = async (hostname: `${string}:${number}`, preferTransport: 'TCP' | 'UTP', trace: Trace): Promise<[number, string] | Identity> => {
  trace.step(`Authenticating peer with ${preferTransport}`)
  return await logContext('HTTP', () => authenticateServerHTTP(hostname, trace))
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
  private static readonly MAX_MESSAGE_HOPS = 5
  private static readonly RECENT_CONNECTION_FAILURE_MAX = 512
  private static readonly RECENT_CONNECTION_FAILURE_TTL_MS = 3_600_000
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
  get messageHistory(): MessageEnvelope[] {
    return this.localMessageHistory
  }
  get ownAddress(): `0x${string}` {
    return this.account.address
  }
  get peerAddresses() {
    return this.peers.addresses
  }

  private readonly announcedByPeer = new Map<`0x${string}`, Set<`0x${string}`>>()
  private readonly announcedHostnamesByPeer = new Map<`0x${string}`, Set<`${string}:${number}`>>()
  private readonly apiConnectedHandlers: (() => void)[] = []
  private readonly connectingPeers = new Set<`${string}:${number}`>()
  private readonly dataTransferHandlers: (() => void)[] = []
  private readonly heldMessages = new Map<`0x${string}`, MessageEnvelope[]>()
  private readonly heldMessageSweepTimer: NodeJS.Timeout
  private readonly knownPeers = new Set<`${string}:${number}`>()
  private readonly localMessageHistory: MessageEnvelope[] = []
  private readonly peerConnectedHandlers: ((peer: Peer) => Promise<void> | void)[] = []
  private readonly peerDisconnectedHandlers: ((peer: Peer) => void)[] = []
  private readonly recentConnectionFailures = new Map<`${string}:${number}`, { hostname: `${string}:${number}`; reason: string; stack?: string; timestamp: number; transport: 'TCP' | 'UTP' }>()
  private readonly recentPeerAddresses = new Map<`${string}:${number}`, `0x${string}`>()
  private readonly reconnectAttempts = new Map<`${string}:${number}`, number>()
  private readonly reconnectTimers = new Map<`${string}:${number}`, NodeJS.Timeout>()

  constructor(
    private readonly account: Account, 
    private readonly metadataManager: MetadataManager, 
    private readonly repos: Repositories,
    private readonly runtimeSettings: RuntimeSettingsManager,
    private readonly search: <T extends Request['type']>(type: T, query: string, searchPeers?: boolean) => Promise<Response<T>>,
    public readonly nodeConfig: Config['node'],
    private readonly utpSocket: null | UTPSocket
  ) {
    this.heldMessageSweepTimer = setInterval(() => {
      this.pruneExpiredHeldMessages()
      this.pruneExpiredLocalHistory()
      this.pruneExpiredConnectionFailures()
    }, PeerManager.HELD_MESSAGE_SWEEP_MS)
    this.heldMessageSweepTimer.unref?.()
  }

  private static buildConnectionFailurePayload(failure: { at: string; hostname: `${string}:${number}`; reason: string; stack?: string; transport: 'TCP' | 'UTP' }): string {
    const fields = new URLSearchParams()
    fields.set('hostname', failure.hostname)
    fields.set('transport', failure.transport)
    fields.set('at', failure.at)
    fields.set('reason', failure.reason)
    if (failure.stack) fields.set('stack', failure.stack)
    return `system:connection_attempt_failed|${fields.toString().replace(/&/gu, '|')}`
  }

  private static normalizeHostname(hostname: `${string}:${number}`): `${string}:${number}` {
    return authenticatedPeers.get(hostname)?.hostname ?? hostname
  }

  // TODO: some mechanism to proactively propagate unsolicited votes
  // eslint-disable-next-line max-lines-per-function
  public async add(_peer: `${string}:${number}` | Socket, trace: Trace, preferTransport = this.nodeConfig.preferTransport): Promise<boolean> {
    let connectionKey: `${string}:${number}` | null = null
    if (typeof _peer === 'string') {
      const separatorIndex = _peer.lastIndexOf(':')
      if (separatorIndex === -1) return trace.fail('Invalid peer format')

      const hostname = _peer.slice(0, separatorIndex)
      const port = Number(_peer.slice(separatorIndex + 1))
      if (!Number.isInteger(port) || port <= 0 || port > 65535) return trace.fail('Invalid peer port')

      // Keep discovery constrained while allowing local development/test ports.
      if (!isAllowedPeer(hostname, port)) return trace.silentFail('Invalid port range')

      connectionKey = PeerManager.normalizeHostname(_peer)
      if (this.connectingPeers.has(connectionKey)) return trace.softFail(`[PEERS] Already connecting to peer ${connectionKey}`)
      this.connectingPeers.add(connectionKey)
    }
    try {
      const socket = typeof _peer === 'string' ? await this.toPeer(_peer, preferTransport, trace) : _peer
      if (socket === false) return false

      if (socket.identity.address !== '0x0' && this.peers.has(socket.identity.address)) {
        const existingPeer = this.peers.get(socket.identity.address)
        trace.step(`[PEERS] Duplicate socket for ${socket.identity.username} (${truncateAddress(socket.identity.address)}) ${socket.identity.hostname}; keeping existing connection`)
        try { socket.close() } catch { /* ignore close errors */ }
        return trace.softFail(existingPeer ? `[PEERS] Already connected to peer ${existingPeer.username} ${existingPeer.address} ${existingPeer.hostname}` : `[PEERS] Already connected to peer ${socket.identity.address}`)
      }

      const peer = new Peer(socket, this, this.repos, this.metadataManager.installedPlugins, this.search)
      warnIfPeerHasNewerBranchVersion(peer)

      socket.onClose(() => logContext('PEERS', () => {
        const uptime = formatUptime(peer.uptimeMs)
        const disconnectTrace = Trace.start(`[PEERS] Peer disconnect: ${peer.username} (${truncateAddress(peer.address)})`)

        if (this.peers.get(peer.address) !== peer) {
          disconnectTrace.step(`[PEERS] Ignoring stale close event for ${peer.username} (${truncateAddress(peer.address)})`)
          disconnectTrace.success()
          return
        }

        disconnectTrace.step(`- ${peer.username} (${truncateAddress(peer.address)}) disconnected after ${uptime}`)
        disconnectTrace.success()
        this.notifyPeerDisconnected(peer)
        this.removePeerAnnouncements(peer.address)
        this.peers.delete(peer.address)
        this.knownPeers.delete(PeerManager.normalizeHostname(peer.hostname))
        this.scheduleReconnect(peer.hostname)
      }))

      this.peers.set(peer.address, peer)
      if (peer.address === '0x0') this.apiConnectedHandlers.forEach(handler => handler())
      else {
        this.notifyPeerConnected(peer)
        const connectTrace = Trace.start(`[PEERS] Sending connect message to ${peer.username}`)
        this.createAndSendMessage(peer.address, this.nodeConfig.connectMessage, connectTrace)
        connectTrace.success()
      }
      this.repos.wsServer.replaceAll([...this.peers.values()].map(peer => peer.hostname))
      // this.announce(peer, trace) // removed: peer lists are now sent on every ping
      this.knownPeers.add(PeerManager.normalizeHostname(peer.hostname))
      this.clearReconnectState(peer.hostname)
      this.recentPeerAddresses.set(PeerManager.normalizeHostname(peer.hostname), peer.address)
      this.notifyPeerOfRecentConnectionFailure(peer, trace)
      this.forwardHeldMessagesForPeer(peer)
      this.forwardLocalHistoryToPeer(peer)
      this.syncHeldMessagesToPeer(peer)

      return true
    } finally {
      if (connectionKey) this.connectingPeers.delete(connectionKey)
    }
  }

  public createAndSendMessage(to: `0x${string}`, payload: string, trace: Trace): void {
    const from = this.account.address
    const timestamp = Date.now()
    const ttl = 21_600_000 // 6 hours
    const sig = this.account.sign(`${from}:${to}:${timestamp}:${payload}`, trace).toString()
    const envelope: MessageEnvelope = { from, payload, sig, timestamp, to, ttl }
    this.recordLocalMessage(envelope)
    this.sendMessage(envelope, trace)
  }

  public getAnnouncedHostnames(announcerAddress: `0x${string}`): `${string}:${number}`[] {
    const hostnames = this.announcedHostnamesByPeer.get(announcerAddress)
    if (!hostnames) return []
    return [...hostnames]
  }

  public getAnnouncementConnections(announcedAddress: `0x${string}`): `0x${string}`[] {
    const announcers = this.announcedByPeer.get(announcedAddress)
    if (!announcers) return []
    return [...announcers]
  }

  public getConfidence(address: `0x${string}`): number { // TODO: Soulsync plugin - https://github.com/Nezreka/SoulSync/blob/main/Support/API.md
    const peer = this.peers.get(address)
    if (!peer) return 0
    return peer.historicConfidence // TODO: tit for tat
  }

  public getMessageReadState(): Record<string, number> {
    return this.repos.messageReadState.getByReader(this.ownAddress)
  }

  public getRuntimeConfig() {
    return this.runtimeSettings.getSnapshot()
  }

  public async handleConnectPeerRequest(hostname: `${string}:${number}`, apiPeer: Peer, nonce: number, trace: Trace): Promise<void> {
    trace.step(`[PEERS] API requesting connection to ${hostname} (nonce ${nonce})`)
    try {
      const success = await this.add(hostname, trace)
      if (success) {
        trace.success()
        apiPeer.send({ nonce, refresh_ui: 'peer_connected' }, trace)
      } else {
        this.recordConnectionFailure(hostname, 'Failed to connect to peer', this.nodeConfig.preferTransport, trace.getFullTrace())
        trace.fail('Connection failed')
        apiPeer.sendConnectionError({
          hostname,
          message: 'Failed to connect to peer',
          stack: trace.getFullTrace(),
          status: 500
        }, nonce, trace)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? (error.stack ?? trace.getFullTrace()) : trace.getFullTrace()
      this.recordConnectionFailure(hostname, message, this.nodeConfig.preferTransport, stack)
      trace.fail(message)
      apiPeer.sendConnectionError({
        hostname,
        message,
        stack: trace.getFullTrace(),
        status: 500
      }, nonce, trace)
    }
  }

  public handleDeliverMessage(envelope: MessageEnvelope, peer: Peer, trace: Trace): void {
    this.handleMessage({ envelope, hops: 0 }, peer, trace)
  }

  public async handleDiscoveredHostname(announcerAddress: `0x${string}`, announcedHostname: `${string}:${number}`, trace: Trace): Promise<void> {
    try {
      const success = await this.add(announcedHostname, trace)
      if (!success) {
        trace.fail(`Failed to connect to discovered hostname ${announcedHostname}`)
        return
      }

      this.recordPeerAnnouncedHostname(announcerAddress, announcedHostname)

      const announcedPeer = this.findConnectedPeerByHostname(announcedHostname)
      if (announcedPeer) this.recordPeerAnnouncement(announcedPeer.address, announcerAddress)

      trace.success()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      trace.fail(message)
      throw error
    }
  }

  public handleMessage(packet: MessagePacket, peer: Peer, trace: Trace): void {
    const { envelope, hops } = packet
    if (this.isEnvelopeExpired(envelope)) {
      trace.step(`[HIP2] Dropping expired message for ${envelope.to} from ${peer.address}`)
      return
    }
    if (hops > PeerManager.MAX_MESSAGE_HOPS) {
      trace.step(`[HIP2] Dropping message for ${envelope.to} from ${peer.address}: hop limit exceeded (${hops})`)
      return
    }

    const before = this.localMessageHistory.length
    this.recordLocalMessage(envelope)
    const isNewEnvelope = this.localMessageHistory.length > before
    if (!isNewEnvelope) {
      trace.step(`[HIP2] Duplicate message ignored for recipient ${envelope.to}`)
      return
    }

    this.apiPeer?.sendMessagePacket({ envelope, hops }, trace)

    // Store message for offline recipient so it can be delivered when they connect
    this.storeHeldMessageIfOffline(envelope, trace)

    if (hops >= PeerManager.MAX_MESSAGE_HOPS) {
      trace.step(`[HIP2] Stored message for ${envelope.to}; reached max hops (${hops})`)
      return
    }

    const forwarded = this.broadcastMessage(envelope, hops + 1, trace, peer.address)
    trace.step(`[HIP2] Relayed message for ${envelope.to} to ${forwarded} peer${forwarded === 1 ? '' : 's'} at hop ${hops + 1}`)
  }

  public handleStoreMessage(envelope: MessageEnvelope, peer: Peer, trace: Trace): void {
    this.handleMessage({ envelope, hops: 0 }, peer, trace)
  }

  // TODO: endpoint soulsync can call with user feedback of "spotify result x is listenbrainz result y"
  public readonly has = (address: `0x${string}`) => this.peers.has(address)

  public async loadCache(bootstrapPeers: string[]) {
    await Promise.all(bootstrapPeers.map(async hostname => {
      const trace = Trace.start(`[PEERS] Connecting to bootstrap peer ${hostname}`)
      await this.add(hostname as `${string}:${number}`, trace)
    }))
    const hostnames = this.repos.wsServer.getAll()
    for (const hostname of hostnames) if (hostname && !bootstrapPeers.includes(hostname)) {
      const trace = Trace.start(`[PEERS] Connecting to cached peer ${hostname}`)
      await this.add(hostname, trace)
    }
  } // TODO: time based confidence scores - older peers = more trustworthy

  public markMessageRead(conversationAddress: `0x${string}`, timestamp: number): void {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return
    this.repos.messageReadState.markRead(this.ownAddress, conversationAddress, timestamp)
  }

  public notifyDataTransfer(): void {
    this.dataTransferHandlers.forEach(handler => handler())
  }

  public onApiConnected(handler: () => void): void {
    this.apiConnectedHandlers.push(handler)
  }

  public onDataTransfer(handler: () => void): void {
    this.dataTransferHandlers.push(handler)
  }

  public onPeerConnected(handler: (peer: Peer) => Promise<void> | void): void {
    this.peerConnectedHandlers.push(handler)
  }

  public onPeerDisconnected(handler: (peer: Peer) => void): void {
    this.peerDisconnectedHandlers.push(handler)
  }

  public purgePeerCache(): void {
    this.repos.wsServer.replaceAll([])
    authenticatedPeers.clear()
    this.recentPeerAddresses.clear()
    this.recentConnectionFailures.clear()
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer)
    this.reconnectTimers.clear()
    this.reconnectAttempts.clear()
  }

  public recordPeerAnnouncedHostname(announcerAddress: `0x${string}`, announcedHostname: `${string}:${number}`): void {
    if (announcerAddress === '0x0') return
    const hostnames = this.announcedHostnamesByPeer.get(announcerAddress) ?? new Set<`${string}:${number}`>()
    hostnames.add(PeerManager.normalizeHostname(announcedHostname))
    this.announcedHostnamesByPeer.set(announcerAddress, hostnames)
  }

  public recordPeerAnnouncement(announcedAddress: `0x${string}`, announcerAddress: `0x${string}`): void {
    if (announcedAddress === announcerAddress) return
    if (announcedAddress === '0x0' || announcerAddress === '0x0') return

    const announcers = this.announcedByPeer.get(announcedAddress) ?? new Set<`0x${string}`>()
    announcers.add(announcerAddress)
    this.announcedByPeer.set(announcedAddress, announcers)
  }

  public async requestAll<T extends Request['type']>(formulas: Config['formulas'], request: Request & { type: T }, confirmedHashes: Set<bigint>, installedPlugins: Set<string>, trace: Trace): Promise<Map<bigint, SearchResult[T]>> {
    const results = new Map<bigint, SearchResult[T] & { confidences: number[] }>()
    trace.step(`[PEERS] Searching ${this.peerAddresses.length} peer${this.peerAddresses.length === 1 ? '' : 's'} for ${request.type}: ${request.query}`)
    for (const address of this.peerAddresses) {
      const peer = this.peers.get(address)
      if (!isPeer(peer, address)) continue
      if (!isOpened(peer, address)) continue
      const searchResult = await searchPeer(formulas, request, peer, results, installedPlugins, confirmedHashes, trace)
      for (const [hash, item] of searchResult.entries()) {
        results.set(BigInt(hash), item)
      }
    }
    trace.step(`[PEERS] Received ${results.size} results`)
    return new Map<bigint, SearchResult[T]>(Array.from(results.entries()).map(([hash, result]: [bigint, SearchResult[T] & { confidences: number[] }]) => ([hash, { ...result, confidence: avg(result.confidences) }])))
  }

  public sendMessage(envelope: MessageEnvelope, trace: Trace): number {
    if (this.isEnvelopeExpired(envelope)) {
      trace.step(`[HIP2] Not sending expired message for ${envelope.to}`)
      return 0
    }

    this.apiPeer?.sendMessagePacket({ envelope, hops: 0 }, trace)
    const sent = this.broadcastMessage(envelope, 0, trace)

    // Store message for offline recipient so it can be delivered when they connect
    this.storeHeldMessageIfOffline(envelope, trace)

    trace.step(`[HIP2] Broadcast message for ${envelope.to} to ${sent} peer${sent === 1 ? '' : 's'} at hop 0`)
    return sent
  }

  public sendRefreshUi(trace: Trace): number {
    let sent = 0
    for (const peer of this.connectedPeers) {
      if (peer.address !== '0x0') continue
      peer.sendRefreshUi(trace)
      sent++
    }
    return sent
  }

  public sendStoreMessage(envelope: MessageEnvelope, trace: Trace): number {
    return this.sendMessage(envelope, trace)
  }

  public updateRuntimeConfig(update: import('../types/hydrabase').RuntimeConfigUpdate, updatedBy: string) {
    return this.runtimeSettings.update(update, updatedBy)
  }

  private broadcastMessage(envelope: MessageEnvelope, hops: number, trace: Trace, excludeAddress?: `0x${string}`): number {
    let sent = 0
    for (const peer of this.connectedPeers) {
      if (peer.address === '0x0') continue
      if (excludeAddress && peer.address === excludeAddress) continue
      peer.sendMessagePacket({ envelope, hops }, trace)
      sent++
    }
    return sent
  }

  private clearReconnectState(hostname: `${string}:${number}`): void {
    const normalizedHostname = PeerManager.normalizeHostname(hostname)
    const timer = this.reconnectTimers.get(normalizedHostname)
    if (timer) {
      clearTimeout(timer)
      this.reconnectTimers.delete(normalizedHostname)
    }
    this.reconnectAttempts.delete(normalizedHostname)
  }

  private consumeConnectionFailure(hostname: `${string}:${number}`): null | { hostname: `${string}:${number}`; reason: string; stack?: string; timestamp: number; transport: 'TCP' | 'UTP' } {
    const failure = this.recentConnectionFailures.get(hostname)
    if (!failure) return null
    this.recentConnectionFailures.delete(hostname)
    const now = Number(new Date())
    if (failure.timestamp + PeerManager.RECENT_CONNECTION_FAILURE_TTL_MS <= now) return null
    return failure
  }

  private findConnectedPeerByHostname(hostname: `${string}:${number}`): Peer | undefined {
    const normalizedHostname = PeerManager.normalizeHostname(hostname)
    return this.connectedPeers.find(peer => peer.address !== '0x0' && PeerManager.normalizeHostname(peer.hostname) === normalizedHostname)
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

    for (const message of valid) peer.sendMessagePacket({ envelope: message, hops: 0 }, trace)
    this.heldMessages.delete(peer.address)
    trace.success()
  }

  private forwardLocalHistoryToPeer(peer: Peer) {
    if (peer.address === '0x0') return
    const now = Number(new Date())
    const relevant = this.localMessageHistory.filter(m => m.to === peer.address && !this.isEnvelopeExpired(m, now))
    if (relevant.length === 0) return
    const trace = Trace.start(`[HIP2] Forwarding ${relevant.length} local history message${relevant.length === 1 ? '' : 's'} to ${peer.username} ${peer.address}`)
    for (const message of relevant) peer.sendMessagePacket({ envelope: message, hops: 0 }, trace)
    trace.success()
  }

  private hasSatisfiedConnection(hostname: `${string}:${number}`): boolean {
    const normalizedHostname = PeerManager.normalizeHostname(hostname)
    if (this.connectingPeers.has(normalizedHostname)) return true
    if (this.findConnectedPeerByHostname(normalizedHostname)) return true

    const resolvedAddress = this.resolveKnownPeerAddress(normalizedHostname)
    return resolvedAddress ? this.has(resolvedAddress) : false
  }

  // eslint-disable-next-line class-methods-use-this
  private isEnvelopeExpired(envelope: MessageEnvelope, now = Number(new Date())): boolean {
    return envelope.timestamp + envelope.ttl <= now
  }

  private notifyPeerConnected(peer: Peer): void {
    this.peerConnectedHandlers.forEach(handler => {
      Promise.resolve(handler(peer)).catch(error => {
        warn('DEVWARN:', `[PEERS] onPeerConnected handler failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    })
  }

  private notifyPeerDisconnected(peer: Peer): void {
    this.peerDisconnectedHandlers.forEach(handler => handler(peer))
  }

  private notifyPeerOfRecentConnectionFailure(peer: Peer, trace: Trace): void {
    if (peer.address === '0x0') return

    const normalizedHostname = PeerManager.normalizeHostname(peer.hostname)
    const failure = this.consumeConnectionFailure(normalizedHostname)
    if (!failure) return

    const occurredAt = new Date(failure.timestamp).toISOString()
    const payload = PeerManager.buildConnectionFailurePayload({
      at: occurredAt,
      hostname: failure.hostname,
      reason: failure.reason,
      transport: failure.transport,
      ...(failure.stack ? { stack: failure.stack } : {}),
    })
    this.createAndSendMessage(peer.address, payload, trace)
    trace.step(`[PEERS] Sent reciprocal failed-connect notification to ${peer.username} (${truncateAddress(peer.address)}) for ${failure.hostname}`)
  }

  private pruneExpiredConnectionFailures() {
    const now = Number(new Date())
    for (const [hostname, failure] of this.recentConnectionFailures.entries()) {
      if (failure.timestamp + PeerManager.RECENT_CONNECTION_FAILURE_TTL_MS <= now) this.recentConnectionFailures.delete(hostname)
    }
  }

  private pruneExpiredHeldMessages() {
    const now = Number(new Date())
    for (const [recipient, messages] of this.heldMessages.entries()) {
      const valid = messages.filter(message => !this.isEnvelopeExpired(message, now))
      if (valid.length === 0) this.heldMessages.delete(recipient)
      else if (valid.length !== messages.length) this.heldMessages.set(recipient, valid)
    }
  }

  private pruneExpiredLocalHistory() {
    const now = Number(new Date())
    const before = this.localMessageHistory.length
    this.localMessageHistory.splice(0, before, ...this.localMessageHistory.filter(m => !this.isEnvelopeExpired(m, now)))
  }

  private recordConnectionFailure(hostname: `${string}:${number}`, reason: string, transport: 'TCP' | 'UTP', stack?: string) {
    const normalizedHostname = PeerManager.normalizeHostname(hostname)
    const trimmedReason = reason.replace(/\s+/gu, ' ').trim().slice(0, 240)
    const trimmedStack = stack
      ?.replace(/\r\n/gu, '\n')
      .trim()
      .slice(0, 4000)
    const timestamp = Number(new Date())
    if (this.recentConnectionFailures.has(normalizedHostname)) this.recentConnectionFailures.delete(normalizedHostname)
    this.recentConnectionFailures.set(normalizedHostname, {
      hostname: normalizedHostname,
      reason: trimmedReason || 'Connection failed',
      timestamp,
      transport,
      ...(trimmedStack ? { stack: trimmedStack } : {}),
    })

    const resolvedAddress = this.resolveKnownPeerAddress(normalizedHostname)
    if (resolvedAddress) {
      const occurredAt = new Date(timestamp).toISOString()
      const payload = PeerManager.buildConnectionFailurePayload({
        at: occurredAt,
        hostname: normalizedHostname,
        reason: trimmedReason || 'Connection failed',
        transport,
        ...(trimmedStack ? { stack: trimmedStack } : {}),
      })
      const trace = Trace.start(`[PEERS] Emitting immediate failed-connect notification for ${normalizedHostname}`)
      this.createAndSendMessage(resolvedAddress, payload, trace)
      trace.success()
      this.recentConnectionFailures.delete(normalizedHostname)
    }

    while (this.recentConnectionFailures.size > PeerManager.RECENT_CONNECTION_FAILURE_MAX) {
      const oldest = this.recentConnectionFailures.keys().next()
      if (oldest.done) break
      this.recentConnectionFailures.delete(oldest.value)
    }
  }

  private recordLocalMessage(envelope: MessageEnvelope) {
    const envelopeHash = Bun.hash(JSON.stringify(envelope))
    if (this.localMessageHistory.some(m => Bun.hash(JSON.stringify(m)) === envelopeHash)) return
    this.localMessageHistory.push(envelope)
  }

  private removePeerAnnouncements(address: `0x${string}`): void {
    this.announcedByPeer.delete(address)
    this.announcedHostnamesByPeer.delete(address)
    // Intentionally keep the peer as an announcer in other peers' sets so
    // that "Announced" data survives disconnections.
  }

  private resolveKnownPeerAddress(hostname: `${string}:${number}`): `0x${string}` | null {
    const connected = this.connectedPeers.find(peer => peer.address !== '0x0' && PeerManager.normalizeHostname(peer.hostname) === hostname)
    if (connected) return connected.address

    const recent = this.recentPeerAddresses.get(hostname)
    if (recent) return recent

    const fromAuthCache = authenticatedPeers.get(hostname)?.address
    if (fromAuthCache && fromAuthCache.startsWith('0x')) return fromAuthCache as `0x${string}`

    return null
  }

  private scheduleReconnect(hostname: `${string}:${number}`) {
    if (hostname === 'API:0') return
    const normalizedHostname = PeerManager.normalizeHostname(hostname)
    const existing = this.reconnectTimers.get(normalizedHostname)
    if (existing) clearTimeout(existing)

    const attempt = (this.reconnectAttempts.get(normalizedHostname) ?? 0) + 1
    if (attempt > PeerManager.RECONNECT_MAX_ATTEMPTS) {
      warn('WARN:', `[PEERS] Giving up reconnection to ${normalizedHostname} after ${PeerManager.RECONNECT_MAX_ATTEMPTS} attempts`)
      this.reconnectAttempts.delete(normalizedHostname)
      this.reconnectTimers.delete(normalizedHostname)
      return
    }

    const delay = Math.min(PeerManager.RECONNECT_BASE_DELAY_MS * 2**(attempt - 1), PeerManager.RECONNECT_MAX_DELAY_MS)

    this.reconnectAttempts.set(normalizedHostname, attempt)
    const trace = Trace.start(`[PEERS] Reconnecting to ${normalizedHostname} (attempt ${attempt}/${PeerManager.RECONNECT_MAX_ATTEMPTS}, delay ${delay / 1000}s)`)

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(normalizedHostname)
      if (this.hasSatisfiedConnection(normalizedHostname)) {
        trace.step(`[PEERS] Reconnect already satisfied for ${normalizedHostname}; skipping duplicate attempt`)
        trace.success()
        this.reconnectAttempts.delete(normalizedHostname)
        return
      }

      this.knownPeers.delete(normalizedHostname)
      const success = await this.add(normalizedHostname, trace)
      if (success || this.hasSatisfiedConnection(normalizedHostname)) {
        if (!success) trace.step(`[PEERS] Reconnect resolved by existing connection for ${normalizedHostname}`)
        trace.success()
        this.reconnectAttempts.delete(normalizedHostname)
      } else {
        this.recordConnectionFailure(normalizedHostname, 'Reconnection failed', this.nodeConfig.preferTransport, trace.getFullTrace())
        trace.fail('Reconnection failed')
        this.scheduleReconnect(normalizedHostname)
      }
    }, delay)
    this.reconnectTimers.set(normalizedHostname, timer)
  }

  private shouldAuthenticate(hostname: `${string}:${number}`): string | true {
    const normalizedHostname = PeerManager.normalizeHostname(hostname)
    if (normalizedHostname === `${this.nodeConfig.hostname}:${this.nodeConfig.port}` || normalizedHostname === `${this.nodeConfig.ip}:${this.nodeConfig.port}`) return `[PEERS] Not connecting to self ${normalizedHostname}`
    if (this.knownPeers.has(normalizedHostname)) return `[PEERS] Already connected to peer ${normalizedHostname}`
    return true
  }

  private shouldConnect(hostname: `${string}:${number}`, identity: Identity): string | true {
    const normalizedHostname = PeerManager.normalizeHostname(hostname)
    if (this.has(identity.address)) return `[PEERS] Already connected/connecting to peer ${identity.username} ${identity.address} ${identity.hostname}`
    if (identity.address === this.account.address) return `[PEERS] Not connecting to self ${identity.address}`
    if (identity.hostname === `${this.nodeConfig.hostname}:${this.nodeConfig.port}`) return `[PEERS] Not connecting to self ${normalizedHostname}`
    if (identity.hostname === `${this.nodeConfig.ip}:${this.nodeConfig.port}`) return `[PEERS] Not connecting to self ${normalizedHostname}`
    if (identity.hostname !== normalizedHostname && this.knownPeers.has(identity.hostname)) return `[PEERS] Not connecting to self ${normalizedHostname}`
    if (this.peers.has(identity.address)) return `[PEERS] Skipping connection to ${identity.username} ${identity.address} - already connected`
    return true
  }

  private storeHeldMessageIfOffline(envelope: MessageEnvelope, trace: Trace): void {
    if (this.peers.get(envelope.to)) return
    const held = this.heldMessages.get(envelope.to) ?? []
    if (held.some(m => m.sig === envelope.sig)) {
      trace.step(`[HIP2] Skipped duplicate held message for offline recipient ${envelope.to}`)
      return
    }
    held.push(envelope)
    this.heldMessages.set(envelope.to, held)
    trace.step(`[HIP2] Stored message for offline recipient ${envelope.to}`)
  }

  private syncHeldMessagesToPeer(peer: Peer) {
    if (peer.address === '0x0') return

    const trace = Trace.start(`[HIP2] Syncing held message memory to ${peer.username} ${peer.address}`)
    const now = Number(new Date())
    let sent = 0

    for (const [recipient, messages] of this.heldMessages.entries()) {
      if (recipient === peer.address) continue

      const valid = messages.filter(message => !this.isEnvelopeExpired(message, now))
      if (valid.length === 0) {
        this.heldMessages.delete(recipient)
        continue
      }
      if (valid.length !== messages.length) this.heldMessages.set(recipient, valid)

      for (const message of valid) {
        peer.sendMessagePacket({ envelope: message, hops: 0 }, trace)
        sent++
      }
    }

    trace.step(`[HIP2] Synced ${sent} held message${sent === 1 ? '' : 's'} to ${peer.address}`)
    trace.success()
  }

  private async toPeer(hostname: `${string}:${number}`, preferTransport: 'TCP' | 'UTP', trace: Trace): Promise<false | Socket> {
    trace.step(`[PEERS][CONNECT] Creating socket to ${hostname} (prefer ${preferTransport})`)
    const normalizedHostname = PeerManager.normalizeHostname(hostname)
    const shouldAuthenticate = this.shouldAuthenticate(normalizedHostname)
    if (typeof shouldAuthenticate === 'string') {
      trace.step(`[PEERS][CONNECT] ${shouldAuthenticate}`)
      return trace.softFail(shouldAuthenticate)
    }

    trace.step(`[PEERS][CONNECT] Authenticating ${normalizedHostname} using ${preferTransport}`)
    const identity = await authenticatePeer(hostname, preferTransport, trace)
    if (Array.isArray(identity)) {
      trace.step(`[PEERS][CONNECT] Authentication failed for ${normalizedHostname} (${preferTransport}): ${identity[1]}`)
      return trace.softFail(identity[1])
    }

    const shouldConnect = this.shouldConnect(normalizedHostname, identity)
    if (typeof shouldConnect === 'string') {
      trace.step(`[PEERS][CONNECT] ${shouldConnect}`)
      return trace.softFail(shouldConnect)
    }

    trace.step(`[PEERS][CONNECT] Attempting primary transport: ${preferTransport}`)
    const firstSocket = await this.tryTransport(hostname, normalizedHostname, preferTransport, identity, trace, 'Primary')
    if (typeof firstSocket === 'object') {
      trace.step(`[PEERS][CONNECT] Connected using ${preferTransport}`)
      trace.success()
      return firstSocket
    }
    if (typeof firstSocket === 'string') {
      trace.step(`[PEERS][CONNECT] Primary transport (${preferTransport}) failed: ${firstSocket}`)
      // continue to fallback
    }

    const fallbackTransport = preferTransport === 'TCP' ? 'UTP' : 'TCP'
    trace.step(`[PEERS][CONNECT] Retrying ${normalizedHostname} via fallback transport: ${fallbackTransport}`)
    const socket = await this.tryTransport(hostname, normalizedHostname, fallbackTransport, identity, trace, 'Fallback')
    if (typeof socket === 'object') {
      trace.step(`[PEERS][CONNECT] Connected using fallback transport: ${fallbackTransport}`)
      trace.success()
      return socket
    }
    if (typeof socket === 'string') {
      trace.step(`[PEERS][CONNECT] Fallback transport (${fallbackTransport}) failed: ${socket}`)
      return trace.softFail(socket)
    }
    trace.caughtError('[PEERS][CONNECT] Peer verification failed after all transports')
    return false
  }

  private async toSocket(hostname: `${string}:${number}`, preferTransport: 'TCP' | 'UTP', trace: Trace, identity: Identity): Promise<false | Socket | string> {
    trace.step(`[PEERS] Opening ${preferTransport} socket to ${hostname}`)
    if (hostname === `${this.nodeConfig.hostname}:${this.nodeConfig.port}` || hostname === `${this.nodeConfig.ip}:${this.nodeConfig.port}`) {
      trace.step('[PEERS] Socket attempt rejected: attempted to connect to self')
      return 'Attempted to connect to self'
    }
    switch (preferTransport) {
      case 'TCP':
        return await WebSocketClient.init(identity, this.account, this.nodeConfig, this.metadataManager.installedPlugins.map(plugin => plugin.id), trace)
      case 'UTP': {
        if (!this.utpSocket) return 'UTP unavailable in current runtime'
        const localHostname = `${this.nodeConfig.hostname}:${this.nodeConfig.port}` as `${string}:${number}`
        return UTPClient.connectToAuthenticatedPeer(identity, this.utpSocket, localHostname, trace) || 'UTP connection failed'
      }
      default:
        return 'Invalid transport preference'
    }
  }
  
  private async tryTransport(
    hostname: `${string}:${number}`,
    normalizedHostname: `${string}:${number}`,
    preferTransport: 'TCP' | 'UTP',
    identity: Identity,
    trace: Trace,
    phase: 'Fallback' | 'Primary',
  ): Promise<false | Socket | string> {
    const transportTrace = trace.child(`[PEERS] Transport attempt ${preferTransport} -> ${normalizedHostname}`)
    let socket: false | Socket | string
    try {
      socket = await this.toSocket(hostname, preferTransport, transportTrace, identity)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      transportTrace.step(`[PEERS] ${phase} transport threw: ${message}`)
      transportTrace.softFail(message)
      return message
    }
    if (typeof socket === 'object') {
      transportTrace.success()
      return socket
    }
    if (typeof socket === 'string') {
      transportTrace.step(`[PEERS] ${phase} transport failed: ${socket}`)
      transportTrace.softFail(socket)
      return socket
    }
    transportTrace.caughtError('Peer verification failed')
    return false
  }
}
