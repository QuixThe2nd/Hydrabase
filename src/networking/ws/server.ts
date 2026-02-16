import { portForward } from '../upnp'

interface WebSocketData {
  isOpened: boolean
  conn?: WebSocketServerConnection
}

export class WebSocketServerConnection {
  public readonly hostname = String(Math.random()) // TODO: public keys
  private messageHandler?: (message: string) => void

  constructor(private readonly socket: Bun.ServerWebSocket<WebSocketData>) {}

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
    hostname: '0.0.0.0',
    fetch: (req, server) =>  server.upgrade(req, { data: { isOpened: false } }) ? undefined : new Response("Upgrade failed", { status: 500 }),
    websocket: {
      data: {} as WebSocketData,
      open: (ws) => {
        const conn = new WebSocketServerConnection(ws)
        addPeer(conn)
        ws.data = { isOpened: true, conn }
      },
      close(ws) {
        ws.data = { isOpened: false }
      },
      message: async (ws, message) => {
        if (typeof message !== 'string') return;
        ws.data.conn?._handleMessage(message)
      }
    }
  });
}
