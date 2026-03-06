import krpc from 'k-rpc'
import krpcSocket from 'k-rpc-socket'

import type Peers from '../Peers'
import type { Connection } from './ws/client'
import type { Socket } from './ws/peer'

import { CONFIG } from '../config'
import { error, log, warn } from '../log'

const connections = new Map<string, RPC>()

export const startRPC = (peers: Peers) => {
  const socket = krpcSocket({ timeout: 60_000 })
  const rpc = krpc({ krpcSocket: socket, timeout: 60_000 })
  
  rpc.on('query', (query, node) => {
    const q = query.q.toString()
    const key = `${node.address}:${node.port}`
    if (!q.startsWith(CONFIG.rpcPrefix)) return

    if (q === `${CONFIG.rpcPrefix}_msg`) {
      const message = query.a?.['d']?.toString()
      log(`[RPC] Received message ${q} from ${key}`, {message})
      if (message) {
        const connection = connections.get(key)
        if (connection) {
          if (connection.messageHandler) connection.messageHandler(message)
          else warn('DEVWARN:', `Couldn't find message handler ${key}`, {connection})
        } else {
          warn('DEVWARN:', `Couldn't find connection ${key}`)
          peers.add(new RPC(`ws://${key}`, peers))
        }
      }
      rpc.response({ ...node, host: node.address }, query, { ok: 1 })
    } else log(`[RPC] Received message from ${key}: ${q}`, {query})
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
  constructor(private readonly hostname: `ws://${string}`, private readonly peers: Peers) {
    log(`[RPC] Connecting to peer ${hostname}`)
    const { hostname: host, port } = new URL(hostname)
    this.node = { host, port: Number(port) }
    this.peer = { address: `0x${Math.ceil(Math.random()*10000)}`, hostname, userAgent: 'Hydrabase/DHT', username: 'DHT Test' }
    setTimeout(() => this.openHandler?.(), 5_000)
    connections.set(`${this.node.host}:${this.node.port}`, this)
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
}
