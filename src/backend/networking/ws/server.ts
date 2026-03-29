import type { SocketAddress } from 'bun'

import type { Config, Socket } from '../../../types/hydrabase'
import type { HydrabaseTelemetryContext } from '../../../utils/log'
import type { Account } from '../../crypto/Account'
import type PeerManager from '../../PeerManager'
import type { UDP_Server } from '../udp/server'

import { logContext, warn, withTelemetryContext } from '../../../utils/log'
import { Trace } from '../../../utils/trace'
import { type Identity, verifyClient } from '../../protocol/HIP1_Identity'

export type WebSocketData = Identity & {
  conn?: WebSocketServerConnection
  isOpened: boolean
  telemetry?: HydrabaseTelemetryContext
  trace: Trace
}

export class WebSocketServerConnection implements Socket {
  get identity() {
    return {
      address: this.socket.data.address,
      bio: this.socket.data.bio,
      hostname: this.socket.data.hostname,
      userAgent: this.socket.data.userAgent,
      username: this.socket.data.username
    }
  }
  get isOpened() {
    return this.socket.data.isOpened
  }
  private closeHandlers: (() => void)[] = []
  private messageHandlers: ((message: string) => void)[] = []

  constructor(private readonly socket: Bun.ServerWebSocket<WebSocketData>) {}

  _handleClose() {
    for (const handler of this.closeHandlers) handler()
  }
  _handleMessage(message: string) {
    if (this.messageHandlers.length === 0) warn('DEVWARN:', `[RPC] Couldn't find message handler ${this.identity.hostname}`)
    this.messageHandlers.forEach(handler => {
      handler(message)
    })
  }
  public readonly close = () => this.socket.close()
  public onClose(handler: () => void) {
    this.closeHandlers.push(() => handler())
  }
  public onMessage(handler: (message: string) => void) {
    this.messageHandlers.push(handler)
  }  public readonly send = (message: string) => {
    if (this.isOpened) {this.socket.send(message)}
  }
}

export const websocketHandlers = (peerManager: PeerManager) => ({
  close(ws: Bun.ServerWebSocket<WebSocketData>) {
    withTelemetryContext(ws.data.telemetry ?? {}, () => {
      logContext('WS', () => {
        ws.data = { ...ws.data, isOpened: false }
        ws.data.conn?._handleClose()
      })
    })
  },
  data: {} as WebSocketData,
  message: (ws: Bun.ServerWebSocket<WebSocketData>, message: Buffer<ArrayBuffer> | string) => {
    withTelemetryContext(ws.data.telemetry ?? {}, () => {
      logContext('WS', () => {
        if (typeof message !== 'string') return
        ws.data.conn?._handleMessage(message)
      })
    })
  },
  open: (ws: Bun.ServerWebSocket<WebSocketData>) => {
    withTelemetryContext(ws.data.telemetry ?? {}, () => {
      logContext('WS', async () => {
        const conn = new WebSocketServerConnection(ws)
        ws.data = { ...ws.data, conn, isOpened: true }
        if (await peerManager.add(conn, ws.data.trace)) ws.data.trace.success()
      })
    })
  }
})

const VERIFY_TIMEOUT_MS = 15_000

// eslint-disable-next-line max-lines-per-function
export const handleConnection = async (
  server: Bun.Server<WebSocketData>,
  req: Request,
  ip: SocketAddress,
  node: Config['node'],
  apiKey: string,
  trace: Trace,
  peerManager: PeerManager,
  preferTransport: 'TCP' | 'UDP' = node.preferTransport,
  udpServer?: UDP_Server,
  account?: Account,
  identity?: Identity
): Promise<undefined | { address?: `0x${string}`, hostname?: `${string}:${number}`, res: [number, string] }> => {
  trace.step(`Client connecting from ${ip.address}:${ip.port}`)
  const headers = Object.fromEntries(req.headers.entries())
  const auth = 'x-api-key' in headers ? { apiKey: headers['x-api-key'] } : 'sec-websocket-protocol' in headers ? { apiKey: headers['sec-websocket-protocol'].replace('x-api-key-', '') } : { address: headers['x-address'] as `0x${string}`, bio: headers['x-bio'], hostname: headers['x-hostname'] as `${string}:${number}`, signature: headers['x-signature'] as string, userAgent: headers['x-useragent'] as string, username: headers['x-username'] as string, }
  const isApiKeyAuth = 'apiKey' in auth
  const hasRequiredHeaders = isApiKeyAuth || Boolean(auth.address && auth.hostname && auth.signature && auth.username)
  if (!hasRequiredHeaders) {
    trace.fail('Missing required handshake headers')
    warn('DEVWARN:', `Rejected connection from ${ip?.address}: missing handshake headers`)
    return { res: [400, 'Missing required handshake headers'] }
  }
  trace.step('Parsing auth headers')
  if (peerManager && !isApiKeyAuth && auth.address && peerManager.has(auth.address)) {
    trace.fail('Already connected')
    return { address: auth.address, hostname: auth.hostname, res: [409, 'Already connected'] }
  }
  const peer = await Promise.race([
    verifyClient(node, `${ip.address}:${ip.port}`, auth, apiKey, trace, preferTransport, udpServer, account, identity, ip),
    new Promise<[number, string]>(resolve => { setTimeout(() => { resolve([408, `Verification timed out after ${VERIFY_TIMEOUT_MS / 1000}s`]) }, VERIFY_TIMEOUT_MS) })
  ])
  if (Array.isArray(peer)) {
    trace.fail(peer[1])
    return { res: peer }
  }
  const { address, bio, hostname, userAgent, username } = peer
  const telemetryBase = {
    extras: {
      sentry_session_id: `ws-${trace.traceId}`,
      trace_id: trace.traceId,
    },
    tags: {
      auth_method: isApiKeyAuth ? 'api_key' : 'peer_signature',
      sentry_session_id: `ws-${trace.traceId}`,
      transport: 'ws',
    },
  }
  const telemetry: HydrabaseTelemetryContext = address === '0x0' ? telemetryBase : { ...telemetryBase, user: { id: address, username } }
  trace.step(`[WS] [SERVER] Authenticated connection to ${username} ${address} ${hostname} from ${ip?.address}`)
  if (server.upgrade(req, { data: { address, bio, hostname, isOpened: false, telemetry, trace, userAgent, username } })) return undefined
  trace.fail('Upgrade failed')
  return { address, hostname, res: [500, 'Upgrade failed'] }
}
