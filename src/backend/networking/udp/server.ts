import bencode from 'bencode'
import dgram from 'dgram'
import z from 'zod'

import type { Config } from '../../../types/hydrabase'
import type PeerManager from '../../PeerManager'

import { error, log, warn } from '../../../utils/log'
import { FSMap } from '../../FSMap'
import { AuthSchema, type Identity, proveServer } from '../../protocol/HIP1/handshake'
import { DHT_Node } from '../dht'
import { UDP_Client } from './client'

export const authenticatedPeers = new FSMap<`${string}:${number}`, Identity>('./data/authenticated-peers.json')
export const udpConnections = new Map<`${string}:${number}`, UDP_Client>()
type ResponseAwaiter = (msg: Message, rinfo: { address: string, port: number }) => boolean

const decoder = new TextDecoder()
const BinaryString = z.instanceof(Uint8Array).transform(m => decoder.decode(m))
const BinaryHex = z.instanceof(Uint8Array).transform(m => `0x${m.toHex()}`)

const BaseMessage = z.object({
  t: BinaryHex,
  v: BinaryString.optional(),
  y: BinaryString,
}).strict()
const QueryMessage = BaseMessage.extend({
  a: z.object({
    id: BinaryString,
  }).catchall(BinaryString),
  q: BinaryString,
  y: z.literal('q'),
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
  if (query.y === 'e') return warn('DEVWARN:', `[UDP] [SERVER] Peer threw ${peerHostname} error - ${query.e[0]} ${query.e[1]}`) 
  if (query.y === 'h1') {
    log('[UDP] [HANDSHAKE] Handshake initiated by peer', query)
    return await UDP_Client.connectToUnauthenticatedPeer(peerManager, query, peerHostname, node, config, apiKey, socket) ? true : warn('DEVWARN:', '[UDP] [SERVER] Failed to validate UDP auth')
  }
  if (query.y === 'h2') {
    log('[UDP] [HANDSHAKE] Peer completed handshake', query)
    return false
  }
  if (query.y === 'q') {
    if (!query.q.startsWith(config.prefix)) return false
    log('[UDP] Received query', query)
    if (!authenticatedPeers.has(peerHostname)) {
      warn('DEVWARN:', `[UDP] [SERVER] Received message from unauthenticated peer ${peerHostname}`)
      socket.send(bencode.encode({ h1: proveServer(peerManager.account, node), id: DHT_Node.getNodeId(node), t: query.t, y: 'h1' } satisfies HandshakeRequest), peer.port, peer.host)
      return false
    }
    const connection = udpConnections.get(peerHostname)
    if (!connection) {
      warn('DEVWARN:', `[UDP] [SERVER] Couldn't find connection ${peerHostname}`)
      socket.send(bencode.encode({ h1: proveServer(peerManager.account, node), id: DHT_Node.getNodeId(node), t: query.t, y: 'h1' } satisfies HandshakeRequest), peer.port, peer.host)
      return false
    }
    const message = query.a['d']
    if (!message) return false
    connection.messageHandlers.forEach(handler => handler(message))
    return connection.messageHandlers.length === 0 ? warn('DEVWARN:', `[UDP] [SERVER] Couldn't find message handler ${peerHostname}`) : true
  }
  if (query.y === 'r') return false
  log(`[UDP] [SERVER] Unhandled query`, {query})
  return false
}

export class UDP_Server {
  private readonly responseAwaiters = new Map<string, ResponseAwaiter>()

  private constructor(peerManager: () => PeerManager, public readonly socket: dgram.Socket, node: Config['node'], config: Config['rpc'], apiKey: string | undefined) {
    socket.on('error', err => {
      error('ERROR:', `[UDP] [SERVER] An error was thrown ${err.name} - ${err.message}`);
      socket.close();
    })
    socket.on('message', async (_msg, peer) => {
      const result = rpcMessageSchema.safeParse(bencode.decode(_msg))
      if (!result.success) return
      const peerHostname = `${peer.address}:${peer.port}` as const

      const awaiter = this.responseAwaiters.get(result.data.t)
      if (awaiter) {
        const done = awaiter(result.data, { address: peer.address, port: peer.port })
        if (done) this.responseAwaiters.delete(result.data.t)
        return
      }

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

  public readonly awaitResponse = (txnId: string, handler: ResponseAwaiter) => this.responseAwaiters.set(txnId, handler)
  public readonly cancelAwaiter = (txnId: string) => this.responseAwaiters.delete(txnId)
}