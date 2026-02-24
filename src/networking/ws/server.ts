import { CONFIG } from '../../config'
import { HIP3_CONN_Authentication } from '../../protocol/HIP3/authentication'
import { Crypto } from '../../Crypto'
import { portForward } from '../upnp'
import { readFileSync } from "fs";
import { join } from "path";

interface WebSocketData {
  isOpened: boolean
  conn?: WebSocketServerConnection
  address: `0x${string}`
  hostname: `ws://${string}`
}

const version = readFileSync(join(__dirname, "../../../VERSION"), "utf-8").trim();

export class WebSocketServerConnection {
  private messageHandler?: (message: string) => void
  private closeHandler?: () => void
  private openHandler?: () => void

  constructor(private readonly socket: Bun.ServerWebSocket<WebSocketData>) {}

  get hostname() {
    return this.socket.data.hostname
  }

  get address() {
    return this.socket.data.address
  }

  get isOpened() {
    return this.socket.data.isOpened
  }

  public readonly send = (message: string) => {
    if (this.isOpened) this.socket.send(message)
  }
  public readonly close = () => this.socket.close()

  public onMessage(handler: (message: string) => void) {
    this.messageHandler = handler;
  }
  public onClose(handler: () => void) {
    this.closeHandler = handler;
  }
  public onOpen(handler: () => void) {
    this.openHandler = handler;
  }
  _handleClose() {
    this.closeHandler?.();
  }
  _handleOpen() {
    this.openHandler?.();
  }
  _handleMessage(message: string) {
    this.messageHandler?.(message);
  }
}

await Bun.build({
  entrypoints: ["./dashboard/src/main.tsx"],
  outdir: "./dist",
  define: { VERSION: JSON.stringify(version), __CDN_URL__: 'https://cdn.jsdelivr.net/npm/@iplookup/country/' },
  target: "browser",
  conditions: ["browser", "module", "import"],
});

export const startServer = (crypto: Crypto, port: number, addPeer: (conn: WebSocketServerConnection) => void) => {
  portForward(port, 'Hydrabase (TCP)', 'TCP');
  const server = Bun.serve({
    port,
    hostname: CONFIG.listenAddress,
    routes: { '/auth': () => HIP3_CONN_Authentication.proveServerAddress(crypto, port) },
    fetch: async (req, server) =>  {
      const url = new URL(req.url);
      if (url.pathname === "/src/main.tsx") return new Response(Bun.file(`./dist/main.js`));
      if (url.pathname === "/dashboard/") return new Response(Bun.file(`./dashboard/index.html`));

      const headers = Object.fromEntries(req.headers.entries())
      const address = await HIP3_CONN_Authentication.verifyServerAddress(headers, port)
      if (address instanceof Response) return address
      const hostname = await HIP3_CONN_Authentication.verifyServerHostname(headers, address)
      if (hostname instanceof Response) return hostname
      return server.upgrade(req, { data: { isOpened: false, address, hostname } }) ? undefined : new Response("Upgrade failed", { status: 500 })
    },
    websocket: {
      data: {} as WebSocketData,
      open: (ws) => {
        const conn = new WebSocketServerConnection(ws)
        addPeer(conn)
        ws.data = { ...ws.data, isOpened: true, conn }
        ws.data.conn?._handleOpen()
      },
      close(ws) {
        ws.data = { ...ws.data, isOpened: false }
        ws.data.conn?._handleClose()
      },
      message: async (ws, message) => {
        if (typeof message !== 'string') return;
        ws.data.conn?._handleMessage(message)
      }
    }
  })
  console.log('LOG:', `[SERVER] Listening on port ${server.port}`)
}
