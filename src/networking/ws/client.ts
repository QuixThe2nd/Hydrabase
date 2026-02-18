import z from 'zod'
import SuperJSON from 'superjson'
import { Crypto, Signature } from "../../crypto"
import { CONFIG } from '../../config'

const AuthSchema = z.object({
  'signature': z.string(),
  'address': z.string()
})

export default class WebSocketClient {
  private readonly socket: WebSocket
  private _isOpened = false
  private isAuthenticated = false
  private messageHandler?: (message: string) => void
  public readonly address: `0x${string}`

  constructor(hostname: `ws://${string}`, crypto: Crypto) {
    fetch(hostname.replace('ws://', 'http://')).then(res => res.text()).then(data => {
      const auth = AuthSchema.parse(SuperJSON.parse(data))
      const signature = Signature.fromString(auth.signature)
      if (!signature.verify(`ws://${CONFIG.serverHostname}`, auth.address)) return console.warn('WARN:', 'Invalid authentication from server')
      this.address = auth.address
      this.isAuthenticated = true
    })
    // console.log('LOG:', `Connecting to peer ${hostname}`)
    this.socket = new WebSocket(hostname, {
      headers: {
        'x-signature': SuperJSON.stringify(crypto.sign(hostname)),
        'x-address': crypto.address
      }
    })
    this.socket.addEventListener('open', () => {
      console.log('LOG:', `Connected to peer ${hostname}`)
      this._isOpened = true
    })
    this.socket.addEventListener('close', () => {
      console.log('LOG:', `Connection closed with peer ${hostname}`)
      this._isOpened = false
    })
    this.socket.addEventListener('error', err => {
      console.warn('WARN:', `Error thrown on connection with ${hostname}`, err)
      this._isOpened = false
    })
    this.socket.addEventListener('message', message => this.messageHandler?.(message.data));
  }

  get isOpened() {
    return this.isAuthenticated && this._isOpened
  }

  public readonly send = (data: string) => {
    if (this.isAuthenticated) this.socket.send(data)
  }

  public onMessage(handler: (message: string) => void) {
    this.messageHandler = (msg) => {
      if (this.isAuthenticated) handler(msg);
    }
  }
}
