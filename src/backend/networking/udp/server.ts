import bencode from 'bencode'
import dgram from 'dgram'
import z from 'zod'

import type { Config } from '../../../types/hydrabase'
import type { Account } from '../../crypto/Account'
import type { AuthenticatedPeerRepository } from '../../db/repositories/AuthenticatedPeerRepository'

import { debug, error, log, logContext, warn } from '../../../utils/log'
import { Trace } from '../../../utils/trace'
import { decoder, ErrorMessage, type Query, QueryMessage, ResponseMessageSchema } from '../../protocol/DHT'
import { type Identity } from '../../protocol/HIP1_Identity'
import { authenticateServerUDP, H0_HandshakeDiscoverySchema, H0R_HandshakeDiscoveryResponseSchema, H1_HandshakeRequestSchema, H2_HandshakeResponseSchema, handleHandshake } from '../../protocol/HIP5_IdentityDiscovery'
import { isAllowedPeer } from '../utils'
import { UDP_Client } from './client'

let _repo: AuthenticatedPeerRepository | undefined

interface AuthenticatedPeersStore {
  clear(): void
  get(hostname: `${string}:${number}`): Identity | undefined
  init(repo: AuthenticatedPeerRepository): void
  set(hostname: `${string}:${number}`, identity: Identity): AuthenticatedPeersStore
  values(): Identity[]
}

export const authenticatedPeers: AuthenticatedPeersStore = {
  clear(): void { _repo?.clear() },
  get(hostname: `${string}:${number}`): Identity | undefined { return _repo?.get(hostname) },
  init(repo: AuthenticatedPeerRepository): void { _repo = repo },
  set(hostname: `${string}:${number}`, identity: Identity): AuthenticatedPeersStore { _repo?.set(hostname, identity); return authenticatedPeers },
  values(): Identity[] { return _repo?.values() ?? [] },
}
export const udpConnections = new Map<`${string}:${number}`, UDP_Client>()

type ResponseAwaiter = (msg: RPCMessage, rinfo: { address: string, port: number }) => boolean

const isVersionOnlyProbe = (payload: unknown): payload is { v: Uint8Array } => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const obj = payload as Record<string, unknown>
  const keys = Object.keys(obj)
  return keys.length === 1 && keys[0] === 'v' && obj['v'] instanceof Uint8Array
}

export const rpcMessageSchema = z.preprocess((msg: Record<string, unknown> & { y: Uint8Array }) => {
  const type = decoder.decode(msg.y)
  return {
    ...msg,
    // Some peers send rate-limit errors with y='r' and an e tuple; treat them as error messages.
    y: type === 'r' && msg['e'] !== undefined && msg['r'] === undefined ? 'e' : type,
  }
}, z.discriminatedUnion('y', [
  QueryMessage,
  ResponseMessageSchema,
  ErrorMessage,
  H0_HandshakeDiscoverySchema,
  H0R_HandshakeDiscoveryResponseSchema,
  H1_HandshakeRequestSchema,
  H2_HandshakeResponseSchema,
]))
export type RPCMessage = z.infer<typeof rpcMessageSchema>

const handleHydraQuery = (server: UDP_Server, query: Query, peerHostname: `${string}:${number}`, account: Account, node: Config['node']): boolean => {
  const identity = authenticatedPeers.get(peerHostname)
  if (!identity) {
    const trace = Trace.start(`[SERVER] Received message ${query.q} from unauthenticated peer ${peerHostname}`)
    authenticateServerUDP(server, peerHostname, account, node, trace).then(result => {
      if (Array.isArray(result)) {
        trace.softFail(`[SERVER] Re-auth failed for ${peerHostname}: ${result[1]}`)
      } else {
        trace.step(`[SERVER] Re-authenticated ${peerHostname} as ${result.username}`)
        trace.success()
      }
    })
    return false
  }
  const connection = udpConnections.get(peerHostname) ?? udpConnections.get(identity.hostname as `${string}:${number}`)
  if (!connection) {
    const trace = Trace.start(`[SERVER] Initiating connection with authenticated peer ${peerHostname}`)
    authenticateServerUDP(server, peerHostname, account, node, trace).then(result => {
      if (Array.isArray(result)) {
        trace.softFail(`[SERVER] Re-auth failed for ${peerHostname}: ${result[1]}`)
      } else {
        trace.step(`[SERVER] Re-authenticated ${peerHostname} as ${result.username}`)
        trace.success()
      }
    })
    return false
  }
  if (!udpConnections.has(peerHostname)) udpConnections.set(peerHostname, connection)
  if (query.a.n !== undefined && query.a.n > 1) {
    if (query.a.c === undefined || query.a.i === undefined || query.a.d === undefined) {
      warn('DEVWARN:', `[SERVER] Malformed chunk from ${peerHostname}: missing c, i, or d`)
      return false
    }
    server.processChunk(query.a.c, query.a.i, query.a.n, query.a.d, connection)
    return true
  }
  const message = query.a['d']
  if (!message) return false
  connection.messageHandlers.forEach(handler => handler(message))
  return connection.messageHandlers.length === 0 ? warn('DEVWARN:', `[SERVER] Couldn't find message handler ${peerHostname}`) : true
}

