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
    console.log(`Connecting to peer ${hostname}`)
    this.socket = new WebSocket(hostname)
    this.socket.addEventListener('open', () => {
      console.log(`Connected to peer ${hostname}`)
      this.isOpen = true
    })
    this.socket.addEventListener('message', message => {
      const { nonce, response } = JSON.parse(message.data)
      const pending = this.pendingRequests.get(nonce)
      if (!pending) return console.warn("Received response for unknown request id:", nonce)
      pending.resolve(response)
      this.pendingRequests.delete(nonce)
    });
  }

  async sendRequest(request: Request): Promise<Response> {
    if (!this.isOpen) {
      console.warn("Not connected to peer", this.hostname)
      return {}
    }
    this.nonce++;

    return new Promise<Response>((resolve, reject) => {
      this.pendingRequests.set(this.nonce, { resolve, reject })
      this.socket.send(JSON.stringify({ nonce: this.nonce, request }))
    })
  }
}

// TODO: Prevent 2 nodes from connecting as both client/server to each other, wasteful
