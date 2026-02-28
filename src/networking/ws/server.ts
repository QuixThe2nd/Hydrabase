import { CONFIG } from '../../config'
import { HIP3_CONN_Authentication } from '../../protocol/HIP3/authentication'
import { Crypto } from '../../Crypto'
import { portForward } from '../upnp'
import { readFileSync } from "fs";
import { join } from "path";
import type Peers from '../../Peers';

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

export const startServer = (crypto: Crypto, port: number, peers: Peers) => {
  portForward(port, 'Hydrabase (TCP)', 'TCP');
  const server = Bun.serve({
    port,
    hostname: CONFIG.listenAddress,
    routes: { '/auth': () => HIP3_CONN_Authentication.proveServerAddress(crypto, port) },
    fetch: async (req, server) =>  {
      let address: `0x${string}` | undefined
      let hostname: `ws://${string}` | undefined
      const res = async () => {
        const url = new URL(req.url);
        if (url.pathname === "/src/main.tsx") return new Response(Bun.file(`./dist/main.js`));
        if (url.pathname === "/dashboard/") return new Response(Bun.file(`./dashboard/index.html`));

        console.log('LOG:', `[SERVER] Connecting to client`)
        const headers = Object.fromEntries(req.headers.entries())
        const _address = await HIP3_CONN_Authentication.verifyServerAddress(headers, port)
        if (_address instanceof Response) return _address
        address = _address
        const _hostname = await HIP3_CONN_Authentication.verifyServerHostname(headers, address)
        if (_hostname instanceof Response) return _hostname
        hostname = _hostname
        if (peers.has(address)) return new Response('Already connected', { status: 409 })
        const upgrade = server.upgrade(req, { data: { isOpened: false, address, hostname } })
        return upgrade ? undefined : new Response("Upgrade failed", { status: 500 })
      }
      const response = await res()
      if (response instanceof Response) console.warn('WARN:', `[SERVER] Rejected connection with client ${[address,hostname].join(' ') ?? 'N/A'} for reason: ${await response.text()}`)
      return response
    },
    websocket: {
      data: {} as WebSocketData,
      open: (ws) => {
        const conn = new WebSocketServerConnection(ws)
        peers.add(conn)
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
