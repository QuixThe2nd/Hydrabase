import z from 'zod'

import type { Account } from '../../Crypto/Account'
import type Peers from '../../Peers'

import { log, warn } from '../../log'
import { HIP3_CONN_Authentication } from '../../protocol/HIP3/authentication'

export interface Self {
  account: Account
  hostname: `ws://${string}`
}
interface Peer {
  address: `0x${string}`
  hostname: `ws://${string}`
  username: string
}

export const AuthSchema = z.object({
  address: z.string().regex(/^0x/iu, { message: "Address must start with 0x" }).transform(val => val as `0x${string}`),
  username: z.string().default('Anonymous'),
  signature: z.string(),
})

export default class WebSocketClient {
  get isOpened() {
    return this._isOpened
  }
  private _isOpened = false
  private closeHandlers: (() => void)[] = []
  private dontReconnect = false
  private messageHandler?: (message: string) => void
  private openHandler?: () => void
  private reconnectAttempts = 0
  private reconnectTimer: null | ReturnType<typeof setTimeout> = null
  private retryQueue: (() => void)[] = []

  private socket!: WebSocket

  private constructor(account: Account, public readonly peer: Peer, private readonly peers: Peers) {
    this._connect(account)
  }

  static readonly init = async (peers: Peers, account: Account, hostname: `ws://${string}`) => {
    const result = await HIP3_CONN_Authentication.verifyClientIdentity(hostname)
    if (!result) return result
    const { address, username } = result
    if (peers.has(address)) return warn('DEVWARN:', `[CLIENT] Already connected/connecting to peer ${username} ${address}`)
    if (address === account.address) return warn('DEVWARN:', `[CLIENT] Not connecting to self`)
    return new WebSocketClient(account, { address, hostname, username }, peers)
  }

  public readonly close = () => {
    this.retryQueue = []
    this.socket.close()
    this.dontReconnect = true
  }

  public onClose(handler: () => void) {
    this.closeHandlers?.push(() => handler())
  }

  public onMessage(handler: (message: string) => void) {
    this.messageHandler = (msg) => handler(msg)
  }

  public onOpen(handler: () => void) {
    this.openHandler = () => handler()
  }

  send(data: string) {
    if (this._isOpened) {this.socket.send(data)}
    else {this.retryQueue.push(() => this.socket.send(data))}
  }

  private _connect(account: Account) {
    const headers = HIP3_CONN_Authentication.proveClientAddress(account, this.peer.hostname)
    log(`[CLIENT] Connecting to server ${this.peer.username} ${this.peer.hostname} ${this.peer.address}`)
    this.socket = new WebSocket(this.peer.hostname, { headers })

    this.socket.addEventListener('open', () => {
      log(`[CLIENT] Connected to server ${this.peer.username} ${this.peer.hostname} ${this.peer.address}`)
      this._isOpened = true
      this._flushQueue()
      this.openHandler?.()
    })

    this.socket.addEventListener('close', ev => {
      log(`[CLIENT] Connection closed with server ${this.peer.username} ${this.peer.hostname} ${this.peer.address}`, `- ${ev.reason}`)
      this._isOpened = false
      for (const handler of this.closeHandlers) handler()
      if (!this.peers.isConnectionOpened(this.peer.address)) {this._scheduleReconnect(account)}
    })

    this.socket.addEventListener('error', err => {
      warn('DEVWARN:', `[CLIENT] Connection failed with server ${this.peer.username} ${this.peer.hostname} ${this.peer.address}`, err)
      this._isOpened = false
      for (const handler of this.closeHandlers) handler()
    })

    this.socket.addEventListener('message', message => this.messageHandler?.(message.data))
  }
  private _flushQueue() {
    const queue = this.retryQueue.splice(0)
    for (const fn of queue) fn()
  }
  private _scheduleReconnect(account: Account) {
    if (this.reconnectTimer) return
    log(`[CLIENT] Reconnecting to ${this.peer.username} ${this.peer.address} ${this.peer.hostname} in ${this.reconnectAttempts*5_000}ms...`)
    this.reconnectTimer = setTimeout(() => this.dontReconnect ? undefined : this._connect(account), this.reconnectAttempts*5_000)
    this.reconnectAttempts++
  }
}
