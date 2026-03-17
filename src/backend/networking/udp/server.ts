import bencode from 'bencode'
import dgram from 'dgram'
import z from 'zod'

import type { Config } from '../../../types/hydrabase'
import type PeerManager from '../../PeerManager'

import { debug, error, log, warn } from '../../../utils/log'
import { FSMap } from '../../FSMap'
import { type Identity, proveServer } from '../../protocol/HIP1/handshake'
import { authenticateServerUDP, UDP_Client } from './client'

export const authenticatedPeers = new FSMap<`${string}:${number}`, Identity>('./data/authenticated-peers.json')
export const udpConnections = new Map<`${string}:${number}`, UDP_Client>()
type ResponseAwaiter = (msg: Message, rinfo: { address: string, port: number }) => boolean

const decoder = new TextDecoder()
const BinaryString = z.instanceof(Uint8Array).transform(m => decoder.decode(m))
const BinaryHex = z.instanceof(Uint8Array).transform(m => m.toHex())

export const AuthSchema = z.object({
  address: BinaryString,
  hostname: BinaryString,
  signature: BinaryString,
  userAgent: BinaryString,
  username:  BinaryString,
}).strict()
const BaseMessage = z.object({
  t: BinaryString.optional(),
})
const QueryMessage = BaseMessage.extend({
  a: z.object({
    c: BinaryString.optional(),
    d: BinaryString.optional(),
    i: z.number().optional(),
    id: BinaryString,
    n: z.number().optional(),
  }),
  q: BinaryString,
  y: z.literal('q'),
})
const HydraAuthQueryMessage = BaseMessage.extend({
  a: AuthSchema.extend({
    id: BinaryString,
  }).strict(),
  q: z.literal('hydra_auth'),
  y: z.literal('q'),
}).strict()
const HandshakeDiscoverySchema = BaseMessage.extend({
  y: z.literal('h0')
}).strict()
const HandshakeDiscoveryResponseSchema = BaseMessage.extend({
  h0r: AuthSchema,
  y: z.literal('h0r')
}).strict()
const HandshakeRequestSchema = BaseMessage.extend({ 
  h1: AuthSchema,
  id: BinaryHex,
  y: z.literal('h1') 
}).strict()
const HandshakeResponseSchema = BaseMessage.extend({ 
  h2: AuthSchema,
  y: z.literal('h2')
}).strict()
const ResponseMessageSchema = BaseMessage.extend({
  r: z.object({}),
  y: z.literal('r'),
})
const ErrorMessage = BaseMessage.extend({
  e: z.union([
    z.tuple([z.number(), BinaryString]),
    z.tuple([BinaryString]),
    z.tuple([z.number()]),
  ]),
  y: z.literal('e'),
})
export type HandshakeDiscovery = z.infer<typeof HandshakeDiscoverySchema>
export type HandshakeDiscoveryResponse = z.infer<typeof HandshakeDiscoveryResponseSchema>
export type HandshakeRequest = z.infer<typeof HandshakeRequestSchema>
export type HandshakeResponse = z.infer<typeof HandshakeResponseSchema>
export type HydraAuthQuery = z.infer<typeof HydraAuthQueryMessage>
export type Query = z.infer<typeof QueryMessage>
export const rpcMessageSchema = z.preprocess((msg: Record<string, unknown> & { y: Uint8Array }) => ({
  ...msg,
  y: decoder.decode(msg.y),
}), z.union([
  HydraAuthQueryMessage,
  z.discriminatedUnion('y', [
    QueryMessage,
    ResponseMessageSchema,
    ErrorMessage,
    HandshakeDiscoverySchema,
    HandshakeDiscoveryResponseSchema,
    HandshakeRequestSchema,
    HandshakeResponseSchema,
  ])
]))
type Message = z.infer<typeof rpcMessageSchema>

