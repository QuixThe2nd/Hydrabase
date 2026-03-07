import krpc from 'k-rpc'
import krpcSocket from 'k-rpc-socket'

import type Peers from '../Peers'
import type { Connection } from './ws/client'
import type { Socket } from './ws/peer'

import { CONFIG } from '../config'
import { Signature } from '../Crypto/Signature'
import { error, log, warn } from '../log'
import { version } from "./ws/server";

const connections = new Map<string, RPC>()
const authenticatedPeers = new Map<string, { address: `0x${string}`, userAgent: string, username: string }>()

const handlers = {
  // eslint-disable-next-line max-statements
  auth: (peers: Peers, query: krpc.KRPCQuery, hostname: `${string}:${number}`, node: { address: string, family: "IPv4" | "IPv6"; port: number, size: number }) => {
    const address = query.a?.['address']?.toString() as `0x${string}` | undefined
    const signature = query.a?.['signature']?.toString()
    const userAgent = query.a?.['userAgent']?.toString() ?? 'Hydrabase/DHT'
    const username = query.a?.['username']?.toString() ?? 'Unknown'
    if (!address || !signature) {
      warn('DEVWARN:', `[RPC] Auth missing fields from ${hostname}`)
      return peers.rpc.response({ ...node, host: node.address }, query, { e: [0,'Missing auth fields'], ok: 0 })
    }
    if (!Signature.fromString(signature).verify(`I am connecting to ${CONFIG.hostname}:${CONFIG.port}`, address)) {
      warn('DEVWARN:', `[RPC] Auth failed for ${hostname} (address: ${address})`)
      return peers.rpc.response({ ...node, host: node.address }, query, { e: [0,'Invalid signature'], ok: 0 })
    }
    log(`[RPC] Authenticated peer ${username} ${address} at ${hostname}`)
    authenticatedPeers.set(hostname, { address, userAgent, username })
    peers.rpc.response({ ...node, host: node.address }, query, { address: peers.account.address, ok: 1, signature: peers.account.sign(`I am connecting to ${hostname}`).toString(), userAgent: `Hydrabase/${version}`, username: CONFIG.username })
    if (!connections.has(hostname)) peers.add(RPC.fromInbound(hostname, peers, { address, hostname, userAgent, username }))
  },
  // eslint-disable-next-line max-statements
  msg: async (peers: Peers, query: krpc.KRPCQuery, hostname: `${string}:${number}`, node: { address: string, family: "IPv4" | "IPv6"; port: number, size: number }) => {
    if (!authenticatedPeers.has(hostname)) {
      warn('DEVWARN:', `[RPC] Dropping message from unauthenticated peer ${hostname}`)
      return peers.rpc.response({ ...node, host: node.address }, query, { e: [0, 'Not authenticated'], ok: 0 })
    }
    const message = query.a?.['d']?.toString()
    if (message) {
      const connection = connections.get(hostname)
      if (connection) {
        if (connection.messageHandler) connection.messageHandler(message)
        else warn('DEVWARN:', `[RPC] Couldn't find message handler ${hostname}`, {connection})
      } else {
        warn('DEVWARN:', `[RPC] Couldn't find connection ${hostname}`)
        const rpc = await RPC.fromOutbound(hostname, peers)
        if (rpc) peers.add(rpc)
      }
    }
    peers.rpc.response({ ...node, host: node.address }, query, { ok: 1 })
  }
}

export const startRPC = (peers: Peers) => {
  const socket = krpcSocket({ timeout: 60_000 })
  const rpc = krpc({ krpcSocket: socket, timeout: 60_000 })
  
  rpc.on('query', async (query, node) => {
    const q = query.q.toString()
    const host = `${node.address}:${node.port}` as const
    if (!q.startsWith(CONFIG.rpcPrefix)) return
    log(`[RPC] Received message ${q} from ${host}`)
    if (q === `${CONFIG.rpcPrefix}_auth`) handlers.auth(peers, query, host, node)
    else if (q === `${CONFIG.rpcPrefix}_msg`) await handlers.msg(peers, query, host, node)
    else warn('DEVWARN:', `[RPC] Received message from ${host}: ${q}`, {query})
  })

  return { rpc, socket }
}

// Rpc.response(node, query, response, [nodes], [callback])

