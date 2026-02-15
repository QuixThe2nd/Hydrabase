export default class WebSocketClient {
  private readonly socket: WebSocket
  private _isOpened = false
  private messageHandler?: (message: string) => void

  constructor(public readonly hostname: string) {
    console.log(`Connecting to peer ${hostname}`)
    this.socket = new WebSocket(hostname)
    this.socket.addEventListener('open', () => {
      console.log(`Connected to peer ${hostname}`)
      this._isOpened = true
    })
    this.socket.addEventListener('error', () => {
      console.warn('Connection failed', hostname)
      this._isOpened = false
    })
    this.socket.addEventListener('message', message => this.messageHandler?.(message.data));
  }

  get isOpened() {
    return this._isOpened
  }

  public readonly send = (data: string) => this.socket.send(data)

  public onMessage(handler: (message: string) => void) {
    this.messageHandler = handler;
  }
}

// TODO: Prevent 2 nodes from connecting as both client/server to each other, wasteful
