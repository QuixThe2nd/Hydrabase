import { readFileSync } from "fs";
import { join } from "path";

import type { Account } from "../../Crypto/Account";
import type Peers from '../../Peers';

import { CONFIG } from '../../config'
import { log, warn } from '../../log';
import { HIP3_CONN_Authentication } from '../../protocol/HIP3/authentication'
import { portForward } from '../upnp'

interface WebSocketData {
  address: `0x${string}`
  conn?: WebSocketServerConnection
  hostname: `ws://${string}`
  isOpened: boolean
}

const version = readFileSync(join(__dirname, "../../../VERSION"), "utf-8").trim();

export class WebSocketServerConnection {
  get isOpened() {
    return this.socket.data.isOpened
  }

  get peer() {
    return {
      address: this.socket.data.address,
      hostname: this.socket.data.hostname
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

await Bun.build({
  conditions: ["browser", "module", "import"],
  define: { __CDN_URL__: 'https://cdn.jsdelivr.net/npm/@iplookup/country/', VERSION: JSON.stringify(version) },
  entrypoints: ["./dashboard/src/main.tsx"],
  outdir: "./dist",
  target: "browser",
});

const getAddress = async (headers: Record<string, string>, peers: Peers): Promise<[number, string] | `0x${string}`> => {
  const address = HIP3_CONN_Authentication.verifyServerAddress(headers)
  if (address instanceof Response) return [address.status, await address.text()]
  if (peers.has(address) && address !== '0x0') return [409, 'Already connected']
  return address
}

const getHostname = async (headers: Record<string, string>, address: `0x${string}`): Promise<[number, string] | `ws://${string}`> => {
  const hostname = await HIP3_CONN_Authentication.verifyServerHostname(headers, address)
  if (hostname instanceof Response) return [hostname.status, await hostname.text()]
  return hostname
}

const handleConnection = async (server: Bun.Server<WebSocketData>, req: Request, peers: Peers): Promise<undefined | { address?: `0x${string}`, hostname?: `ws://${string}`; res: [number, string], }> => {
  log('LOG:', `[SERVER] Connecting to client`)
  const headers = Object.fromEntries(req.headers.entries())
  const address = await getAddress(headers, peers)
  if (Array.isArray(address)) return { res: address }
  const hostname = await getHostname(headers, address)
  if (Array.isArray(hostname)) return { address, res: hostname }
  return server.upgrade(req, { data: { address, hostname, isOpened: false } }) ? undefined : { address, hostname, res: [500, "Upgrade failed"] }
}

export const startServer = (account: Account, peers: Peers) => {
  portForward(CONFIG.serverPort, 'Hydrabase (TCP)', 'TCP');
  const server = Bun.serve({
    fetch: async (req, server) =>  {
      const url = new URL(req.url)
      if (req.headers.get("upgrade") !== "websocket") {
        if (url.pathname === "/src/main.tsx") return new Response(Bun.file(`./dist/main.js`))
        if (url.pathname === "/") return new Response(Bun.file(`./dashboard/index.html`))
        return new Response('Page not found', { status: 404 })
      }
      const response = await handleConnection(server, req, peers)
      if (response === undefined) return response
      const {address, hostname, res} = response
      warn('DEVWARN:', `[SERVER] Rejected connection with client ${address || hostname ? [address,hostname].join(' ') : 'N/A'} for reason: ${res[1]}`)
      return new Response(res[1], { status: res[0] })
    },
    hostname: CONFIG.listenAddress,
    port: CONFIG.serverPort,
    routes: { '/auth': () => HIP3_CONN_Authentication.proveServerAddress(account, CONFIG.serverPort) },
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
  log('LOG:', `[SERVER] Listening on port ${server.port}`)
}
