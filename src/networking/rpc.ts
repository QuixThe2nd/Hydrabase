import krpc, { type KRPCNode, type KRPCResponse } from 'k-rpc'
import krpcSocket from 'k-rpc-socket'

import type { Connection } from './ws/client'
import type { Socket } from './ws/peer'

import { CONFIG } from '../config'
import { log } from '../log'

const onReply = (message: KRPCResponse, node: KRPCNode): false | undefined => undefined
  // Console.log('visited peer', message, node)

const startRPC = () => {
  const socket = krpcSocket()
  const rpc = krpc({ krpcSocket: socket })
  rpc.on('query', query => {
    const q = query.q.toString()
    if (q.startsWith(CONFIG.rpcPrefix)) log(`[RPC] Received message: ${q}`)
  })
  return { rpc, socket }
}

export const { rpc, socket } = startRPC()

// Rpc.response(node, query, response, [nodes], [callback])

export class RPC implements Socket {
  public isOpened = true
  public readonly peer: Connection
  private closeHandlers: (() => void)[] = []
  private openHandler?: () => void
  private messageHandler?: (message: string) => void
  private readonly node: { host: string, port: number }

  constructor(hostname: `ws://${string}`) {
    log(`[RPC] Connecting to peer ${hostname}`)
    const { hostname: host, port } = new URL(hostname)
    this.node = { host, port: Number(port) }
    this.peer = { address: '0x0', hostname, userAgent: 'Hydrabase/DHT', username: 'Anonymous' }
    setTimeout(() => this.openHandler?.(), 5_000)
  }
  public readonly close = () => {
    this.isOpened = false
    this.closeHandlers.map(handler => handler())
  }
  public readonly onClose = (handler: () => void) => {
    this.closeHandlers.push(() => handler())
  }
  public onMessage(handler: (message: string) => void) {
    this.messageHandler = (msg) => handler(msg)
  }

  public onOpen(handler: () => void) {
    this.openHandler = () => handler()
  }
  public readonly send = (message: string) => {
    log('[RPC] Sending', {message})
    socket.query(this.node, { d: message, q: `${CONFIG.rpcPrefix}_msg` }, (err, reply) => {
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
}
