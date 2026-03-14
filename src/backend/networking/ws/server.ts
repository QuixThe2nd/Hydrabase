import type { SocketAddress } from "bun";

import type { Config, Socket, WebSocketData } from "../../../types/hydrabase";
import type PeerManager from "../../PeerManager";

import { log, warn } from "../../../utils/log";
import { verifyClient } from "../../protocol/HIP1/handshake";
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
    ws.data = { ...ws.data, isOpened: false }
    ws.data.conn?._handleClose()
  },
  data: {} as WebSocketData,
  message: (ws: Bun.ServerWebSocket<WebSocketData>, message: Buffer<ArrayBuffer> | string) => {
    if (typeof message !== 'string') return
    ws.data.conn?._handleMessage(message)
  },
  open: (ws: Bun.ServerWebSocket<WebSocketData>) => {
    const conn = new WebSocketServerConnection(ws)
    peerManager.add(conn)
    ws.data = { ...ws.data, conn, isOpened: true }
    ws.data.conn?._handleOpen()
  }
})

const VERIFY_TIMEOUT_MS = 15_000

export const handleConnection = async (server: Bun.Server<WebSocketData>, req: Request, ip: null | SocketAddress, node: Config['node'], apiKey: string): Promise<undefined | { address?: `0x${string}`, hostname?: `${string}:${number}`, res: [number, string] }> => {
  log(`[SERVER] Connecting to client ${ip?.address}`)
  const headers = Object.fromEntries(req.headers.entries())
  const auth = 'x-api-key' in headers ? { apiKey: headers['x-api-key'] } : 'sec-websocket-protocol' in headers ? { apiKey: headers['sec-websocket-protocol'].replace('x-api-key-', '') } : { address: headers['x-address'] as `0x${string}`, hostname: headers['x-hostname'] as `${string}:${number}`, signature: headers['x-signature'] as string, userAgent: headers['x-userAgent'] as string, username: headers['x-username'] as string, }
  if (!('apiKey' in auth) && (!auth.address || !auth.hostname || !auth.signature || !auth.username)) {
    warn('DEVWARN:', `[SERVER] Rejected connection from ${ip?.address}: missing handshake headers`)
    return { res: [400, 'Missing required handshake headers'] }
  }
  const peer = await Promise.race([
    verifyClient(node, auth, apiKey, authenticateServerHTTP),
    new Promise<[number, string]>(resolve => { setTimeout(() => { resolve([408, `Verification timed out after ${VERIFY_TIMEOUT_MS / 1000}s for ${ip?.address}`]) }, VERIFY_TIMEOUT_MS) })
  ])
  if (Array.isArray(peer)) {
    warn('DEVWARN:', `[SERVER] Failed to authenticate peer: ${peer[1]}`)
    return { res: peer }
  }
  const { address, hostname, userAgent, username } = peer
  log(`[SERVER] Authenticated connection to ${username} ${address} ${hostname} from ${ip?.address}`)
  return server.upgrade(req, { data: { address, hostname, isOpened: false, userAgent, username } }) ? undefined : { address, hostname, res: [500, "Upgrade failed"] }
}
