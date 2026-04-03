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
    private readonly onOpen: () => void,
    private readonly onFail: (error: Error) => void
  ) {
    this._connect(account)
  }

  static init = (identity: Identity, account: Account, node: Config['node']): Promise<WebSocketClient> => new Promise<WebSocketClient>((res, rej) => {
    let settled = false
    const socket = new WebSocketClient(identity, account, node, () => {
      if (settled) return
      settled = true
      res(socket)
    }, (error) => {
      if (settled) return
      settled = true
      rej(error)
    })
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

  // eslint-disable-next-line max-lines-per-function
  private _connect(account: Account) {
    this.trace = Trace.start(`WS client → ${this.identity.hostname}`)
    this.trace.step('Connecting')
    const authHeaders = Object.fromEntries(
      Object.entries(proveClient(account, this.node, this.identity.hostname, this.trace, true)).filter(([, value]) => typeof value === 'string')
    ) as Record<string, string>
    this.socket = new WebSocket(`ws://${this.identity.hostname}`, {
      headers: authHeaders,
    } as unknown as string[])
    const openTimeout = setTimeout(() => {
      if (!this.isOpened) {
        // #region agent log
        fetch('http://127.0.0.1:7488/ingest/ae9253ff-0376-45a8-b089-19456fa3761b',{body:JSON.stringify({data:{hostname:this.identity.hostname,timeoutMs:WebSocketClient.OPEN_TIMEOUT_MS},hypothesisId:'H6',location:'src/backend/networking/ws/client.ts:65',message:'WebSocket open timed out',runId:'post-fix',sessionId:'58f352',timestamp:Date.now()}),headers:{'Content-Type':'application/json','X-Debug-Session-Id':'58f352'},method:'POST'}).catch(() => undefined)
        // #endregion
        this.trace.step(`Connection timed out after ${WebSocketClient.OPEN_TIMEOUT_MS / 1000}s`)
        this.trace.fail('Connection timed out')
        this.socket.close()
        this.onFail(new Error(`WebSocket connection timeout after ${WebSocketClient.OPEN_TIMEOUT_MS}ms`))
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
      // #region agent log
      fetch('http://127.0.0.1:7488/ingest/ae9253ff-0376-45a8-b089-19456fa3761b',{body:JSON.stringify({data:{code:ev.code,hostname:this.identity.hostname,opened:this.isOpened,reason},hypothesisId:'H6',location:'src/backend/networking/ws/client.ts:84',message:'WebSocket closed',runId:'post-fix',sessionId:'58f352',timestamp:Date.now()}),headers:{'Content-Type':'application/json','X-Debug-Session-Id':'58f352'},method:'POST'}).catch(() => undefined)
      // #endregion
      this.trace.step(`Connection closed: ${reason}${codeInfo}`)
      this.trace.fail(`${reason}${codeInfo}`)
      this.isOpened = false
      if (ev.code !== 1000) this.onFail(new Error(`${reason}${codeInfo}`))
      for (const handler of this.closeHandlers) handler()
    })
    this.socket.addEventListener('error', err => {
      clearTimeout(openTimeout)
      const errorMsg = (err as unknown as { message: string }).message
      // #region agent log
      fetch('http://127.0.0.1:7488/ingest/ae9253ff-0376-45a8-b089-19456fa3761b',{body:JSON.stringify({data:{error:errorMsg,hostname:this.identity.hostname},hypothesisId:'H6',location:'src/backend/networking/ws/client.ts:94',message:'WebSocket error',runId:'post-fix',sessionId:'58f352',timestamp:Date.now()}),headers:{'Content-Type':'application/json','X-Debug-Session-Id':'58f352'},method:'POST'}).catch(() => undefined)
      // #endregion
      this.trace.step(`Connection failed: ${errorMsg}`)
      this.trace.fail(errorMsg)
      
      if (errorMsg.includes('Expected 101 status code') || errorMsg.includes('status code')) {
        this._fetchRejectionReason()
      }
      
      this.isOpened = false
      this.onFail(new Error(errorMsg || 'WebSocket connection failed'))
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