const handleHydraQuery = (server: UDP_Server, query: Query, peerHostname: `${string}:${number}`, peerManager: PeerManager, node: Config['node']): boolean => {
  if (!authenticatedPeers.has(peerHostname)) {
    warn('DEVWARN:', `[UDP] [SERVER] Received message from unauthenticated peer ${peerHostname}`)
    authenticateServerUDP(server, peerHostname, peerManager.account, node).then(result => {
      if (Array.isArray(result)) warn('DEVWARN:', `[UDP] [SERVER] Re-auth failed for ${peerHostname}: ${result[1]}`)
      else debug(`[UDP] [SERVER] Re-authenticated ${peerHostname} as ${result.username}`)
    })
    return false
  }
  const connection = udpConnections.get(peerHostname)
  if (!connection) {
    warn('DEVWARN:', `[UDP] [SERVER] Couldn't find connection ${peerHostname}`)
    authenticateServerUDP(server, peerHostname, peerManager.account, node).then(result => {
      if (Array.isArray(result)) warn('DEVWARN:', `[UDP] [SERVER] Re-auth failed for ${peerHostname}: ${result[1]}`)
      else debug(`[UDP] [SERVER] Re-authenticated ${peerHostname} as ${result.username}`)
    })
    return false
  }
  if (query.a.n !== undefined && query.a.n > 1) {
    if (query.a.c === undefined || query.a.i === undefined || query.a.d === undefined) {
      warn('DEVWARN:', `[UDP] [SERVER] Malformed chunk from ${peerHostname}: missing c, i, or d`)
      return false
    }
    server.processChunk(query.a.c, query.a.i, query.a.n, query.a.d, connection)
    return true
  }
  const message = query.a['d']
  if (!message) return false
  connection.messageHandlers.forEach(handler => handler(message))
  return connection.messageHandlers.length === 0 ? warn('DEVWARN:', `[UDP] [SERVER] Couldn't find message handler ${peerHostname}`) : true
}

const handleHandshake = async (server: UDP_Server, socket: dgram.Socket, peerManager: PeerManager, query: Message, peerHostname: `${string}:${number}`, peer: { host: string, port: number }, node: Config['node'], config: Config['rpc'], apiKey: string | undefined): Promise<boolean> => {
  if (query.y === 'h0') {
    debug(`[UDP] [HANDSHAKE] Received h0 discovery from ${peerHostname}`)
    socket.send(bencode.encode({ h0r: proveServer(peerManager.account, node), t: query.t, y: 'h0r' } satisfies HandshakeDiscoveryResponse), peer.port, peer.host)
    return true
  } else if (query.y === 'h1') {
    log(`[UDP] [HANDSHAKE] Received h1 from ${peerHostname} txnId=${query.t} address=${query.h1.address} hostname=${query.h1.hostname}`)
    const result = await UDP_Client.connectToUnauthenticatedPeer(peerManager, query, peerHostname, node, config, apiKey, socket, server)
    debug(`[UDP] [HANDSHAKE] h1 processing for ${peerHostname}: ${result ? 'success' : 'failed'}`)
    return result ? true : warn('DEVWARN:', '[UDP] [SERVER] Failed to validate UDP auth')
  } else if (query.y === 'h2') {
    warn('DEVWARN:', `[UDP] [HANDSHAKE] Received h2 from ${peerHostname} txnId=${query.t} but no awaiter matched — this means the txnId doesn't match any pending auth request`)
    return false
  } else if (query.y === 'h0r') {
    debug(`[UDP] [HANDSHAKE] Received orphaned h0r from ${peerHostname}`)
    return false
  }
  return false
}

const messageHandler = async (server: UDP_Server, socket: dgram.Socket, peerManager: PeerManager, query: Message, peer: { host: string, port: number }, node: Config['node'], config: Config['rpc'], apiKey: string | undefined): Promise<boolean> => {
  const peerHostname = `${peer.host}:${peer.port}` as const
  if (query.y === 'e') return warn('DEVWARN:', `[UDP] [SERVER] Peer threw ${peerHostname} error - ${query.e.join(' ')}`) 
  if (query.y === 'q' && 'q' in query && query.q === 'hydra_auth') {
    debug(`[UDP] [AUTH] Received hydra_auth query from ${peerHostname}`)
    return false
  }
  if (query.y === 'h0' || query.y === 'h1' || query.y === 'h2' || query.y === 'h0r') return await handleHandshake(server, socket, peerManager, query, peerHostname, peer, node, config, apiKey)
  if (query.y === 'q') {
    if (!query.q.startsWith(config.prefix)) return false
    log('[UDP] Received query', query)
    return handleHydraQuery(server, query as Query, peerHostname, peerManager, node)
  }
  if (query.y === 'r') return false
  log(`[UDP] [SERVER] Unhandled query`, {query})
  return false
}