export class RPC implements Socket {
  public isOpened = true
  public readonly peer: Connection
  private closeHandlers: (() => void)[] = []
  private readonly node: { host: string, port: number }
  private openHandler?: () => void
  private constructor(private readonly hostname: `${string}:${number}`, private readonly peers: Peers, knownIdentity?: { address: `0x${string}`, hostname: `${string}:${number}`; userAgent: string, username: string, }) {
    log(`[RPC] Connecting to peer ${hostname}`)
    const [host, port] = hostname.split(':') as [string, `${number}`]
    this.node = { host, port: Number(port) }
    if (knownIdentity) {
      this.peer = { ...knownIdentity }
      setTimeout(() => this.openHandler?.(), 0)
    } else {
      // Outbound: placeholder until _auth completes
      this.peer = { address: `0x0`, hostname, userAgent: 'Hydrabase/DHT', username: 'Unknown' }
      this._sendAuth()
    }
  }
  static readonly fromInbound = (key: `${string}:${number}`, peers: Peers, identity: { address: `0x${string}`, hostname: `${string}:${number}`; userAgent: string, username: string }): RPC => new RPC(key, peers, identity)
  static readonly fromOutbound = async (hostname: `${string}:${number}`, peers: Peers): Promise<false | RPC> => {
    const [host, port] = hostname.split(':') as [string, `${number}`]
    const node = { host, port: Number(port) }
    const { account } = peers
    const sig = account.sign(`I am connecting to ${host}:${port}`)
    const response = await new Promise<krpc.KRPCResponse | null>(resolve => { peers.socket.query(node, { a: { address: account.address, hostname: `${CONFIG.hostname}:${CONFIG.port}`, signature: sig.toString(), userAgent: `Hydrabase/${version}`, username: CONFIG.username }, q: `${CONFIG.rpcPrefix}_auth` }, (err, res) => resolve(err ? null : res)) })
    if (!response) return warn('DEVWARN:', `[RPC] Auth handshake failed with ${hostname}`)
    const addr = response?.r?.['address']?.toString() as `0x${string}` | undefined
    const remoteSig = response?.r?.['signature']?.toString()
    if (!addr || !remoteSig) return warn('DEVWARN:', `[RPC] Auth response missing fields from ${hostname}`)
    if (!Signature.fromString(remoteSig).verify(`I am connecting to ${CONFIG.hostname}:${CONFIG.port}`, addr)) return warn('DEVWARN:', `[RPC] Auth response invalid from ${hostname}`)
    log(`[RPC] Mutual auth complete with ${addr} at ${hostname}`)
    authenticatedPeers.set(`${host}:${port}`, { address: addr, userAgent: response?.r?.['userAgent']?.toString() ?? 'Hydrabase/DHT', username: response?.r?.['username']?.toString() ?? 'Unknown' })
    return new RPC(hostname, peers, { address: addr, hostname, userAgent: response?.r?.['userAgent']?.toString() ?? 'Hydrabase/DHT', username: response?.r?.['username']?.toString() ?? 'Unknown' })
  }
  public readonly close = () => {
    // This.isOpened = false
    connections.delete(`${this.node.host}:${this.node.port}`)
    this.closeHandlers.map(handler => handler())
  }
  public messageHandler: (message: string) => void = msg => warn('DEVWARN:', `[RPC] Received message but not handler to handle it - ${msg}`)
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
      return this.close()
    }
    log(`[RPC] Peer acknowledged message ${this.hostname}`)
    if (!this.isOpened) {
      this.isOpened = true
      this.openHandler?.()
    }
  })
  private _sendAuth() {
    const {account} = this.peers
    if (!account) {
      warn('DEVWARN:', `[RPC] No account available for auth handshake to ${this.hostname}`)
      return setTimeout(() => this.openHandler?.(), 5_000)
    }
    const sig = account.sign(`I am connecting to ${this.node.host}:${this.node.port}`)
    // eslint-disable-next-line max-statements
    this.peers.socket.query(this.node, { a: { address: account.address, hostname: `${CONFIG.hostname}:${CONFIG.port}`, signature: sig.toString(), userAgent: `Hydrabase/${version}`, username: CONFIG.username }, q: `${CONFIG.rpcPrefix}_auth` }, (err, response) => {
      if (err) {
        warn('DEVWARN:', `[RPC] Auth handshake failed with ${this.hostname}`, { err })
        return this.close()
      }
      console.log('err', response.r?.['err']?.toString())
      const addr = response?.r?.['address']?.toString() as `0x${string}` | undefined
      const remoteSig = response?.r?.['signature']?.toString()
      if (!addr || !remoteSig) {
        warn('DEVWARN:', `[RPC] Auth response missing fields from ${this.hostname}`)
        return this.close()
      }
      const valid = Signature.fromString(remoteSig).verify(`I am connecting to ${CONFIG.hostname}:${CONFIG.port}`, addr)
      if (!valid) {
        warn('DEVWARN:', `[RPC] Auth response invalid from ${this.hostname}`)
        return this.close()
      }
      log(`[RPC] Mutual auth complete with ${addr} at ${this.hostname}`)
      ;(this.peer as Connection & { address: `0x${string}` }).address = addr
      authenticatedPeers.set(`${this.node.host}:${this.node.port}`, {
        address: addr,
        userAgent: response?.r?.['userAgent']?.toString() ?? 'Hydrabase/DHT',
        username: response?.r?.['username']?.toString() ?? 'Unknown',
      })
      this.openHandler?.()
    })
  }
}
