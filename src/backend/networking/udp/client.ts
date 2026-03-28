import bencode from 'bencode'
import dgram from 'dgram'
import { resolve4 } from 'dns/promises'
import net from 'net'

import type { Config, Socket } from '../../../types/hydrabase'
import type { Account } from '../../crypto/Account'
import type { Query } from '../../protocol/DHT'

import { debug, warn } from '../../../utils/log'
import { Trace } from '../../../utils/trace'
import { type Auth, type Identity, proveServer, verifyClient } from '../../protocol/HIP1_Identity'
import { type HandshakeRequest, type HandshakeResponse } from '../../protocol/HIP5_IdentityDiscovery'
import { authenticatedPeers, UDP_Server, udpConnections } from './server'

export class UDP_Client implements Socket {
  public readonly messageHandlers: ((message: string) => void)[] = []
  private closeHandlers: (() => void)[] = []
  private readonly node: { host: string, port: number }
  private constructor(private readonly socket: dgram.Socket, public readonly identity: Identity, private readonly config: Config['rpc'], private readonly id: string, trace: Trace) {
    authenticatedPeers.set(`${identity.hostname}`, identity)
    udpConnections.set(identity.hostname, this)
    trace.step(`UDP client connecting to ${identity.hostname}`)
    const [host, port] = identity.hostname.split(':') as [string, `${number}`]
    this.node = { host, port: Number(port) }
    const [dnsHost] = identity.hostname.split(':') as [string]
    const [,portStr] = identity.hostname.split(':')
    if (!net.isIP(dnsHost)) {
      resolve4(dnsHost).then(addresses => {
        if (addresses.length > 0 && addresses[0] !== dnsHost) {
          const ipHostname = `${addresses[0]}:${portStr}` as `${string}:${number}`
          authenticatedPeers.set(ipHostname, identity)
          trace.step(`[CLIENT] Also stored peer auth under resolved IP ${ipHostname}`)
        }
      }).catch((error: Error) => warn('DEVWARN:', '[CLIENT] Dns lookup threw error', {error}))
    }
  }
  static readonly connectToAuthenticatedPeer = (socket: dgram.Socket, identity: Identity, config: Config['rpc'], nodeId: string, trace: Trace): UDP_Client => new UDP_Client(socket, identity, config, nodeId, trace)
  static readonly connectToUnauthenticatedPeer = async (account: Account, socket: dgram.Socket, auth: HandshakeRequest, peerHostname: `${string}:${number}`, node: Config['node'], config: Config['rpc'], apiKey: string | undefined, server: UDP_Server, trace: Trace, addPeer: (client: UDP_Client, trace: Trace) => Promise<boolean>): Promise<false | UDP_Client> => {
    trace.step('Sending h2')
    socket.send(bencode.encode({ h2: await proveServer(account, node, trace), t: auth.t, y: 'h2' } satisfies HandshakeResponse), Number(peerHostname.split(':')[1]), peerHostname.split(':')[0])
    const [peerAddress] = peerHostname.split(':') as [string, `${number}`]
    const ip = { address: peerAddress }
    const peerIdentity = await verifyClient(node, peerHostname, auth.h1 as unknown as Auth, apiKey, trace, 'UDP', server, account, auth.h1 as unknown as Identity, ip)
    if (Array.isArray(peerIdentity)) return trace.fail(`UDP auth query verification failed: ${peerIdentity[1]}`)
    trace.step('Authenticated peer')
    trace.success()
    authenticatedPeers.set(peerHostname, peerIdentity)
    if (peerIdentity.hostname && peerIdentity.hostname !== peerHostname) authenticatedPeers.set(peerIdentity.hostname as `${string}:${number}`, peerIdentity)
    if (!udpConnections.has(peerHostname)) {
      const client = new UDP_Client(socket, { ...peerIdentity, hostname: peerHostname }, config, auth.id, trace)
      if (peerIdentity.hostname && peerIdentity.hostname !== peerHostname) udpConnections.set(peerIdentity.hostname as `${string}:${number}`, client)
      addPeer(client, trace)
    }
    return udpConnections.get(peerHostname) ?? false
  }
  public readonly close = () => {
    udpConnections.delete(`${this.node.host}:${this.node.port}`)
    this.closeHandlers.map(handler => handler())
  }
  public readonly onClose = (handler: () => void) => {
    this.closeHandlers.push(() => handler())
  }
  public onMessage(handler: (message: string) => void) {
    this.messageHandlers.push(handler)
  }
  public readonly send = (message: string) => {
    const MAX_CHUNK_PAYLOAD = 1200
    const tid = Buffer.alloc(4)
    tid.writeUInt32BE(Math.floor(Math.random() * 0xFFFFFFFF))
    const txnId = tid.toString('hex')

    if (message.length <= MAX_CHUNK_PAYLOAD) {
      try {
        this.socket.send(bencode.encode({ a: { d: message, id: this.id }, q: `${this.config.prefix}msg`, t: txnId, y: 'q' } satisfies Query), Number(this.identity.hostname.split(':')[1]), this.identity.hostname.split(':')[0])
      } catch (err) {
        warn('DEVWARN:', `[CLIENT] Failed to send message to ${this.identity.hostname} - socket may be closed`, { err })
      }
      return
    }

    const chunkId = Buffer.alloc(4)
    chunkId.writeUInt32BE(Math.floor(Math.random() * 0xFFFFFFFF))
    const c = chunkId.toString('hex')
    const totalChunks = Math.ceil(message.length / MAX_CHUNK_PAYLOAD)

    debug(`[CLIENT] Chunking message to ${this.identity.hostname}: ${message.length} bytes -> ${totalChunks} chunks (chunkId=${c})`)

    for (let i = 0; i < totalChunks; i++) {
      const start = i * MAX_CHUNK_PAYLOAD
      const end = Math.min(start + MAX_CHUNK_PAYLOAD, message.length)
      const chunkData = message.slice(start, end)
      if (i === 0) this.sendChunk(c, chunkData, i, totalChunks, txnId)
      else setTimeout(() => this.sendChunk(c, chunkData, i, totalChunks, txnId), i * 2)
    }
  }
  private readonly sendChunk = (c: string, chunkData: string, i: number, totalChunks: number, txnId: string) => {
    try {
      this.socket.send(
        bencode.encode({
          a: { c, d: chunkData, i, id: this.id, n: totalChunks },
          q: `${this.config.prefix}msg`,
          t: txnId,
          y: 'q'
        } satisfies Query),
        Number(this.identity.hostname.split(':')[1]),
        this.identity.hostname.split(':')[0]
      )
    } catch (err) {
      warn('DEVWARN:', `[CLIENT] Failed to send chunk ${i + 1}/${totalChunks} to ${this.identity.hostname} - socket may be closed`, { err })
    }
  }
}
