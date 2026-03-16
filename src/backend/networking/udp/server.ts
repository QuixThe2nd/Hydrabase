import bencode from 'bencode'
import dgram from 'dgram'
import z from 'zod'

import type { Config } from '../../../types/hydrabase'
import type PeerManager from '../../PeerManager'

import { error, log, warn } from '../../../utils/log'
import { FSMap } from '../../FSMap'
import { AuthSchema, type Identity, proveServer } from '../../protocol/HIP1/handshake'
import { UDP_Client } from './client'

export const authenticatedPeers = new FSMap<`${string}:${number}`, Identity>('./data/authenticated-peers.json')
export const udpConnections = new Map<`${string}:${number}`, UDP_Client>()

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
export type HandshakeRequest = z.infer<typeof HandshakeRequestSchema>
export type HandshakeResponse = z.infer<typeof HandshakeResponseSchema>
export type Query = z.infer<typeof QueryMessage>
export const rpcMessageSchema = z.preprocess((msg: Record<string, unknown> & { y: Uint8Array }) => ({
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

const messageHandler = async (socket: dgram.Socket, peerManager: PeerManager, query: Message, peer: { host: string, port: number }, node: Config['node'], config: Config['rpc'], apiKey: string | undefined): Promise<boolean> => {
  const peerHostname = `${peer.host}:${peer.port}` as const
  if (query.y === 'e') return warn('DEVWARN:', `[UDP] [SERVER] Peer threw error - ${query.e[0]} ${query.e[1]}`) 
  if (query.y === 'h1') return await UDP_Client.connectToUnauthenticatedPeer(peerManager, query, peerHostname, node, config, apiKey, socket) ? true : warn('DEVWARN:', '[UDP] [SERVER] Failed to validate UDP auth')
  if (!authenticatedPeers.has(peerHostname)) {
    warn('DEVWARN:', `[UDP] [SERVER] Received message from unauthenticated peer ${peerHostname}`)
    socket.send(bencode.encode({ h1: proveServer(peerManager.account, node), t: query.t, y: 'h1' }), peer.port, peer.host)
    return false
  }
  if (query.y === 'q') {
    const message = query.a['d']
    if (!message) return false
    const connection = udpConnections.get(peerHostname)
    if (!connection) {
      warn('DEVWARN:', `[UDP] [SERVER] Couldn't find connection ${peerHostname}`)
      socket.send(bencode.encode({ h1: proveServer(peerManager.account, node), t: query.t, y: 'h1' } satisfies HandshakeRequest), peer.port, peer.host)
      return false
    }
    connection.messageHandlers.forEach(handler => handler(message))
    return connection.messageHandlers.length === 0 ? warn('DEVWARN:', `[UDP] [SERVER] Couldn't find message handler ${peerHostname}`) : true
  }
  log(`[UDP] [SERVER] Unhandled query`, {query})
  return false
}

export class UDP_Server {
  private constructor(peerManager: () => PeerManager, public readonly socket: dgram.Socket, node: Config['node'], config: Config['rpc'], apiKey: string | undefined) {
    socket.on('error', err => {
      error('ERROR:', `[UDP] [SERVER] An error was thrown ${err.name} - ${err.message}`);
      socket.close();
    })
    socket.on('message', async (_msg, peer) => {
      const result = rpcMessageSchema.safeParse(bencode.decode(_msg))
      if (!result.success) return
      if (result.data.y === 'h1' || result.data.y === 'h2' || (result.data.y === 'q' && result.data.q.startsWith(config.prefix)))
      await messageHandler(socket, peerManager(), result.data, { host: peer.address, port: peer.port }, node, config, apiKey)
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
}