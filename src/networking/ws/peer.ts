import { metadataManager } from "../..";
import { matchMessage, matchRequest, type Request, type Response } from "../../Messages";
import type WebSocketClient from "./client";
import type { WebSocketServerConnection } from "./server";

type PendingRequest = {
  resolve: (value: Response) => void
  reject: (reason?: any) => void
}

export class Peer {
  private nonce = -1;
  private _points = 0; // Sum of past confidence confidence scores
  private _events = 0; // Number of events that triggered a point change
  private pendingRequests = new Map<number, PendingRequest>()

  constructor(private readonly socket: WebSocketClient | WebSocketServerConnection) {
    console.log('LOG:', `Created peer ${socket.hostname}`)
    this.socket.onMessage(async message => {
      const { nonce, result } = JSON.parse(message)
      const type = matchMessage(result)
      if (type === 'request') {
        const request = matchRequest(result)
        if (!request) return console.warn('WARN:', 'Unexpected request', `- ${message}`)
        socket.send(JSON.stringify({ response: await metadataManager.handleRequest(request), nonce }))
      } else if (type === 'response') {
        const pending = this.pendingRequests.get(nonce)
        if (!pending) return console.warn('WARN:', `Unexpected response with nonce ${nonce}`, `- ${message}`)
        pending.resolve(result)
        this.pendingRequests.delete(nonce)
      } else console.warn('WARN:', 'Unexpected message', `- ${message}`)
    })
  }

  get isOpened() {
    return this.socket.isOpened
  }

  get points() {
    return this._points
  }
  get events() {
    return this._events
  }
  set points(points: number) { // TODO: store on disk
    this._points += points
    this._events++
  }

  public async sendRequest(request: Request): Promise<Response> {
    if (!this.socket.isOpened) {
      console.warn('WARN:', `Not connected to peer ${this.socket.hostname}`)
      return {}
    }
    this.nonce++;

    return new Promise<Response>((resolve, reject) => {
      this.pendingRequests.set(this.nonce, { resolve, reject })
      this.socket.send(JSON.stringify({ nonce: this.nonce, request }))
    })
  }
}
