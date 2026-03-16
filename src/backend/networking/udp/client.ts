import bencode from 'bencode'
import dgram from 'dgram'

import type { Config, Socket } from '../../../types/hydrabase'
import type { Account } from '../../Crypto/Account'
import type PeerManager from '../../PeerManager'

import { log, warn } from '../../../utils/log'
import { type Identity, proveClient, proveServer, verifyClient, verifyServer } from '../../protocol/HIP1/handshake'
import { DHT_Node } from '../dht'
import { authenticatedPeers, type HandshakeRequest, type HandshakeResponse, type Query, UDP_Server, udpConnections } from './server'

export const authenticateServerUDP = (server: UDP_Server, hostname: `${string}:${number}`, account: Account, node: Config['node']): Promise<[number, string] | Identity> => {
  const cache = authenticatedPeers.get(hostname)
  if (cache) return Promise.resolve(cache)
  return new Promise(resolve => {
    const txnId = Buffer.alloc(4)
    txnId.writeUInt32BE(Math.floor(Math.random() * 0xFFFFFFFF))
    const t = txnId.toString('hex')
    const timer = setTimeout(() => {
      server.cancelAwaiter(t)
      resolve([408, 'UDP auth timeout'])
    }, 10_000)
    server.awaitResponse(t, (msg) => {
      if (msg.y === 'e') {
        clearTimeout(timer)
        resolve([msg.e[0], msg.e[1]])
        return true
      }
      if (msg.y !== 'h2') return false
      const verification = verifyServer(msg.h2, hostname)
      if (verification !== true) {
        clearTimeout(timer)
        resolve(verification)
        return true
      }
      authenticatedPeers.set(hostname, msg.h2)
      log(`[UDP] [CLIENT] Authenticated server ${hostname}`)
      clearTimeout(timer)
      resolve(msg.h2)
      return true
    })
    const [host, port] = hostname.split(':') as [string, `${number}`]
    server.socket.send(bencode.encode({ h1: proveClient(account, node, hostname), id: DHT_Node.getNodeId(node), t, y: 'h1' } satisfies HandshakeRequest), Number(port), host)
  })
}

export class UDP_Client implements Socket {
  public isOpened = true
  public readonly messageHandlers: ((message: string) => void)[] = []
  private closeHandlers: (() => void)[] = []
  private readonly node: { host: string, port: number }
  private openHandler?: () => void
  private constructor(private readonly peers: PeerManager, public readonly peer: Identity, private readonly config: Config['rpc'], private readonly id: string) {
    authenticatedPeers.set(`${peer.hostname}`, peer)
    udpConnections.set(peer.hostname, this)
    log(`[UDP] [CLIENT] Connecting to peer ${peer.hostname}`)
    const [host, port] = peer.hostname.split(':') as [string, `${number}`]
    this.node = { host, port: Number(port) }
    setTimeout(() => this.openHandler?.(), 0)
  }
  static readonly connectToAuthenticatedPeer = (peerManager: PeerManager, identity: Identity, config: Config['rpc'], nodeId: string): UDP_Client => new UDP_Client(peerManager, identity, config, nodeId)
  static readonly connectToUnauthenticatedPeer = async (peerManager: PeerManager, auth: HandshakeRequest, peerHostname: `${string}:${number}`, node: Config['node'], config: Config['rpc'], apiKey: string | undefined, socket: dgram.Socket): Promise<false | UDP_Client> => {
    socket.send(bencode.encode({ h2: proveServer(peerManager.account, node), t: auth.t, y: 'h2' } satisfies HandshakeResponse), Number(peerHostname.split(':')[1]), peerHostname.split(':')[0])
    const identity = await verifyClient(node, peerHostname, auth.h1, apiKey, () => [500, 'UDP hostname mismatch'] as [number, string])
    if (Array.isArray(identity)) return warn('DEVWARN:', `[UDP] [CLIENT] UDP auth query verification failed for ${peerHostname}: ${identity[1]}`)
    log(`[UDP] [CLIENT] Authenticated peer ${identity.username} ${identity.address} at ${peerHostname} via UDP auth query`)
    authenticatedPeers.set(peerHostname, identity)
    if (!udpConnections.has(peerHostname)) peerManager.add(new UDP_Client(peerManager, { ...identity, hostname: peerHostname }, config, auth.id))
    return new UDP_Client(peerManager, identity, config, auth.id)
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
    this.peers.socket.send(bencode.encode({ a: { d: message, id: this.id }, q: `${this.config.prefix}msg`, t: tid.toString('hex'), y: 'q' } satisfies Query), Number(this.peer.hostname.split(':')[1]), this.peer.hostname.split(':')[0])
  }
}
