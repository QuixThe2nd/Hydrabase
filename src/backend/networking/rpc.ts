import type { Config, Socket } from '../../types/hydrabase'
import type PeerManager from '../PeerManager'

import { debug, error, log } from '../../utils/log'
import { authenticatedPeers, udpConnections } from './udp'

export class RPC implements Socket {
  public isOpened = true
  public readonly messageHandlers: ((message: string) => void)[] = []
  public readonly peer
  private closeHandlers: (() => void)[] = []
  private readonly node: { host: string, port: number }
  private openHandler?: () => void
  constructor(private readonly peers: PeerManager, private readonly identity: { address: `0x${string}`, hostname: `${string}:${number}`, userAgent: string, username: string }, private readonly config: Config['rpc']) {
    authenticatedPeers.set(`${identity.hostname}`, identity)
    udpConnections.set(identity.hostname, this)
    log(`[RPC] Connecting to peer ${identity.hostname}`)
    const [host, port] = identity.hostname.split(':') as [string, `${number}`]
    this.node = { host, port: Number(port) }
    this.peer = { ...identity, hostname: identity.hostname }
    setTimeout(() => this.openHandler?.(), 0)
  }
  public readonly close = () => {
    this.isOpened = false
    udpConnections.delete(`${this.node.host}:${this.node.port}`)
    this.closeHandlers.map(handler => handler())
  }
  public readonly onClose = (handler: () => void) => {
    this.closeHandlers.push(() => handler())
  }
  public onMessage(handler: (message: string) => void) {
    this.messageHandlers.push(handler)
  }
  public onOpen(handler: () => void) {
    this.openHandler = () => handler()
  }
  public readonly send = (message: string) => this.peers.rpc.query(this.node, { a: { d: message }, q: `${this.config.prefix}msg` }, err => {
    if (err) {
      error('ERROR:', `[RPC] Message failed to send ${err.message}`)
      return
    }
    debug(`[RPC] Peer acknowledged message ${this.identity.hostname}`)
    if (!this.isOpened) {
      this.isOpened = true
      this.openHandler?.()
    }
  })
}
