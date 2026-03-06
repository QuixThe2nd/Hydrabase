import krpc, { type KRPCNode, type KRPCResponse } from 'k-rpc'
import krpcSocket from 'k-rpc-socket'

import type { Connection } from './ws/client'
import type { Socket } from './ws/peer'

import { CONFIG } from '../config'
import { log } from '../log'

const onReply = (message: KRPCResponse, node: KRPCNode): false | undefined => undefined
  // Console.log('visited peer', message, node)

const connections = new Map<string, RPC>()

const startRPC = () => {
  const socket = krpcSocket({ timeout: 60_000 })
  const rpc = krpc({ krpcSocket: socket, timeout: 60_000 })
  
  rpc.on('query', (query, node) => {
    const q = query.q.toString()
    if (!q.startsWith(CONFIG.rpcPrefix)) return

    const key = `${node.host}:${node.port}`
    log(`[RPC] Received message from ${key}: ${q}`)

    if (q === `${CONFIG.rpcPrefix}_msg`) {
      const message = query.a?.['d']?.toString()
      if (message) connections.get(key)?.messageHandler?.(message)
      rpc.response(node, query, { ok: true })
    }
  })

  return { rpc, socket }
}

export const { rpc, socket } = startRPC()

// Rpc.response(node, query, response, [nodes], [callback])

export class RPC implements Socket {
  public isOpened = true
  public messageHandler?: (message: string) => void
  public readonly peer: Connection
  private closeHandlers: (() => void)[] = []
  private readonly node: { host: string, port: number }
  private openHandler?: () => void

  constructor(hostname: `rpc://${string}`) {
    log(`[RPC] Connecting to peer ${hostname}`)
    const { hostname: host, port } = new URL(hostname)
    this.node = { host, port: Number(port) }
    this.peer = { address: `0x${Math.ceil(Math.random()*10000)}`, hostname, userAgent: 'Hydrabase/DHT', username: 'DHT Test' }
    setTimeout(() => this.openHandler?.(), 5_000)
    connections.set(`${this.node.host}:${this.node.port}`, this)
  }
  public readonly close = () => {
    this.isOpened = false
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
  public readonly send = (message: string) => socket.query(this.node, { d: message, q: `${CONFIG.rpcPrefix}_msg` }, (err, reply) => {
    if (err) {
      console.error(err)
      return this.close()
    }
    if (!this.isOpened) {
      this.isOpened = true
      this.openHandler?.()
    }
    log(`[RPC] Peer responded`, reply) // Reply.r has their response data
  })
}
