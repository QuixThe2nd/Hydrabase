import krpc from 'k-rpc'
import krpcSocket from 'k-rpc-socket'

import type { Socket } from '../peer'
import type Peers from '../Peers'

import { CONFIG } from '../config'
import { error, log, warn } from '../log'
import { getCanonicalHostname } from '../Peers'
import { AuthSchema, proveClient, proveServer, verifyClient, verifyServer } from '../protocol/HIP3/handshake'
import { DHT_Node } from './dht'
import { type Connection } from './ws/client'

const authenticatedPeers = new Map<string, { address: `0x${string}`, userAgent: string, username: string }>()
const connections = new Map<string, RPC>()

export class RPC implements Socket {
  public isOpened = true
  public readonly peer: Connection
  private closeHandlers: (() => void)[] = []
  private readonly node: { host: string, port: number }
  private openHandler?: () => void
  private constructor(private readonly hostname: `${string}:${number}`, private readonly peers: Peers, identity: { address: `0x${string}`, userAgent: string, username: string }) {
    log(`[RPC] Connecting to peer ${hostname}`)
    const [host, port] = hostname.split(':') as [string, `${number}`]
    this.node = { host, port: Number(port) }
    this.peer = { ...identity, hostname }
    setTimeout(() => this.openHandler?.(), 0)
  }
  static readonly fromInbound = (key: `${string}:${number}`, peers: Peers, identity: { address: `0x${string}`, hostname: `${string}:${number}`; userAgent: string, username: string }): RPC => new RPC(key, peers, identity)
  static readonly fromOutbound = async (hostname: `${string}:${number}`, peers: Peers): Promise<false | RPC> => {
    const [host, port] = hostname.split(':') as [string, `${number}`]
    const node = { host, port: Number(port) }
    const response = await new Promise<krpc.KRPCResponse | null>(resolve => {
      peers.socket.query(node, { a: proveClient(peers.account, hostname), q: `${CONFIG.rpcPrefix}_auth` }, (err, res) => {
        if (err) warn('DEVWARN:', `[RPC] Failed to send auth to ${hostname} - ${err.message}`)
        resolve(err ? null : res)
      })
    })
    if (!response) return warn('DEVWARN:', `[RPC] Auth handshake failed with ${hostname}`)
    const err = response.r?.['e']?.[1].toString()
    if (err) return warn('DEVWARN:', `[RPC] Failed to authenticate from outbound - ${err}`)

    const { data: auth } = AuthSchema.safeParse({
      address: response.r?.['address']?.toString(),
      hostname: response?.r?.['hostname']?.toString(),
      signature: response?.r?.['signature']?.toString(),
      userAgent: response?.r?.['userAgent']?.toString(),
      username: response?.r?.['username']?.toString(),
    })
    if (!auth) return warn('DEVWARN:', '[RPC] Invalid auth response')
    const res = verifyServer(hostname, auth)
    if (Array.isArray(res)) return warn('DEVWARN:', `[RPC] Failed to verify server ${res[1]}`)
    log(`[RPC] Mutual auth complete with ${auth.username} ${auth.address} at ${hostname}`)
    authenticatedPeers.set(`${host}:${port}`, auth)
    return new RPC(hostname, peers, auth)
  }
  public readonly close = () => {
    // This.isOpened = false
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
  public readonly send = (message: string) => this.peers.socket.query(this.node, { a: { d: message }, q: `${CONFIG.rpcPrefix}_msg` }, err => {
    if (err) {
      error('ERROR:', '[RPC] Message failed to send', {err})
      this.close()
      return
    }
    log(`[RPC] Peer acknowledged message ${this.hostname}`)
    if (!this.isOpened) {
      this.isOpened = true
      this.openHandler?.()
    }
  })
}

const handlers = {
  auth: async (peers: Peers, query: krpc.KRPCQuery, unverifiedHostname: `${string}:${number}`, node: { family: "IPv4" | "IPv6"; host: string, port: number, size: number }) => {
    const res = await verifyClient({ address: query.a?.['address']?.toString() as `0x${string}`, hostname: unverifiedHostname, signature: query.a?.['signature']?.toString() ?? '', userAgent: query.a?.['userAgent']?.toString() ?? '', username: query.a?.['username']?.toString() ?? '' })
    if (Array.isArray(res)) {
      warn('DEVWARN:', `[RPC] Authentication failed ${unverifiedHostname} - ${res[1]}`)
      peers.rpc.response(node, query, { e: res, ok: 0 })
      return
    }
    const { address, hostname, userAgent, username } = res
    log(`[RPC] Authenticated peer ${username} ${address} at ${hostname}`)
    authenticatedPeers.set(hostname, { address, userAgent, username })
    peers.rpc.response(node, query, { ...proveServer(peers.account), ok: 1 })
    if (!connections.has(hostname)) peers.add(RPC.fromInbound(hostname, peers, { address, hostname, userAgent, username }))
  },
  msg: async (peers: Peers, query: krpc.KRPCQuery, hostname: `${string}:${number}`, node: { address: string, family: "IPv4" | "IPv6"; port: number, size: number }) => {
    if (!authenticatedPeers.has(hostname)) {
      warn('DEVWARN:', `[RPC] Dropping message from unauthenticated peer ${hostname}`)
      peers.rpc.response({ ...node, host: node.address }, query, { e: [0, 'Not authenticated'], ok: 0 })
      return
    }
    const message = query.a?.['d']?.toString()
    if (message) {
      const connection = connections.get(hostname)
      if (connection) {
        if (connection.messageHandler) connection.messageHandler(message)
        else warn('DEVWARN:', `[RPC] Couldn't find message handler ${hostname}`, {connection})
      } else {
        warn('DEVWARN:', `[RPC] Couldn't find connection ${hostname}`)
        const rpc = await RPC.fromOutbound(await getCanonicalHostname(hostname), peers)
        if (rpc) peers.add(rpc)
      }
    }
    peers.rpc.response({ ...node, host: node.address }, query, { ok: 1 })
  }
}

export const startRPC = (peers: Peers) => {
  const socket = krpcSocket({ timeout: 5_000 })
  socket.on('error', err => error('ERROR:', '[RPC] Socket error', {err}))
  const rpc = krpc({ id: Buffer.from(DHT_Node.nodeId), krpcSocket: socket, nodes: CONFIG.dhtBootstrapNodes.split(','), timeout: 5_000 })
  rpc.on('query', async (query, node) => {
    const q = query.q.toString()
    const host = `${node.address}:${node.port}` as const
    if (!q.startsWith(CONFIG.rpcPrefix)) return
    log(`[RPC] Received message ${q} from ${host}`)
    if (q === `${CONFIG.rpcPrefix}_auth`) await handlers.auth(peers, query, host, { ...node, host })
    else if (q === `${CONFIG.rpcPrefix}_msg`) await handlers.msg(peers, query, host, node)
    else warn('DEVWARN:', `[RPC] Received message from ${host}: ${q}`, {query})
  })
  return { rpc, socket }
}

// Rpc.response(node, query, response, [nodes], [callback])

