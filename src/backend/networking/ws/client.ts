import type { Socket } from '../../../types/hydrabase'
import type { Account } from '../../Crypto/Account'
import type Peers from '../../Peers'

import { log, warn } from '../../../utils/log'
import { type Identity, proveClient } from '../../protocol/HIP1/handshake'

export default class WebSocketClient implements Socket {
  get isOpened() {
    return this._isOpened
  }
  private _isOpened = false
  private closeHandlers: (() => void)[] = []
  private dontReconnect = false
  private messageHandler?: (message: string) => void
  private openHandler?: () => void
  private reconnectAttempts = 1
  private reconnectTimer: null | ReturnType<typeof setTimeout> = null
  private retryQueue: (() => void)[] = []
  private socket!: WebSocket

  constructor(public readonly peer: Identity, private readonly peers: Peers) {
    this._connect(peers.account)
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
    if (this._isOpened) this.socket.send(data)
    else this.retryQueue.push(() => this.socket.send(data))
  }

  private _connect(account: Account) {
    log(`[CLIENT] Connecting to ${this.peer.username} ${this.peer.address} ws://${this.peer.hostname}`)
    this.socket = new WebSocket(`ws://${this.peer.hostname}`, { headers: proveClient(account, this.peer.hostname, this.peers.hostname, true) })

    this.socket.addEventListener('open', () => {
      log(`[CLIENT] Connected to ${this.peer.username} ${this.peer.address} ws://${this.peer.hostname}`)
      this._isOpened = true
      this._flushQueue()
      this.openHandler?.()
    })

    this.socket.addEventListener('close', ev => {
      warn('WARN:', `[CLIENT] Connection closed with server ${this.peer.username} ${this.peer.address} ws://${this.peer.hostname} - ${ev.reason}`)
      this._isOpened = false
      for (const handler of this.closeHandlers) handler()
      if (!this.peers.isConnectionOpened(this.peer.address)) {this._scheduleReconnect(account)}
    })

    this.socket.addEventListener('error', err => {
      warn('DEVWARN:', `[CLIENT] Connection failed with server ${this.peer.username} ${this.peer.address} ws://${this.peer.hostname} - ${(err as unknown as { message: string }).message}`)
      this._isOpened = false
      for (const handler of this.closeHandlers) handler()
    }) // TODO: peer rate limiting

    this.socket.addEventListener('message', message => this.messageHandler?.(message.data))
  } // TODO: SSL support
  private _flushQueue() {
    const queue = this.retryQueue.splice(0)
    for (const fn of queue) fn()
  } // TODO: unit tests
  private _scheduleReconnect(account: Account) {
    if (this.reconnectTimer) return
    log(`[CLIENT] Reconnecting to ${this.peer.username} ${this.peer.address} ${this.peer.hostname} in ${this.reconnectAttempts*5_000}ms...`)
    this.reconnectTimer = setTimeout(() => this.dontReconnect ? undefined : this._connect(account), this.reconnectAttempts*5_000)
    this.reconnectAttempts++
  }
}
// TODO: force logout of gui on api key change