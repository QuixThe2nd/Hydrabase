import type { Request, Response } from './Messages'

type PendingRequest = {
  resolve: (value: Response) => void
  reject: (reason?: any) => void
}

export default class Peer {
  private readonly socket: WebSocket
  private isOpen = false
  private pendingRequests = new Map<number, PendingRequest>()
  private nonce = -1;

  constructor(public readonly hostname: string) {
    this.socket = new WebSocket(hostname)
    this.socket.addEventListener('open', () => { this.isOpen = true })
    this.socket.addEventListener('message', message => {
      const { nonce, response } = JSON.parse(message.data)
      const pending = this.pendingRequests.get(nonce)
      if (!pending) return console.warn("Received response for unknown request id:", nonce)
      pending.resolve(response)
      this.pendingRequests.delete(nonce)
    });
  }

  sendRequest(request: Request): Promise<Response> {
    if (!this.isOpen) {
      console.warn("WebSocket not open yet")
      return Promise.reject("WebSocket not open")
    }
    this.nonce++;

    return new Promise<Response>((resolve, reject) => {
      this.pendingRequests.set(this.nonce, { resolve, reject })
      this.socket.send(JSON.stringify({ nonce: this.nonce, request }))
    })
  }
}