const messageHandler = async (server: UDP_Server, socket: dgram.Socket, account: Account, query: RPCMessage, peer: { host: string, port: number }, node: Config['node'], config: Config['rpc'], apiKey: string | undefined, addPeer: (client: UDP_Client, trace: Trace) => Promise<boolean>): Promise<boolean> => {
  const peerHostname = `${peer.host}:${peer.port}` as const
  if (query.y === 'e') {
    if (isAllowedPeer(peer.host, peer.port)) return warn('DEVWARN:', `[SERVER] Peer threw ${peerHostname} error - ${query.e.join(' ')}`)
    return false
  }
  if (query.y === 'h0' || query.y === 'h1' || query.y === 'h2' || query.y === 'h0r') return await handleHandshake(server, socket, account, query, peerHostname, peer, node, config, apiKey, addPeer)
  if (query.y === 'q') {
    if (!query.q.startsWith(config.prefix)) return false
    return handleHydraQuery(server, query as Query, peerHostname, account, node)
  }
  if (query.y === 'r') return false
  log('[SERVER] Unhandled query', {query})
  return false
}

interface ChunkGroup {
  chunks: Map<number, string>
  firstSeen: number
  timer: NodeJS.Timeout
  total: number
}

interface InboundRateState {
  blockedUntil: number
  lastWarnAt: number
  messageCount: number
  windowStart: number
}

export class UDP_Server {
  private readonly chunkBuffer = new Map<string, ChunkGroup>()
  private readonly INBOUND_BLOCK_MS = 30_000
  private readonly INBOUND_RATE_MAX_MESSAGES = 120
  private readonly INBOUND_RATE_WINDOW_MS = 1_000
  private readonly INBOUND_WARN_COOLDOWN_MS = 5_000
  private readonly inboundRateState = new Map<string, InboundRateState>()
  private readonly MAX_CHUNK_GROUPS = 50
  private readonly MAX_INBOUND_TRACKED_PEERS = 1_000
  private readonly responseAwaiters = new Map<string, ResponseAwaiter>()

  private constructor(account: Account, public readonly socket: dgram.Socket, node: Config['node'], config: Config['rpc'], apiKey: string | undefined, addPeer: (client: UDP_Client, trace: Trace) => Promise<boolean>) {
    socket.on('error', err => {
      error('ERROR:', `[SERVER] An error was thrown ${err.name} - ${err.message}`)
      socket.close()
    })
    socket.on('message', (_msg, peer) => logContext('UDP', async () => {
      if (this.shouldDropInbound(peer.address, peer.port)) return
      let decoded: unknown
      try {
        decoded = bencode.decode(_msg)
      } catch {
        return
      }
      const result = rpcMessageSchema.safeParse(decoded)
      if (!result.data) {
        if (isVersionOnlyProbe(decoded)) return
        warn('DEVWARN:', '[SERVER] Unexpected payload', { err: JSON.parse(result.error.message), payload: decoded })
        return
      }
      const awaiter = result.data.t ? this.responseAwaiters.get(result.data.t) : undefined
      if (awaiter && result.data.t) {
        debug(`[SERVER] Awaiter matched for txnId=${result.data.t}`)
        const done = awaiter(result.data, { address: peer.address, port: peer.port })
        if (done) {
          this.responseAwaiters.delete(result.data.t)
          return
        }
      }
      if (result.data.y === 'h2') debug(`[SERVER] No awaiter for h2 txnId=${result.data.t}, registered awaiters: ${[...this.responseAwaiters.keys()].join(', ')}`)
      await messageHandler(this, socket, account, result.data, { host: peer.address, port: peer.port }, node, config, apiKey, addPeer)
    }))
  }

  static init(account: Account, config: Config['rpc'], node: Config['node'], apiKey: string | undefined, addPeer: (client: UDP_Client, trace: Trace) => Promise<boolean>): Promise<UDP_Server> {
    const server = dgram.createSocket('udp4')
    server.bind(node.port)

    return new Promise<UDP_Server>(res => {
      server.on('listening', () => {
        const {address,port} = server.address()
        log(`[UDP] [SERVER] listening at ${address}:${port}`)
        res(new UDP_Server(account, server, node, config, apiKey, addPeer))
      })
    })
  }

