import type { Crypto } from "../../crypto"
import SuperJSON from 'superjson';

export default class WebSocketClient {
  private readonly socket: WebSocket
  private _isOpened = false
  private messageHandler?: (message: string) => void
  public readonly address: `ws://${string}`

  constructor(hostname: `ws://${string}`, crypto: Crypto) {
    this.address = hostname
    // console.log('LOG:', `Connecting to peer ${hostname}`)
    this.socket = new WebSocket(hostname, {
      headers: {
        'x-signature': SuperJSON.stringify(crypto.sign(hostname)),
        'x-address': crypto.address
      }
    })
    this.socket.addEventListener('open', () => {
      // console.log('LOG:', `Connected to peer ${hostname}`)
      this._isOpened = true
    })
    this.socket.addEventListener('close', () => {
      // console.log('LOG:', `Connection closed with peer ${hostname}`)
      this._isOpened = false
    })
    this.socket.addEventListener('error', () => {
      // console.warn('WARN:', `Error thrown on connection with ${hostname}`, err)
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
