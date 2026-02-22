import z from 'zod'
import { Crypto } from "../../Crypto"
import { HIP3_CONN_Authentication } from '../../protocol/HIP3/authentication'

export const AuthSchema = z.object({
  signature: z.string(),
  address: z.string().regex(/^0x/i, { message: "Address must start with 0x" }).transform((val) => val as `0x${string}`),
})

export default class WebSocketClient {
  private readonly socket: WebSocket
  private _isOpened = false
  private messageHandler?: (message: string) => void
  private closeHandler?: () => void

  private constructor(crypto: Crypto, public readonly address: `0x${string}`, public readonly hostname: `ws://${string}`, selfHostname: `ws://${string}`) {
    const headers = HIP3_CONN_Authentication.proveClientAddress(crypto, hostname, selfHostname)
    console.log('LOG:', `Connecting to peer ${hostname}`)
    this.socket = new WebSocket(hostname, { headers })
    this.socket.addEventListener('open', () => {
      console.log('LOG:', `Connected to peer ${hostname} ${address}`)
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

  static readonly init = async (crypto: Crypto, hostname: `ws://${string}`, selfHostname: `ws://${string}`) => {
    const address = await HIP3_CONN_Authentication.verifyClientAddress(hostname)
    if (!address) return false
    if (address === crypto.address) {
      console.warn('WARN:', `Not connecting to self`)
      return false
    }
    return new WebSocketClient(crypto, address, hostname, selfHostname)
  }

  public readonly close = () => this.socket.close()

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
