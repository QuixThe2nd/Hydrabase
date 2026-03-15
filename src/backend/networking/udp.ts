import bencode from 'bencode'
import dgram from 'dgram'
import z from 'zod'

import type { Config } from '../../types/hydrabase'
import type { Account } from '../Crypto/Account'
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
type HandshakeRequest = z.infer<typeof HandshakeRequestSchema>
type HandshakeResponse = z.infer<typeof HandshakeResponseSchema>
type Query = z.infer<typeof QueryMessage>
const ResponseMessage = BaseMessage.extend({
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
type Error = z.infer<typeof ErrorMessage>
const rpcMessageSchema = z.preprocess((msg: Record<string, unknown> & { y: Uint8Array }) => ({
  ...msg,
  y: decoder.decode(msg.y),
}), z.discriminatedUnion('y', [
  QueryMessage,
  ResponseMessage,
  ErrorMessage,
  HandshakeRequestSchema,
  HandshakeResponseSchema,
]))

export const fromOutbound = (socket: dgram.Socket, peerManager: PeerManager, identity: Identity, config: Config['rpc'], node: Config['node']): RPC => {
  const [host, port] = identity.hostname.split(':') as [string, `${number}`]
  socket.send(bencode.encode({ h1: proveServer(peerManager.account, node), t: query.t, y: 'h1' } satisfies HandshakeRequest), Number(port), host)
  return new RPC(peerManager, identity, config)
}

const authHandler = async (socket: dgram.Socket, peerManager: PeerManager, query: HandshakeRequest | HandshakeResponse, peer: { host: string, port: number }, config: Config['rpc'], node: Config['node'], apiKey: string | undefined, respond = true) => {
  log(`[RPC] Received auth from ${peer.host}:${peer.port}`)
  const headers = query.y === 'h1' ? query['h1'] : query['h2']
  if (headers.hostname !== `${peer.host}:${peer.port}`) {
    socket.send(bencode.encode({ h1: proveServer(peerManager.account, node), t: query.t, y: 'h1' } satisfies HandshakeRequest), Number(headers.hostname.split(':')[1]), headers.hostname.split(':')[0])
    return
  }
  const identity = await verifyClient(node, `${peer.host}:${peer.port}`, headers, apiKey, () => [500, 'UDP hostname mismatch'])
  if (Array.isArray(identity)) {
    warn('DEVWARN:', `[RPC] Authentication failed ${peer.host}:${peer.port} - ${identity[1]}`)
    socket.send(bencode.encode({ e: [500, 'Failed to verify client'], t: query.t, y: 'e' } satisfies Error), peer.port, peer.host)
    return
  }
  log(`[RPC] Authenticated peer ${identity.username} ${identity.address} at ${identity.hostname}`)
  if (!udpConnections.has(identity.hostname)) peerManager.add(new RPC(peerManager, identity, config))
  if (respond) socket.send(bencode.encode({ h2: proveServer(peerManager.account, node), t: query.t, y: 'h2' } satisfies HandshakeResponse), peer.port, peer.host)
}

const messageHandler = (socket: dgram.Socket, peerManager: PeerManager, query: Query, peer: { host: string, port: number }, node: Config['node']) => {
  if (!authenticatedPeers.has(`${peer.host}:${peer.port}`)) {
    warn('DEVWARN:', `[RPC] Received message from unauthenticated peer ${peer.host}:${peer.port}`)
    socket.send(bencode.encode({ h1: proveServer(peerManager.account, node), t: query.t, y: 'h1' } satisfies HandshakeRequest), peer.port, peer.host)
    return
  }
  const message = query.a['d']?.toString()
  if (!message) return

  const connection = udpConnections.get(`${peer.host}:${peer.port}`)
  if (connection) {
    connection.messageHandlers.forEach(handler => handler(message))
    if (connection.messageHandlers.length === 0) warn('DEVWARN:', `[RPC] Couldn't find message handler ${peer.host}:${peer.port}`)
  } else {
    warn('DEVWARN:', `[RPC] Couldn't find connection ${`${peer.host}:${peer.port}`}`)
    socket.send(bencode.encode({ h1: proveServer(peerManager.account, node), t: query.t, y: 'h1' } satisfies HandshakeRequest), peer.port, peer.host)
  }
}

export class UDP_Server {
  private constructor(peerManager: () => PeerManager, public readonly socket: dgram.Socket, node: Config['node'], config: Config['rpc'], apiKey: string | undefined) {
    socket.on('error', err => {
      error('ERROR:', `[UDP] An error was thrown ${err.name} - ${err.message}`);
      socket.close();
    })
    socket.on('message', async (_msg, peer) => {
      const msg = rpcMessageSchema.parse(bencode.decode(_msg))
      if (msg.y === 'h1') {
        log(`[UDP] Connection initiated by ${peer.address}:${peer.port}`)
        await authHandler(socket, peerManager(), msg, { host: peer.address, port: peer.port }, config, node, apiKey)
      } else if (msg.y === 'h2') {
        log(`[UDP] Peer responded to connection ${peer.address}:${peer.port}`)
        await authHandler(socket, peerManager(), msg, { host: peer.address, port: peer.port }, config, node, apiKey, false)
      }
      if (msg.y === 'q' && msg.q.startsWith('hydra_')) messageHandler(socket, peerManager(), msg, { host: peer.address, port: peer.port }, node)
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

export const authenticateServerUDP = (hostname: `${string}:${number}`, socket: dgram.Socket, account: Account, node: Config['node']): [number, string] | Identity => {
  const [host, port] = hostname.split(':') as [string, `${number}`]
  log(`[PEERS] Attempting UDP auth to ${hostname}`)
  socket.send(bencode.encode({ h1: proveClient(account, node, hostname), t: query.t, y: 'h1' } satisfies HandshakeRequest), Number(port), host)

}
