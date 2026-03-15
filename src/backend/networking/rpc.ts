import bencode from 'bencode'

import type { Config, Socket } from '../../types/hydrabase'
import type PeerManager from '../PeerManager'

import { log } from '../../utils/log'
import { authenticatedPeers, type Query, udpConnections } from './udp'

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
  public readonly send = (message: string) => {
    const tid = Buffer.alloc(4)
    tid.writeUInt32BE(Math.floor(Math.random() * 0xFFFFFFFF))
    this.peers.socket.send(bencode.encode({ a: { d: message }, q: `${this.config.prefix}msg`, t: tid.toString('hex'), y: 'q' } satisfies Query), Number(this.identity.hostname.split(':')[1]), this.identity.hostname.split(':')[0])
  }
}
