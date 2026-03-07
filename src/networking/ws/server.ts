import { readFileSync } from "fs";
import { join } from "path";

import type { Account } from "../../Crypto/Account";
import type Peers from '../../Peers';
import type { Connection } from "./client";
import type { Socket } from "./peer";

import { CONFIG } from '../../config'
import { log, warn } from '../../log';
import { HIP3_CONN_Authentication } from '../../protocol/HIP3/authentication'

type WebSocketData = Connection & {
  conn?: WebSocketServerConnection
  isOpened: boolean
}

export const version = readFileSync(join(__dirname, "../../../VERSION"), "utf-8").trim();

export class WebSocketServerConnection implements Socket {
  get isOpened() {
    return this.socket.data.isOpened
  }

  get peer(): Connection {
    return {
      address: this.socket.data.address,
      hostname: this.socket.data.hostname,
      userAgent: this.socket.data.userAgent,
      username: this.socket.data.username
    }
  }

  private closeHandlers: (() => void)[] = []

  private messageHandler?: (message: string) => void

  private openHandler?: () => void

  constructor(private readonly socket: Bun.ServerWebSocket<WebSocketData>) {}

  _handleClose() {
    for (const handler of this.closeHandlers) handler()
  }
  _handleMessage(message: string) {
    this.messageHandler?.(message);
  }

  _handleOpen() {
    this.openHandler?.();
  }
  public readonly close = () => this.socket.close()
  public onClose(handler: () => void) {
    this.closeHandlers.push(() => handler())
  }
  public onMessage(handler: (message: string) => void) {
    this.messageHandler = handler;
  }
  public onOpen(handler: () => void) {
    this.openHandler = handler;
  }
  public readonly send = (message: string) => {
    if (this.isOpened) {this.socket.send(message)}
  }
}

const handleConnection = async (server: Bun.Server<WebSocketData>, req: Request): Promise<undefined | { address?: `0x${string}`, hostname?: `ws://${string}`, res: [number, string] }> => {
  log(`[SERVER] Connecting to client`)
  const headers = Object.fromEntries(req.headers.entries())
  const peer = await HIP3_CONN_Authentication.verifyClientFromServer(headers)
  if (Array.isArray(peer)) {
    warn('DEVWARN:', `[SERVER] Failed to authenticate peer: ${peer[1]}`)
    return { res: peer }
  }
  const { address, hostname, userAgent, username } = peer
  log(`[SERVER] Authenticated ${address === '0x0' ? 'API' : 'client'} connection`)
  return server.upgrade(req, { data: { address, hostname, isOpened: false, userAgent, username } }) ? undefined : { address, hostname, res: [500, "Upgrade failed"] }
}

const buildWebUI = async () => {
  log('[SERVER] Building WebUI')
  await Bun.build({
    conditions: ["browser", "module", "import"],
    define: { __CDN_URL__: 'https://cdn.jsdelivr.net/npm/@iplookup/country/', VERSION: JSON.stringify(version) },
    entrypoints: ["./dashboard/src/main.tsx"],
    outdir: "./dist",
    target: "browser",
  })
}

export const startServer = async (account: Account, peers: Peers) => {
  await buildWebUI()
  const server = Bun.serve({
    fetch: async (req, server) =>  {
      const url = new URL(req.url)
      if (req.headers.get("upgrade") !== "websocket") {
        return url.pathname === "/" ? new Response(Bun.file(`./dashboard/index.html`))
             : url.pathname === "/src/main.tsx" ? new Response(Bun.file(`./dist/main.js`))
             : url.pathname === "/logo-white.svg" ? new Response(Bun.file(`./public/logo-white.svg`))
             : new Response('Page not found', { status: 404 })
      }
      const response = await handleConnection(server, req)
      if (response === undefined) return response
      const {address, hostname, res} = response
      warn('DEVWARN:', `[SERVER] Rejected connection with client ${address || hostname ? [address,hostname].join(' ') : 'N/A'} for reason: ${res[1]}`)
      return new Response(res[1], { status: res[0] })
    },
    hostname: CONFIG.listenAddress,
    port: CONFIG.port,
    routes: { '/auth': () => HIP3_CONN_Authentication.proveServerIdentity(account, CONFIG.port) },
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
  log(`[SERVER] Listening on port ${server.port}`)
}