  public readonly awaitResponse = (txnId: string, handler: ResponseAwaiter) => this.responseAwaiters.set(txnId, handler)
  public readonly cancelAwaiter = (txnId: string) => this.responseAwaiters.delete(txnId)
  
  public readonly processChunk = (chunkId: string, chunkIndex: number, totalChunks: number, chunkData: string, connection: UDP_Client): void => {
    if (this.chunkBuffer.size >= this.MAX_CHUNK_GROUPS && !this.chunkBuffer.has(chunkId)) this.evictOldestChunkGroup()
    
    let group = this.chunkBuffer.get(chunkId)
    if (!group) {
      const timer = setTimeout(() => {
        this.chunkBuffer.delete(chunkId)
        warn('DEVWARN:', `[SERVER] Chunk reassembly timeout for chunkId=${chunkId} (received ${group?.chunks.size || 0}/${totalChunks} chunks)`)
      }, 10_000)
      group = { chunks: new Map(), firstSeen: Date.now(), timer, total: totalChunks }
      this.chunkBuffer.set(chunkId, group)
    }
    
    group.chunks.set(chunkIndex, chunkData)
    // debug(`[SERVER] Received chunk ${chunkIndex + 1}/${totalChunks} for chunkId=${chunkId}`)
    
    if (group.chunks.size === totalChunks) {
      clearTimeout(group.timer)
      this.chunkBuffer.delete(chunkId)
      
      const reassembled = Array.from({ length: totalChunks }, (_, i) => group.chunks.get(i) || '').join('')
      debug(`[SERVER] Reassembled message from chunkId=${chunkId}: ${reassembled.length} bytes`)
      
      connection.messageHandlers.forEach(handler => handler(reassembled))
    }
  }

  private readonly evictOldestChunkGroup = () => {
    let oldestKey: null | string = null
    let oldestTime = Infinity
    for (const [key, group] of this.chunkBuffer.entries()) {
      if (group.firstSeen < oldestTime) {
        oldestTime = group.firstSeen
        oldestKey = key
      }
    }
    if (oldestKey) {
      const group = this.chunkBuffer.get(oldestKey)
      if (group) clearTimeout(group.timer)
      this.chunkBuffer.delete(oldestKey)
      warn('DEVWARN:', `[SERVER] Evicted oldest chunk group ${oldestKey} (buffer full)`)
    }
  }

  private readonly shouldDropInbound = (address: string, port: number): boolean => {
    const now = Date.now()
    const key = `${address}:${port}`
    const existing = this.inboundRateState.get(key)
    if (existing?.blockedUntil && existing.blockedUntil > now) {
      if (now - existing.lastWarnAt >= this.INBOUND_WARN_COOLDOWN_MS) {
        warn('DEVWARN:', `[SERVER] Dropping UDP from blocked peer ${key} (${existing.blockedUntil - now}ms remaining)`)
        existing.lastWarnAt = now
      }
      return true
    }

    const state: InboundRateState = existing ?? { blockedUntil: 0, lastWarnAt: 0, messageCount: 0, windowStart: now }
    if (now - state.windowStart >= this.INBOUND_RATE_WINDOW_MS) {
      state.windowStart = now
      state.messageCount = 0
      state.blockedUntil = 0
    }

    state.messageCount += 1
    if (state.messageCount > this.INBOUND_RATE_MAX_MESSAGES) {
      state.blockedUntil = now + this.INBOUND_BLOCK_MS
      if (now - state.lastWarnAt >= this.INBOUND_WARN_COOLDOWN_MS) {
        warn('WARN:', `[SERVER] Blocking UDP peer ${key} for ${this.INBOUND_BLOCK_MS}ms (rate ${state.messageCount}/${this.INBOUND_RATE_WINDOW_MS}ms)`)
        state.lastWarnAt = now
      }
      this.inboundRateState.set(key, state)
      return true
    }

    this.inboundRateState.set(key, state)
    if (this.inboundRateState.size > this.MAX_INBOUND_TRACKED_PEERS) {
      for (const [peerKey, peerState] of this.inboundRateState.entries()) {
        if (peerState.blockedUntil < now && now - peerState.windowStart > this.INBOUND_RATE_WINDOW_MS * 5) this.inboundRateState.delete(peerKey)
        if (this.inboundRateState.size <= this.MAX_INBOUND_TRACKED_PEERS) break
      }
    }
    return false
  }
}