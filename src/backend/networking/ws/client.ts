import type { Config, Socket } from '../../../types/hydrabase'
import type { Account } from '../../crypto/Account'

import { warn } from '../../../utils/log'
import { Trace } from '../../../utils/trace'
import { type Identity, proveClient } from '../../protocol/HIP1_Identity'

export default class WebSocketClient implements Socket {
  private static readonly OPEN_TIMEOUT_MS = 30_000

  private closeHandlers: (() => void)[] = []
  private isOpened = false
  private messageHandlers: ((message: string) => void)[] = []
  private retryQueue: (() => void)[] = []
  private socket!: WebSocket
  private trace!: Trace

  private constructor(
    public readonly identity: Identity,
    private readonly account: Account,
    private readonly node: Config['node'],
    private readonly onOpen: () => void
  ) {
    this._connect(account)
  }

  static init = (identity: Identity, account: Account, node: Config['node']): Promise<WebSocketClient> => new Promise<WebSocketClient>(res => {
    const socket = new WebSocketClient(identity, account, node, () => res(socket))
  })

  public readonly close = () => {
    this.retryQueue = []
    this.socket.close()
  }

  public onClose(handler: () => void) {
    this.closeHandlers?.push(() => handler())
  }

  public onMessage(handler: (message: string) => void) {
    this.messageHandlers.push(handler)
  }

  send(data: string) {
    if (this.isOpened) this.socket.send(data)
    else {
      warn('DEVWARN:', `[CLIENT] Cannot send to ${this.identity.username} ${this.identity.address} ws://${this.identity.hostname} - connection not open (readyState: ${this.socket.readyState}), queuing message`)
      this.retryQueue.push(() => this.socket.send(data))
    }
  }

  private _connect(account: Account) {
    this.trace = Trace.start(`WS client → ${this.identity.hostname}`)
    this.trace.step('Connecting')
    this.socket = new WebSocket(`ws://${this.identity.hostname}`, { headers: proveClient(account, this.node, this.identity.hostname, this.trace, true) })
    const openTimeout = setTimeout(() => {
      if (!this.isOpened) {
        this.trace.step(`Connection timed out after ${WebSocketClient.OPEN_TIMEOUT_MS / 1000}s`)
        this.trace.fail('Connection timed out')
        this.socket.close()
      }
    }, WebSocketClient.OPEN_TIMEOUT_MS)
    this.socket.addEventListener('open', () => {
      clearTimeout(openTimeout)
      this.trace.step('Connected')
      this.trace.success()
      this.isOpened = true
      this._flushQueue()
      this.onOpen()
    })
    this.socket.addEventListener('close', ev => {
      clearTimeout(openTimeout)
      const reason = ev.reason ?? 'Connection closed'
      const codeInfo = ev.code === 1000 ? '' : ` (code: ${ev.code})`
      this.trace.step(`Connection closed: ${reason}${codeInfo}`)
      this.trace.fail(`${reason}${codeInfo}`)
      this.isOpened = false
      for (const handler of this.closeHandlers) handler()
    })
    this.socket.addEventListener('error', err => {
      clearTimeout(openTimeout)
      const errorMsg = (err as unknown as { message: string }).message
      this.trace.step(`Connection failed: ${errorMsg}`)
      this.trace.fail(errorMsg)
      
      if (errorMsg.includes('Expected 101 status code') || errorMsg.includes('status code')) {
        this._fetchRejectionReason()
      }
      
      this.isOpened = false
    }) // TODO: peer rate limiting
    this.socket.addEventListener('message', message => {
      if (this.messageHandlers.length === 0) warn('DEVWARN:', `[RPC] Couldn't find message handler ${this.identity.hostname}`)
      this.messageHandlers.forEach(handler => {
        handler(message.data)
      })
    })
  } // TODO: SSL support
  
  private async _fetchRejectionReason() {
    try {
      const httpUrl = `http://${this.identity.hostname}`
      const authHeaders = Object.fromEntries(
        Object.entries(proveClient(this.account, this.node, this.identity.hostname, this.trace, true)).filter(([, value]) => typeof value === 'string')
      ) as Record<string, string>
      const response = await fetch(httpUrl, { 
        headers: {
          'Connection': 'upgrade',
          'Upgrade': 'websocket',
          ...authHeaders
        },
        method: 'GET'
      }).catch(() => null)
      
      if (response && response.ok === false) {
        const body = await response.text().catch(() => '')
        const rejectionMsg = `HTTP ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`
        this.trace.step(`Server rejected: ${rejectionMsg}`)
      }
    } catch {
      // Silently ignore fetch errors - this is just for debugging info
    }
  }
  
  private _flushQueue() {
    const queue = this.retryQueue.splice(0)
    for (const fn of queue) fn()
  }
}
// TODO: force logout of gui on api key change