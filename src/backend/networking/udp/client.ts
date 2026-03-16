import bencode from 'bencode'
import dgram from 'dgram'

import type { Config, Socket } from '../../../types/hydrabase'
import type { Account } from '../../Crypto/Account'
import type PeerManager from '../../PeerManager'

import { log, warn } from '../../../utils/log'
import { type Identity, proveClient, proveServer, verifyClient, verifyServer } from '../../protocol/HIP1/handshake'
import { authenticatedPeers, type HandshakeRequest, type HandshakeResponse, type Query, rpcMessageSchema, udpConnections } from './server'

export const authenticateServerUDP = (socket: dgram.Socket, hostname: `${string}:${number}`, account: Account, node: Config['node']): Promise<[number, string] | Identity> => {
  const cache = authenticatedPeers.get(hostname)
  if (cache) return Promise.resolve(cache)
  const [host, port] = hostname.split(':') as [string, `${number}`]
  return new Promise(resolve => {
    const ac = new AbortController()
    socket.on('message', function handler(msg: Buffer) {
      const result = rpcMessageSchema.safeParse(bencode.decode(msg))
      if (!result.success) return
      if (result.data.y === 'e') { ac.abort(); socket.removeListener('message', handler); resolve([result.data.e[0], result.data.e[1]]); return }
      if (result.data.y !== 'h2') return
      const auth = result.data.h2
      const verification = verifyServer(auth, hostname)
      if (verification !== true) { ac.abort(); socket.removeListener('message', handler); resolve(verification); return }
      authenticatedPeers.set(hostname, auth)
      log(`[UDP] [CLIENT] Authenticated server ${hostname}`)
      ac.abort()
      socket.removeListener('message', handler)
      resolve(auth)
    })
    setTimeout(() => { if (!ac.signal.aborted) resolve([408, 'UDP auth timeout']) }, 10_000)
    socket.send(bencode.encode({ h1: proveClient(account, node, hostname), t: '0', y: 'h1' } satisfies HandshakeRequest), Number(port), host)
  })
}

export class UDP_Client implements Socket {
  public isOpened = true
  public readonly messageHandlers: ((message: string) => void)[] = []
  private closeHandlers: (() => void)[] = []
  private readonly node: { host: string, port: number }
  private openHandler?: () => void
  private constructor(private readonly peers: PeerManager, public readonly peer: Identity, private readonly config: Config['rpc']) {
    authenticatedPeers.set(`${peer.hostname}`, peer)
    udpConnections.set(peer.hostname, this)
    log(`[UDP] [CLIENT] Connecting to peer ${peer.hostname}`)
    const [host, port] = peer.hostname.split(':') as [string, `${number}`]
    this.node = { host, port: Number(port) }
    setTimeout(() => this.openHandler?.(), 0)
  }
  static readonly connectToAuthenticatedPeer = (peerManager: PeerManager, identity: Identity, config: Config['rpc']): UDP_Client => new UDP_Client(peerManager, identity, config)
  static readonly connectToUnauthenticatedPeer = async (peerManager: PeerManager, auth: HandshakeRequest, peerHostname: `${string}:${number}`, node: Config['node'], config: Config['rpc'], apiKey: string | undefined, socket: dgram.Socket): Promise<false | UDP_Client> => {
    socket.send(bencode.encode({ h2: proveServer(peerManager.account, node), t: auth.t, y: 'h2' } satisfies HandshakeResponse), Number(peerHostname.split(':')[1]), peerHostname.split(':')[0])
    const identity = await verifyClient(node, peerHostname, auth.h1, apiKey, () => [500, 'UDP hostname mismatch'] as [number, string])
    if (Array.isArray(identity)) return warn('DEVWARN:', `[UDP] [CLIENT] UDP auth query verification failed for ${peerHostname}: ${identity[1]}`)
    log(`[UDP] [CLIENT] Authenticated peer ${identity.username} ${identity.address} at ${peerHostname} via UDP auth query`)
    authenticatedPeers.set(peerHostname, identity)
    if (!udpConnections.has(peerHostname)) peerManager.add(new UDP_Client(peerManager, { ...identity, hostname: peerHostname }, config))
    return new UDP_Client(peerManager, identity, config)
  }
  public readonly close = () => {
    this.isOpened = false
    udpConnections.delete(`${this.node.host}:${this.node.port}`)
    this.closeHandlers.map(handler => handler())
  }
  public readonly onClose = (handler: () => void) => {
    this.closeHandlers.push(() => handler())
  }
  public onMessage(handler: (message: string) => void) {
    this.messageHandlers.push(handler)
  }
  public onOpen(handler: () => void) {
    this.openHandler = () => handler()
  }
  public readonly send = (message: string) => {
    const tid = Buffer.alloc(4)
    tid.writeUInt32BE(Math.floor(Math.random() * 0xFFFFFFFF))
    this.peers.socket.send(bencode.encode({ a: { d: message }, q: `${this.config.prefix}msg`, t: tid.toString('hex'), y: 'q' } satisfies Query), Number(this.peer.hostname.split(':')[1]), this.peer.hostname.split(':')[0])
  }
}
