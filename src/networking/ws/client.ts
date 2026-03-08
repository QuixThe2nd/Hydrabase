import type { Account } from '../../Crypto/Account'
import type Peers from '../../Peers'
import type { Socket } from './peer'

import { CONFIG } from '../../config'
import { Signature } from '../../Crypto/Signature'
import { log, warn } from '../../log'
import { AuthSchema, HIP3_CONN_Authentication } from '../../protocol/HIP3/authentication'
import { RPC } from '../rpc'

export interface Connection {
  address: `0x${string}`
  hostname: `${string}:${number}`
  userAgent: string
  username: string
}

export const getCanonicalHostname = async (hostname: `${string}:${number}`) => {
  try {
    const res = await fetch(`http://${hostname}/auth`)
    const body = await res.text()
    const signature = AuthSchema.safeParse(JSON.parse(body)).data?.signature
    return signature ? Signature.fromString(signature).message.replace('I am ', '') as `${string}:${number}` : hostname
  } catch (_) {
    return hostname
  }
}

export default class WebSocketClient implements Socket {
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

  private constructor(public readonly peer: Connection, private readonly peers: Peers) {
    this._connect(peers.account)
  }

  // eslint-disable-next-line max-statements
  static readonly init = async (peers: Peers, hostname: `${string}:${number}`): Promise<false | Socket> => {
    if (hostname === `${CONFIG.hostname}:${CONFIG.port}`) return false
    const canonHostname = await getCanonicalHostname(hostname)
    if (canonHostname && hostname !== canonHostname) return await WebSocketClient.init(peers, canonHostname)
    log(`[CLIENT] Attempting to connect to ws://${hostname}`)
    // if (hostname !== '0.0.0.0:0') RPC.fromOutbound(hostname, peers).then(rpc => { if (rpc) peers.add(rpc) })
    // return RPC.fromOutbound(hostname, peers)
    const result = await HIP3_CONN_Authentication.verifyServerFromClient(hostname)
    if (!result) return warn('DEVWARN:', `[CLIENT] Authentication failed ${hostname}`)
    const { address, userAgent, username } = result
    if (peers.has(address)) return warn('DEVWARN:', `[CLIENT] Already connected/connecting to peer ${username} ${address} ws://${hostname}`)
    if (address === peers.account.address) return warn('DEVWARN:', `[CLIENT] Not connecting to self`)
    return new WebSocketClient({ address, hostname, userAgent, username }, peers)
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
    const headers = HIP3_CONN_Authentication.proveClientAddress(account, this.peer.hostname)
    log(`[CLIENT] Connecting to ${this.peer.username} ${this.peer.address} ws://${this.peer.hostname}`)
    this.socket = new WebSocket(`ws://${this.peer.hostname}`, { headers })

    this.socket.addEventListener('open', () => {
      log(`[CLIENT] Connected to ${this.peer.username} ${this.peer.address} ws://${this.peer.hostname}`)
      this._isOpened = true
      this._flushQueue()
      this.openHandler?.()
    })

    this.socket.addEventListener('close', ev => {
      warn('WARN:', `[CLIENT] Connection closed with server ${this.peer.username} ${this.peer.address} ws://${this.peer.hostname}`, `- ${ev.reason}`)
      this._isOpened = false
      for (const handler of this.closeHandlers) handler()
      if (!this.peers.isConnectionOpened(this.peer.address)) {this._scheduleReconnect(account)}
    })

    this.socket.addEventListener('error', err => {
      warn('DEVWARN:', `[CLIENT] Connection failed with server ${this.peer.username} ${this.peer.address} ws://${this.peer.hostname} - ${(err as unknown as { message: string }).message}`)
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
// TODO: force logout of gui on api key change