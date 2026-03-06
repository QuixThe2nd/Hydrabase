import krpc, { type KRPCNode, type KRPCResponse } from 'k-rpc'
import krpcSocket from 'k-rpc-socket'

import type { Connection } from './ws/client'
import type { Socket } from './ws/peer'

import { CONFIG } from '../config'
import { error, log, warn } from '../log'

const onReply = (message: KRPCResponse, node: KRPCNode): false | undefined => undefined
  // Console.log('visited peer', message, node)

const connections = new Map<string, RPC>()

const startRPC = () => {
  const socket = krpcSocket({ timeout: 60_000 })
  const rpc = krpc({ krpcSocket: socket, timeout: 60_000 })
  
  rpc.on('query', (query, node) => {
    const q = query.q.toString()
    console.log(q, `${node.address}:${node.port}`)
    if (!q.startsWith(CONFIG.rpcPrefix)) return

    const key = `${node.address}:${node.port}`
    log(`[RPC] Received message from ${key}: ${q}`)

    if (q === `${CONFIG.rpcPrefix}_msg`) {
      const message = query.a?.['d']?.toString()
      console.log(query)
      if (message) connections.get(key)?.messageHandler?.(message)
      rpc.response({ ...node, host: node.address }, query, { ok: 1 })
    }
  })

  return { rpc, socket }
}

export const { rpc, socket } = startRPC()

// Rpc.response(node, query, response, [nodes], [callback])

export class RPC implements Socket {
  public isOpened = true
  public messageHandler: (message: string) => void = msg => warn('DEVWARN:', `[RPC] Received message but not handler to handle it - ${msg}`)
  public readonly peer: Connection
  private closeHandlers: (() => void)[] = []
  private readonly node: { host: string, port: number }
  private openHandler?: () => void

  constructor(private readonly hostname: `rpc://${string}`) {
    log(`[RPC] Connecting to peer ${hostname}`)
    const { hostname: host, port } = new URL(hostname)
    this.node = { host, port: Number(port) }
    this.peer = { address: `0x${Math.ceil(Math.random()*10000)}`, hostname, userAgent: 'Hydrabase/DHT', username: 'DHT Test' }
    setTimeout(() => this.openHandler?.(), 5_000)
    connections.set(`${this.node.host}:${this.node.port}`, this)
  }
  public readonly close = () => {
    // this.isOpened = false
    connections.delete(`${this.node.host}:${this.node.port}`)
    this.closeHandlers.map(handler => handler())
  }
  public readonly onClose = (handler: () => void) => {
    this.closeHandlers.push(() => handler())
  }
  public onMessage(handler: (message: string) => void) {
    this.messageHandler = msg => handler(msg)
  }

  public onOpen(handler: () => void) {
    this.openHandler = () => handler()
  }
  public readonly send = (message: string) => socket.query(this.node, { d: message, q: `${CONFIG.rpcPrefix}_msg` }, err => {
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
