import type { SocketAddress } from "bun";

import { readFileSync } from "fs";
import { join } from "path";

import type { Connection2, Socket } from "../../../types/hydrabase";
import type { Account } from "../../Crypto/Account";
import type Peers from '../../Peers';

import { debug, log, warn } from '../../../utils/log';
import { proveServer, verifyClient } from "../../protocol/HIP1/handshake";

export type WebSocketData = Connection2 & {
  conn?: WebSocketServerConnection
  isOpened: boolean
}

export const VERSION = readFileSync(join(__dirname, "../../../../VERSION"), "utf-8").trim();

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

const handleConnection = async (server: Bun.Server<WebSocketData>, req: Request, ip: null | SocketAddress, selfHostname: `${string}:${number}`): Promise<undefined | { address?: `0x${string}`, hostname?: `${string}:${number}`, res: [number, string] }> => {
  log(`[SERVER] Connecting to client ${ip?.address}`)
  const headers = Object.fromEntries(req.headers.entries())
  const peer = await verifyClient('x-api-key' in headers ? { apiKey: headers['x-api-key'] } : 'sec-websocket-protocol' in headers ? { apiKey: headers['sec-websocket-protocol'].replace('x-api-key-', '') } : { address: headers['x-address'] as `0x${string}`, hostname: headers['x-hostname'] as `${string}:${number}`, signature: headers['x-signature'] as string, userAgent: headers['x-userAgent'] as string, username: headers['x-username'] as string, }, selfHostname)
  if (Array.isArray(peer)) {
    warn('DEVWARN:', `[SERVER] Failed to authenticate peer: ${peer[1]}`)
    return { res: peer }
  }
  const { address, hostname, userAgent, username } = peer
  log(`[SERVER] Authenticated connection to ${username} ${address} ${hostname} from ${ip?.address}`)
  return server.upgrade(req, { data: { address, hostname, isOpened: false, userAgent, username } }) ? undefined : { address, hostname, res: [500, "Upgrade failed"] }
}

export const buildWebUI = async () => await Bun.build({
  conditions: ["browser", "module", "import"],
  define: { __CDN_URL__: 'https://cdn.jsdelivr.net/npm/@iplookup/country/', VERSION: JSON.stringify(VERSION) },
  entrypoints: ["./src/frontend/main.tsx"],
  outdir: "./dist",
  target: "browser",
})

export const startServer = (account: Account, peers: Peers, port: number, listenAddress: string, selfHostname: `${string}:${number}`) => {
  const server = Bun.serve({
    fetch: async (req, server) =>  {
      const url = new URL(req.url)
      if (req.headers.get("upgrade") !== "websocket") {
        return url.pathname === "/" ? new Response(Bun.file(`./src/frontend/index.html`))
             : url.pathname === "/src/main.tsx" ? new Response(Bun.file(`./dist/main.js`))
             : url.pathname === "/logo-white.svg" ? new Response(Bun.file(`./public/logo-white.svg`))
             : new Response('Page not found', { status: 404 })
      }
      const response = await handleConnection(server, req, server.requestIP(req), selfHostname)
      if (response === undefined) return response
      const {address, hostname, res} = response
      warn('DEVWARN:', `[SERVER] Rejected connection with client ${address || hostname ? [address,hostname].join(' ') : 'N/A'} for reason: ${res[1]}`)
      return new Response(res[1], { status: res[0] })
    },
    hostname: listenAddress,
    port,
    routes: { '/auth': () => new Response(JSON.stringify(proveServer(account, selfHostname))) },
    websocket: {
      close(ws) {
        ws.data = { ...ws.data, isOpened: false }
        ws.data.conn?._handleClose()
      },
      data: {} as WebSocketData,
      message: (ws, message) => {
        if (typeof message !== 'string') return
        ws.data.conn?._handleMessage(message)
      },
      open: ws => {
        const conn = new WebSocketServerConnection(ws)
        peers.add(conn)
        ws.data = { ...ws.data, conn, isOpened: true }
        ws.data.conn?._handleOpen()
      }
    }
  })
  debug(`[SERVER] Listening on port ${server.port}`)
  return server
}
