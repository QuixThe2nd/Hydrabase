import type { Config, Socket } from '../../../types/hydrabase'
import type { Account } from '../../Crypto/Account'
import type PeerManager from '../../PeerManager'

import { log, warn } from '../../../utils/log'
import { type Identity, proveClient } from '../../protocol/HIP1/handshake'

export default class WebSocketClient implements Socket {
  private static readonly OPEN_TIMEOUT_MS = 30_000

  get isOpened() {
    return this._isOpened
  }
  private _isOpened = false
  private closeHandlers: (() => void)[] = []
  private dontReconnect = false
  private messageHandlers: ((message: string) => void)[] = []
  private openHandler?: () => void
  private reconnectAttempts = 1
  private reconnectTimer: null | ReturnType<typeof setTimeout> = null
  private retryQueue: (() => void)[] = []
  private socket!: WebSocket

  constructor(public readonly peer: Identity, private readonly peers: PeerManager, private readonly node: Config['node']) {
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
    this.messageHandlers.push(handler)
  }

  public onOpen(handler: () => void) {
    this.openHandler = () => handler()
  }

  send(data: string) {
    if (this._isOpened) this.socket.send(data)
    else {
      warn('DEVWARN:', `[CLIENT] Cannot send to ${this.peer.username} ${this.peer.address} ws://${this.peer.hostname} - connection not open (readyState: ${this.socket.readyState}), queuing message`)
      this.retryQueue.push(() => this.socket.send(data))
    }
  }

  private _connect(account: Account) {
    log(`[CLIENT] Connecting to ${this.peer.username} ${this.peer.address} ws://${this.peer.hostname}`)
    this.socket = new WebSocket(`ws://${this.peer.hostname}`, { headers: proveClient(account, this.node, this.peer.hostname, true) })

    const openTimeout = setTimeout(() => {
      if (!this._isOpened) {
        warn('WARN:', `[CLIENT] Connection to ${this.peer.username} ${this.peer.address} ws://${this.peer.hostname} timed out waiting for open event (${WebSocketClient.OPEN_TIMEOUT_MS / 1000}s)`)
        this.socket.close()
      }
    }, WebSocketClient.OPEN_TIMEOUT_MS)

    this.socket.addEventListener('open', () => {
      clearTimeout(openTimeout)
      this.reconnectAttempts = 1
      this.reconnectTimer = null
      log(`[CLIENT] Connected to ${this.peer.username} ${this.peer.address} ws://${this.peer.hostname}`)
      this._isOpened = true
      this._flushQueue()
      this.openHandler?.()
    })

    this.socket.addEventListener('close', ev => {
      clearTimeout(openTimeout)
      warn('WARN:', `[CLIENT] Connection closed with server ${this.peer.username} ${this.peer.address} ws://${this.peer.hostname} - ${ev.reason ?? 'Connection closed'}${ev.code === 1000 ? '' : ` (code: ${ev.code})`}`)
      this._isOpened = false
      for (const handler of this.closeHandlers) handler()
      if (!this.peers.isConnectionOpened(this.peer.address)) {this._scheduleReconnect(account)}
    })

    this.socket.addEventListener('error', err => {
      clearTimeout(openTimeout)
      const errorMsg = (err as unknown as { message: string }).message
      warn('DEVWARN:', `[CLIENT] Connection failed with server ${this.peer.username} ${this.peer.address} ws://${this.peer.hostname} - ${errorMsg}`)
      
      if (errorMsg.includes('Expected 101 status code') || errorMsg.includes('status code')) {
        this._fetchRejectionReason()
      }
      
      this._isOpened = false
    }) // TODO: peer rate limiting

    this.socket.addEventListener('message', message => {
      if (this.messageHandlers.length === 0) warn('DEVWARN:', `[RPC] Couldn't find message handler ${this.peer.hostname}`)
      this.messageHandlers.forEach(handler => {
        handler(message.data)
      })
    })
  } // TODO: SSL support
  
  private async _fetchRejectionReason() {
    try {
      const httpUrl = `http://${this.peer.hostname}`
      const response = await fetch(httpUrl, { 
        headers: { 
          'Connection': 'upgrade',
          'Upgrade': 'websocket',
          ...proveClient(this.peers.account, this.node, this.peer.hostname, true)
        },
        method: 'GET'
      }).catch(() => null)
      
      if (response && response.ok === false) {
        const body = await response.text().catch(() => '')
        warn('WARN:', `[CLIENT] Server ${this.peer.hostname} rejected connection: HTTP ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`)
      }
    } catch {
      // Silently ignore fetch errors - this is just for debugging info
    }
  }
  
  private _flushQueue() {
    const queue = this.retryQueue.splice(0)
    for (const fn of queue) fn()
  }
  private _scheduleReconnect(account: Account) {
    if (this.reconnectTimer) return
    log(`[CLIENT] Reconnecting to ${this.peer.username} ${this.peer.address} ${this.peer.hostname} in ${this.reconnectAttempts*5_000}ms...`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.dontReconnect) this._connect(account)
    }, this.reconnectAttempts*5_000)
    this.reconnectAttempts++
  }
}
// TODO: force logout of gui on api key change