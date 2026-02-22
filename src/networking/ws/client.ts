import z from 'zod'
import { Crypto } from "../../utils/crypto"
import { prove, verify } from '../../protocol/HIP3/authentication'

export const AuthSchema = z.object({
  signature: z.string(),
  address: z.string().regex(/^0x/i, { message: "Address must start with 0x" }).transform((val) => val as `0x${string}`),
})

export default class WebSocketClient {
  private readonly socket: WebSocket
  private _isOpened = false
  private messageHandler?: (message: string) => void
  private closeHandler?: () => void

  private constructor(public readonly address: `0x${string}`, public readonly hostname: `ws://${string}`, crypto: Crypto, selfHostname: `ws://${string}`) {
    console.log('LOG:', `Connecting to peer ${hostname}`)
    this.socket = new WebSocket(hostname, { headers: prove.address.fromClient(crypto, hostname, selfHostname) })
    this.socket.addEventListener('open', () => {
      console.log('LOG:', `Connected to peer ${address} ${this.hostname}`)
      this._isOpened = true
    })
    this.socket.addEventListener('close', ev => {
      console.log('LOG:', `Connection closed with peer ${address}`, `- ${ev.reason}`)
      this._isOpened = false
      this.closeHandler?.()
    })
    this.socket.addEventListener('error', err => {
      console.warn('WARN:', `Connection failed with ${address}`, err)
      this._isOpened = false
      this.closeHandler?.()
    })
    this.socket.addEventListener('message', message => this.messageHandler?.(message.data));
  }

  static readonly init = async (hostname: `ws://${string}`, crypto: Crypto, selfHostname: `ws://${string}`) => {
    const address = await verify.address.fromClient(hostname)
    if (!address) return false
    if (address === crypto.address) {
      console.warn('WARN:', `Not connecting to self`)
      return false
    }
    return new WebSocketClient(address, hostname, crypto, selfHostname)
  }

  get isOpened() {
    return this._isOpened
  }

  public readonly send = (data: string) => this.socket.send(data)

  public onMessage(handler: (message: string) => void) {
    this.messageHandler = (msg) => handler(msg)
  }
  public onClose(handler: () => void) {
    this.closeHandler = () => handler()
  }
}
