import SuperJSON from 'superjson'
import { CONFIG } from '../../config'
import { Crypto, SignatureSchema } from '../../crypto'
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

export const startServer = (port: number, addPeer: (conn: WebSocketServerConnection) => void) => {
  portForward(port, 'Hydrabase (TCP)', 'TCP');
  Bun.serve({
    port,
    hostname: CONFIG.listenAddress,
    fetch: (req, server) =>  {
      const signature = SignatureSchema.parse(SuperJSON.parse(req.headers.get("x-signature") ?? ''))
      const address = (req.headers.get("x-address") ?? '0x0') as `0x${string}`
      const valid = Crypto.verify(`ws://${CONFIG.serverHostname}:${port}`, signature, address)
      if (!valid) {
        return new Response('Authentication failed', { status: 401 })
      }
      return server.upgrade(req, { data: { isOpened: false, address } }) ? undefined : new Response("Upgrade failed", { status: 500 })
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
}