interface ChunkGroup {
  chunks: Map<number, string>
  firstSeen: number
  timer: NodeJS.Timeout
  total: number
}

export class UDP_Server {
  private readonly chunkBuffer = new Map<string, ChunkGroup>()
  private readonly MAX_CHUNK_GROUPS = 50
  private readonly responseAwaiters = new Map<string, ResponseAwaiter>()

  private constructor(peerManager: () => PeerManager, public readonly socket: dgram.Socket, node: Config['node'], config: Config['rpc'], apiKey: string | undefined) {
    socket.on('error', err => {
      error('ERROR:', `[UDP] [SERVER] An error was thrown ${err.name} - ${err.message}`)
      socket.close()
    })
    socket.on('message', async (_msg, peer) => {
      let decoded: unknown
      try {
        decoded = bencode.decode(_msg)
      } catch {
        return
      }
      const result = rpcMessageSchema.safeParse(decoded)
      if (!result.data) {
        warn('DEVWARN:', '[UDP] [SERVER] Unexpected payload', { err: result.error, payload: decoded })
        return
      }
      const awaiter = result.data.t ? this.responseAwaiters.get(result.data.t) : undefined
      if (awaiter && result.data.t) {
        debug(`[UDP] [SERVER] Awaiter matched for txnId=${result.data.t}`)
        const done = awaiter(result.data, { address: peer.address, port: peer.port })
        if (done) {
          this.responseAwaiters.delete(result.data.t)
          return
        }
      }
      if (result.data.y === 'h2') debug(`[UDP] [SERVER] No awaiter for h2 txnId=${result.data.t}, registered awaiters: ${[...this.responseAwaiters.keys()].join(', ')}`)
      await messageHandler(this, socket, peerManager(), result.data, { host: peer.address, port: peer.port }, node, config, apiKey)
    })
  }

  static init(peerManager: () => PeerManager, config: Config['rpc'], node: Config['node'], apiKey: string | undefined): Promise<UDP_Server> {
    const server = dgram.createSocket('udp4')
    // server.bind(port)

    return new Promise<UDP_Server>(res => {
      // server.on('listening', () => {
      //   const {address,port} = server.address()
      //   log(`[UDP] [SERVER] listening at ${address}:${port}`)
      //   res(new UDP_Server(server))
      // })
      res(new UDP_Server(peerManager, server, node, config, apiKey))
    })
  }

  public readonly awaitResponse = (txnId: string, handler: ResponseAwaiter) => this.responseAwaiters.set(txnId, handler)
  public readonly cancelAwaiter = (txnId: string) => this.responseAwaiters.delete(txnId)
  
  public readonly processChunk = (chunkId: string, chunkIndex: number, totalChunks: number, chunkData: string, connection: UDP_Client): void => {
    if (this.chunkBuffer.size >= this.MAX_CHUNK_GROUPS && !this.chunkBuffer.has(chunkId)) {
      this.evictOldestChunkGroup()
    }
    
    let group = this.chunkBuffer.get(chunkId)
    if (!group) {
      const timer = setTimeout(() => {
        this.chunkBuffer.delete(chunkId)
        warn('DEVWARN:', `[UDP] [SERVER] Chunk reassembly timeout for chunkId=${chunkId} (received ${group?.chunks.size || 0}/${totalChunks} chunks)`)
      }, 10_000)
      group = { chunks: new Map(), firstSeen: Date.now(), timer, total: totalChunks }
      this.chunkBuffer.set(chunkId, group)
    }
    
    group.chunks.set(chunkIndex, chunkData)
    debug(`[UDP] [SERVER] Received chunk ${chunkIndex + 1}/${totalChunks} for chunkId=${chunkId}`)
    
    if (group.chunks.size === totalChunks) {
      clearTimeout(group.timer)
      this.chunkBuffer.delete(chunkId)
      
      const reassembled = Array.from({ length: totalChunks }, (_, i) => group.chunks.get(i) || '').join('')
      debug(`[UDP] [SERVER] Reassembled message from chunkId=${chunkId}: ${reassembled.length} bytes`)
      
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
      warn('DEVWARN:', `[UDP] [SERVER] Evicted oldest chunk group ${oldestKey} (buffer full)`)
    }
  }
}