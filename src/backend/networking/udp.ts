import bencode from 'bencode'
import dgram from 'dgram'
import z from 'zod'

import type { Config } from '../../types/hydrabase'
import type PeerManager from '../PeerManager'

import { error, log, warn } from '../../utils/log'
import { FSMap } from '../FSMap'
import { AuthSchema, type Identity, proveClient, proveServer, verifyClient } from '../protocol/HIP1/handshake'
import { RPC } from './rpc'

export const authenticatedPeers = new FSMap<`${string}:${number}`, Identity>('./data/authenticated-peers.json')
export const udpConnections = new Map<`${string}:${number}`, RPC>()

const decoder = new TextDecoder()
const BinaryString = z.instanceof(Uint8Array).transform(m => decoder.decode(m))
const BinaryHex = z.instanceof(Uint8Array).transform(m => `0x${m.toHex()}`)

const BaseMessage = z.object({
  t: BinaryHex,
  v: BinaryString.optional(),
  y: BinaryString,
}).strict()
const QueryMessage = BaseMessage.extend({
  a: z.record(z.string(), BinaryString),
  q: BinaryString,
  y: z.literal('q'),
}).strict()
const HandshakeRequestSchema = BaseMessage.extend({ 
  h1: AuthSchema,
  y: z.literal('h1') 
}).strict()
const HandshakeResponseSchema = BaseMessage.extend({ 
  h2: AuthSchema,
  y: z.literal('h2')
}).strict()
const ResponseMessageSchema = BaseMessage.extend({
  r: z.object({
    id: BinaryString,
    nodes: BinaryString.optional(),
    token: BinaryString.optional(),
    values: z.array(BinaryString).optional(),
  }).strict(),
  y: z.literal('r'),
}).strict()
const ErrorMessage = BaseMessage.extend({
  e: z.tuple([z.number(), BinaryString]),
  y: z.literal('e'),
}).strict()
export type Query = z.infer<typeof QueryMessage>
type Error = z.infer<typeof ErrorMessage>
type HandshakeRequest = z.infer<typeof HandshakeRequestSchema>
type HandshakeResponse = z.infer<typeof HandshakeResponseSchema>
const rpcMessageSchema = z.preprocess((msg: Record<string, unknown> & { y: Uint8Array }) => ({
  ...msg,
  y: decoder.decode(msg.y),
}), z.discriminatedUnion('y', [
  QueryMessage,
  ResponseMessageSchema,
  ErrorMessage,
  HandshakeRequestSchema,
  HandshakeResponseSchema,
]))
type Message = z.infer<typeof rpcMessageSchema>

export const fromOutbound = (socket: dgram.Socket, peerManager: PeerManager, identity: Identity, config: Config['rpc'], node: Config['node']): RPC => {
  const [host, port] = identity.hostname.split(':') as [string, `${number}`]
  socket.send(bencode.encode({ h1: proveClient(peerManager.account, node, identity.hostname), t: '0', y: 'h1' } satisfies HandshakeRequest), Number(port), host)
  return new RPC(peerManager, identity, config)
}

const authHandler = async (socket: dgram.Socket, peerManager: PeerManager, query: HandshakeRequest | HandshakeResponse, peer: { host: string, port: number }, config: Config['rpc'], node: Config['node'], apiKey: string | undefined, respond = true) => {
  const peerHostname = `${peer.host}:${peer.port}`
  log(`[RPC] Received auth from ${peerHostname}`)
  const headers = query.y === 'h1' ? query['h1'] : query['h2']
  if (headers.hostname !== peerHostname) {
    socket.send(bencode.encode({ h1: proveClient(peerManager.account, node, headers.hostname), t: query.t, y: 'h1' } satisfies HandshakeRequest), Number(headers.hostname.split(':')[1]), headers.hostname.split(':')[0])
    return
  }
  const identity = await verifyClient(node, peerHostname, headers, apiKey, () => [500, 'UDP hostname mismatch'])
  if (Array.isArray(identity)) {
    warn('DEVWARN:', `[RPC] Authentication failed ${peerHostname} - ${identity[1]}`)
    socket.send(bencode.encode({ e: [500, 'Failed to verify client'], t: query.t, y: 'e' } satisfies Error), peer.port, peer.host)
    return
  }
  log(`[RPC] Authenticated peer ${identity.username} ${identity.address} at ${identity.hostname}`)
  if (!udpConnections.has(identity.hostname)) peerManager.add(new RPC(peerManager, identity, config))
  if (respond) socket.send(bencode.encode({ h2: proveServer(peerManager.account, node), t: query.t, y: 'h2' } satisfies HandshakeResponse), peer.port, peer.host)
}

