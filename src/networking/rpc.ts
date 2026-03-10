import krpc from 'k-rpc'

import type { Socket } from '../peer'
import type Peers from '../Peers'

import { CONFIG } from '../config'
import { FSMap } from '../FSMap'
import { debug, error, log, warn } from '../log'
import { authenticateServer } from '../Peers'
import { type Identity, proveClient, proveServer, verifyClient } from '../protocol/HIP3/handshake'
import { DHT_Node } from './dht'
import { type Connection } from './ws/client'

export const authenticatedPeers = new FSMap<`${string}:${number}`, Identity>('./data/authenticated-peers.json')
const connections = new Map<string, RPC>()

export class RPC implements Socket {
  public isOpened = true
  public readonly peer: Connection
  private closeHandlers: (() => void)[] = []
  private readonly node: { host: string, port: number }
  private openHandler?: () => void
  private constructor(private readonly peers: Peers, private readonly identity: { address: `0x${string}`, hostname: `${string}:${number}`, userAgent: string, username: string }) {
    log(`[RPC] Connecting to peer ${identity.hostname}`)
    const [host, port] = identity.hostname.split(':') as [string, `${number}`]
    this.node = { host, port: Number(port) }
    this.peer = { ...identity, hostname: identity.hostname }
    setTimeout(() => this.openHandler?.(), 0)
  }
  static readonly fromInbound = (peers: Peers, identity: Identity): RPC => {
    authenticatedPeers.set(identity.hostname, identity)
    return new RPC(peers, identity)
  }
  static readonly fromOutbound = async (identity: Identity, peers: Peers): Promise<false | RPC> => {
    const response = await new Promise<krpc.KRPCResponse | undefined>(resolve => {
      const [host, port] = identity.hostname.split(':') as [string, `${number}`]
      peers.rpc.query({ host, port: Number(port) }, { a: proveClient(peers.account, identity.hostname), q: `${CONFIG.rpcPrefix}_auth` }, (err, res) => {
        if (err) warn('DEVWARN:', `[RPC] Failed to send auth to ${identity.hostname} - ${err.message}`)
        resolve(res)
      })
    })
    if (!response) return warn('DEVWARN:', `[RPC] Auth handshake failed with ${identity.hostname}`)
    const err = response.r?.['e']?.[1].toString()
    if (err) return warn('DEVWARN:', `[RPC] Failed to authenticate from outbound - ${err}`)

    authenticatedPeers.set(`${identity.hostname}`, identity)
    return new RPC(peers, identity)
  }
  public readonly close = () => {
    this.isOpened = false
    connections.delete(`${this.node.host}:${this.node.port}`)
    this.closeHandlers.map(handler => handler())
  }
  public messageHandler: (message: string) => void = msg => warn('DEVWARN:', `[RPC] Received message from ${this.peer.address} but not handler to handle it - ${msg}`)
  public readonly onClose = (handler: () => void) => {
    this.closeHandlers.push(() => handler())
  }
  public onMessage(handler: (message: string) => void) {
    this.messageHandler = msg => handler(msg)
  }
  public onOpen(handler: () => void) {
    this.openHandler = () => handler()
  }
  public readonly send = (message: string) => this.peers.rpc.query(this.node, { a: { d: message }, q: `${CONFIG.rpcPrefix}_msg` }, err => {
    if (err) {
      error('ERROR:', `[RPC] Message failed to send ${err.message}`)
      // This.close()
      return
    }
    debug(`[RPC] Peer acknowledged message ${this.identity.hostname}`)
    if (!this.isOpened) {
      this.isOpened = true
      this.openHandler?.()
    }
  })
}

const handlers = {
  auth: async (peers: Peers, query: krpc.KRPCQuery, unverifiedHostname: `${string}:${number}`, node: { family: "IPv4" | "IPv6"; host: string, port: number, size: number }) => {
    log(`[RPC] Received auth from ${unverifiedHostname}`)
    const identity = await verifyClient({ address: query.a?.['address']?.toString() as `0x${string}`, hostname: unverifiedHostname, signature: query.a?.['signature']?.toString() ?? '', userAgent: query.a?.['userAgent']?.toString() ?? '', username: query.a?.['username']?.toString() ?? '' })
    if (Array.isArray(identity)) {
      warn('DEVWARN:', `[RPC] Authentication failed ${unverifiedHostname} - ${identity[1]}`)
      peers.rpc.response(node, query, { e: [500, 'Failed to verify client'], ok: 0 })
      return
    }
    log(`[RPC] Authenticated peer ${identity.username} ${identity.address} at ${identity.hostname}`)
    peers.rpc.response(node, query, { ...proveServer(peers.account), ok: 1 })
    if (!connections.has(identity.hostname)) peers.add(RPC.fromInbound(peers, identity))
  },
  msg: async (peers: Peers, query: krpc.KRPCQuery, hostname: `${string}:${number}`, node: { address: string, family: "IPv4" | "IPv6"; port: number, size: number }) => {
    if (!authenticatedPeers.has(hostname)) {
      warn('DEVWARN:', `[RPC] Received message from unauthenticated peer ${hostname}`)
      peers.rpc.response({ ...node, host: node.address }, query, { e: [0, 'Not authenticated'], ok: 0 })
      const auth = await authenticateServer(hostname)
      if (Array.isArray(auth)) {
        warn('DEVWARN:', `[RPC] Failed to authenticate server ${auth[1]}`)
        return
      } 
      const rpc = await RPC.fromOutbound(auth, peers)
      if (!rpc || !await peers.add(rpc)) return
    }
    const message = query.a?.['d']?.toString()
    if (message) {
      const connection = connections.get(hostname)
      if (connection) {
        if (connection.messageHandler) connection.messageHandler(message)
        else warn('DEVWARN:', `[RPC] Couldn't find message handler ${hostname}`, {connection})
      } else {
        warn('DEVWARN:', `[RPC] Couldn't find connection ${hostname}`)
        const auth = await authenticateServer(hostname)
        if (Array.isArray(auth)) warn('DEVWARN:', `[RPC] Failed to authenticate server ${auth[1]}`)
        else {
          const rpc = await RPC.fromOutbound(auth, peers)
          if (rpc) peers.add(rpc)
        }
      }
    }
    peers.rpc.response({ ...node, host: node.address }, query, { ok: 1 })
  }
}

export const startRPC = (peers: Peers) => {
  const rpc = krpc({ id: Buffer.from(DHT_Node.nodeId), nodes: CONFIG.dhtBootstrapNodes.split(','), timeout: 5_000 })
  rpc.on('query', async (query, node) => {
    const q = query.q.toString()
    if (!q.startsWith(CONFIG.rpcPrefix)) return
    const _host = `${node.address}:${node.port}` as const
    if (!authenticatedPeers.has(_host)) await authenticateServer(_host)
    const host = authenticatedPeers.get(_host)?.hostname ?? _host
    log(`[RPC] Received message ${q} from ${host}`)
    if (q === `${CONFIG.rpcPrefix}_auth`) await handlers.auth(peers, query, host, { ...node, host })
    else if (q === `${CONFIG.rpcPrefix}_msg`) await handlers.msg(peers, query, host, node)
    else warn('DEVWARN:', `[RPC] Received message from ${host}: ${q}`, {query})
  })
  return { rpc }
}

// Rpc.response(node, query, response, [nodes], [callback])

