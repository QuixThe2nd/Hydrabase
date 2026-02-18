import { CONFIG } from '../../config'
import { Crypto, Signature } from '../../crypto'
import { portForward } from '../upnp'

interface WebSocketData {
  isOpened: boolean
  conn?: WebSocketServerConnection
  address: `0x${string}`
}

export class WebSocketServerConnection {
  private messageHandler?: (message: string) => void

  constructor(private readonly socket: Bun.ServerWebSocket<WebSocketData>) {}

  get address() {
    return this.socket.data.address
  }

  get isOpened() {
    return this.socket.data.isOpened
  }

  public readonly send = (message: string) => this.socket.send(message)

  public onMessage(handler: (message: string) => void) {
    this.messageHandler = handler;
  }
  _handleMessage(message: string) {
    this.messageHandler?.(message);
  }
}

export const startServer = (port: number, addPeer: (conn: WebSocketServerConnection) => void, crypto: Crypto) => {
  portForward(port, 'Hydrabase (TCP)', 'TCP');
  const server = Bun.serve({
    port,
    hostname: CONFIG.listenAddress,
    routes: {
      '/auth': () => {
        return new Response(JSON.stringify({
          signature: crypto.sign(`ws://${CONFIG.serverHostname}:${port}`).toString(),
          address: crypto.address
        }))
      }
    },
    fetch: (req, server) =>  {
      const headers = Object.fromEntries(req.headers.entries())
      const address = req.headers.get("x-address") as `0x${string}` ?? '0x0'

      type Auth =
        | { apiKey: string; signature?: undefined }
        | { apiKey?: undefined; signature: Signature }
        | { apiKey: string; signature: Signature }

      const apiKey = headers['x-api-key']
      const signature = headers['x-signature'] ? Signature.fromString(headers['x-signature']) : undefined

      const auth = apiKey !== undefined || signature !== undefined ? { apiKey, signature } as Auth : undefined

      if (!auth) return new Response('Missing authentication', { status: 400 })
      if (auth.apiKey && auth.apiKey !== CONFIG.apiKey) return new Response('Invalid API key', { status: 401 })
      else if (auth.signature && !auth.signature.verify(`ws://${CONFIG.serverHostname}:${port}`, address)) return new Response('Authentication failed', { status: 403 })
      return server.upgrade(req, { data: { isOpened: false, address: address ?? apiKey } }) ? undefined : new Response("Upgrade failed", { status: 500 })
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
      },
      message: async (ws, message) => {
        if (typeof message !== 'string') return;
        ws.data.conn?._handleMessage(message)
      }
    }
  })
  console.log(`Server listening at ${server.url}`)
}
