import z from 'zod'
import { Crypto, Signature } from "../../crypto"

const AuthSchema = z.object({
  signature: z.string(),
  address: z.string().regex(/^0x/i, { message: "Address must start with 0x" }).transform((val) => val as `0x${string}`),
})

export default class WebSocketClient {
  private readonly socket: WebSocket
  private _isOpened = false
  private isAuthenticated = false
  private messageHandler?: (message: string) => void

  private constructor(public readonly address: `0x${string}`, hostname: `ws://${string}`, crypto: Crypto) {
    // console.log('LOG:', `Connecting to peer ${hostname}`)
    this.socket = new WebSocket(hostname, {
      headers: {
        'x-signature': crypto.sign(hostname).toString(),
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

  static readonly init = async (hostname: `ws://${string}`, crypto: Crypto) => {
    const res = await fetch(hostname.replace('ws://', 'http://') + '/auth')
    const data = await res.text()
    const auth = AuthSchema.parse(JSON.parse(data))
    const signature = Signature.fromString(auth.signature)
    if (!signature.verify(hostname, auth.address)) { // TODO: change the signed message (both directions client/server) to prevent caching verifications
      console.warn('WARN:', 'Invalid authentication from server')
      return false
    }
    if (auth.address === crypto.address) {
      console.warn('WARN:', `Not connecting to self at ${hostname}`)
      return false
    }
    return new WebSocketClient(auth.address, hostname, crypto)
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
