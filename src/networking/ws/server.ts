import { CONFIG } from '../../config'
import { HIP3_CONN_Authentication } from '../../protocol/HIP3/authentication'
import { Crypto } from '../../Crypto'
import { portForward } from '../upnp'

interface WebSocketData {
  isOpened: boolean
  conn?: WebSocketServerConnection
  address: `0x${string}`
  hostname: `ws://${string}`
}

export class WebSocketServerConnection {
  private messageHandler?: (message: string) => void
  private closeHandler?: () => void

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
  _handleMessage(message: string) {
    this.messageHandler?.(message);
  }
  _handleClose() {
    this.closeHandler?.();
  }
}

export const startServer = (crypto: Crypto, port: number, addPeer: (conn: WebSocketServerConnection) => void) => {
  portForward(port, 'Hydrabase (TCP)', 'TCP');
  const server = Bun.serve({
    port,
    hostname: CONFIG.listenAddress,
    routes: { '/auth': () => HIP3_CONN_Authentication.proveServerAddress(crypto, port) },
    fetch: async (req, server) =>  {
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
  console.log('LOG:', `Server listening at ${server.url}`)
}
