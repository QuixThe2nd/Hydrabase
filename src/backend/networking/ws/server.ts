import type { SocketAddress } from "bun";

import type { Config, Socket, WebSocketData } from "../../../types/hydrabase";
import type PeerManager from "../../PeerManager";

import { debug, log, logContext, warn } from "../../../utils/log";
import { type Identity, verifyClient } from "../../protocol/HIP1/handshake";
import { authenticateServerHTTP } from '../http';

export class WebSocketServerConnection implements Socket {
  get isOpened() {
    return this.socket.data.isOpened
  }
  get peer() {
    return {
      address: this.socket.data.address,
      hostname: this.socket.data.hostname,
      userAgent: this.socket.data.userAgent,
      username: this.socket.data.username
    }
  }
  private closeHandlers: (() => void)[] = []
  private messageHandlers: ((message: string) => void)[] = []
  private openHandler?: () => void

  constructor(private readonly socket: Bun.ServerWebSocket<WebSocketData>) {}

  _handleClose() {
    for (const handler of this.closeHandlers) handler()
  }
  _handleMessage(message: string) {
    if (this.messageHandlers.length === 0) warn('DEVWARN:', `[RPC] Couldn't find message handler ${this.peer.hostname}`)
    this.messageHandlers.forEach(handler => {
      handler(message)
    })
  }
  _handleOpen() {
    this.openHandler?.();
  }
  public readonly close = () => this.socket.close()
  public onClose(handler: () => void) {
    this.closeHandlers.push(() => handler())
  }
  public onMessage(handler: (message: string) => void) {
    this.messageHandlers.push(handler);
  }
  public onOpen(handler: () => void) {
    this.openHandler = handler;
  }
  public readonly send = (message: string) => {
    if (this.isOpened) {this.socket.send(message)}
  }
}

export const websocketHandlers = (peerManager: PeerManager) => ({
  close(ws: Bun.ServerWebSocket<WebSocketData>) {
    logContext('WS', () => {
      ws.data = { ...ws.data, isOpened: false }
      ws.data.conn?._handleClose()
    })
  },
  data: {} as WebSocketData,
  message: (ws: Bun.ServerWebSocket<WebSocketData>, message: Buffer<ArrayBuffer> | string) => {
    logContext('WS', () => {
      if (typeof message !== 'string') return
      ws.data.conn?._handleMessage(message)
    })
  },
  open: (ws: Bun.ServerWebSocket<WebSocketData>) => {
    logContext('WS', () => {
      const conn = new WebSocketServerConnection(ws)
      peerManager.add(conn)
      ws.data = { ...ws.data, conn, isOpened: true }
      ws.data.conn?._handleOpen()
    })
  }
})

const VERIFY_TIMEOUT_MS = 15_000

export const handleConnection = async (server: Bun.Server<WebSocketData>, req: Request, ip: SocketAddress, node: Config['node'], apiKey: string, peerManager?: PeerManager): Promise<undefined | { address?: `0x${string}`, hostname?: `${string}:${number}`, res: [number, string] }> => {
  log(`[HTTP] [SERVER] Connecting to client ${ip?.address}`)
  const headers = Object.fromEntries(req.headers.entries())
  const auth = 'x-api-key' in headers ? { apiKey: headers['x-api-key'] } : 'sec-websocket-protocol' in headers ? { apiKey: headers['sec-websocket-protocol'].replace('x-api-key-', '') } : { address: headers['x-address'] as `0x${string}`, hostname: headers['x-hostname'] as `${string}:${number}`, signature: headers['x-signature'] as string, userAgent: headers['x-userAgent'] as string, username: headers['x-username'] as string, }
  if (!('apiKey' in auth) && (!auth.address || !auth.hostname || !auth.signature || !auth.username)) {
    warn('DEVWARN:', `[SERVER] Rejected connection from ${ip?.address}: missing handshake headers`)
    return { res: [400, 'Missing required handshake headers'] }
  }
  
  if (peerManager && !('apiKey' in auth) && auth.address && peerManager.has(auth.address)) {
    debug(`[SERVER] Skipping duplicate connection from ${auth.username} ${auth.address} - already connected`)
    return { address: auth.address, hostname: auth.hostname, res: [409, 'Already connected'] }
  }
  const authenticateHostname = async (claimedHostname: `${string}:${number}`): Promise<[number, string] | Identity> => {
    const result = await authenticateServerHTTP(claimedHostname)
    if (!Array.isArray(result)) return result
    
    const actualIP = ip.address
    const [claimedIP] = claimedHostname.split(':')
    if (actualIP === claimedIP && 'address' in auth) {
      debug(`[SERVER] NAT detected: same IP (${actualIP}), accepting peer ${auth.address} at claimed ${claimedHostname}`)
      return { address: auth.address as `0x${string}`, hostname: claimedHostname, userAgent: auth.userAgent as string, username: auth.username as string }
    }
    
    return result
  }
  const peer = await Promise.race([
    verifyClient(node, `${ip.address}:${ip.port}`, auth, apiKey, authenticateHostname),
    new Promise<[number, string]>(resolve => { setTimeout(() => { resolve([408, `Verification timed out after ${VERIFY_TIMEOUT_MS / 1000}s for ${ip?.address}`]) }, VERIFY_TIMEOUT_MS) })
  ])
  if (Array.isArray(peer)) {
    warn('DEVWARN:', `[SERVER] Failed to authenticate peer: ${peer[1]}`)
    return { res: peer }
  }
  const { address, hostname, userAgent, username } = peer
  log(`[SERVER] Authenticated connection to ${username} ${address} ${hostname} from ${ip?.address}`)
  if (server.upgrade(req, { data: { address, hostname, isOpened: false, userAgent, username } })) {
    return undefined
  }
  return { address, hostname, res: [500, "Upgrade failed"] }
}