const validateUDPAuth = async (peerManager: PeerManager, auth: HandshakeRequest | HandshakeResponse, peerHostname: `${string}:${number}`, node: Config['node'], config: Config['rpc'], apiKey: string | undefined): Promise<boolean> => {
  const identity = await verifyClient(node, peerHostname, auth.y === 'h1' ? auth.h1 : auth.h2, apiKey, () => [500, 'UDP hostname mismatch'] as [number, string])
  if (Array.isArray(identity)) return warn('DEVWARN:', `[RPC] UDP auth query verification failed for ${peerHostname}: ${identity[1]}`)
  log(`[RPC] Authenticated peer ${identity.username} ${identity.address} at ${peerHostname} via UDP auth query`)
  authenticatedPeers.set(peerHostname, identity)
  if (!udpConnections.has(peerHostname)) peerManager.add(new RPC(peerManager, { ...identity, hostname: peerHostname }, config))
  return true
}

const messageHandler = async (socket: dgram.Socket, peerManager: PeerManager, query: Message, peer: { host: string, port: number }, node: Config['node'], config: Config['rpc'], apiKey: string | undefined): Promise<boolean> => {
  const peerHostname = `${peer.host}:${peer.port}` as const
  if (query.y === 'e') return warn('DEVWARN:', `[UDP] Peer threw error - ${query.e[0]} ${query.e[1]}`) 
  if (query.y === 'h1') socket.send(bencode.encode({ h2: proveServer(peerManager.account, node), t: query.t, y: 'h2' } satisfies HandshakeResponse), peer.port, peer.host)
  if (query.y === 'h1' || query.y === 'h2') return await validateUDPAuth(peerManager, query, peerHostname, node, config, apiKey) ? true : warn('DEVWARN:', '[UDP] Failed to validate UDP auth')
  if (!authenticatedPeers.has(peerHostname)) {
    warn('DEVWARN:', `[RPC] Received message from unauthenticated peer ${peerHostname}`)
    socket.send(bencode.encode({ h1: proveServer(peerManager.account, node), t: query.t, y: 'h1' }), peer.port, peer.host)
    return false
  }
  if (query.y === 'q') {
    const message = query.a['d']
    if (!message) return false
    const connection = udpConnections.get(peerHostname)
    if (!connection) {
      warn('DEVWARN:', `[RPC] Couldn't find connection ${peerHostname}`)
      socket.send(bencode.encode({ h1: proveServer(peerManager.account, node), t: query.t, y: 'h1' } satisfies HandshakeRequest), peer.port, peer.host)
      return false
    }
    connection.messageHandlers.forEach(handler => handler(message))
    return connection.messageHandlers.length === 0 ? warn('DEVWARN:', `[RPC] Couldn't find message handler ${peerHostname}`) : true
  }
  log(`[UDP] Unhandled query`, {query})
  return false
}

export class UDP_Server {
  private constructor(peerManager: () => PeerManager, public readonly socket: dgram.Socket, node: Config['node'], config: Config['rpc'], apiKey: string | undefined) {
    socket.on('error', err => {
      error('ERROR:', `[UDP] An error was thrown ${err.name} - ${err.message}`);
      socket.close();
    })
    socket.on('message', async (_msg, peer) => {
      const result = rpcMessageSchema.safeParse(bencode.decode(_msg))
      if (!result.success) return // Ignore non-hydra messages (DHT traffic, malformed, etc.)
      const msg = result.data
      if (msg.y === 'h1') {
        log(`[UDP] Connection initiated by ${peer.address}:${peer.port}`)
        await authHandler(socket, peerManager(), msg, { host: peer.address, port: peer.port }, config, node, apiKey)
      } else if (msg.y === 'h2') {
        log(`[UDP] Peer responded to connection ${peer.address}:${peer.port}`)
        await authHandler(socket, peerManager(), msg, { host: peer.address, port: peer.port }, config, node, apiKey, false)
      }
      if (msg.y === 'q' && msg.q.startsWith('hydra_')) await messageHandler(socket, peerManager(), msg, { host: peer.address, port: peer.port }, node, config, apiKey)
    })
  }

  static init(peerManager: () => PeerManager, config: Config['rpc'], node: Config['node'], apiKey: string | undefined): Promise<UDP_Server> {
    const server = dgram.createSocket('udp4')
    // server.bind(port)

    return new Promise<UDP_Server>(res => {
      // server.on('listening', () => {
      //   const {address,port} = server.address()
      //   log(`[UDP] listening at ${address}:${port}`)
      //   res(new UDP_Server(server))
      // })
      res(new UDP_Server(peerManager, server, node, config, apiKey))
    })
  }
}