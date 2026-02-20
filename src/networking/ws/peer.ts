import { metadataManager } from "../..";
import { CONFIG } from "../../config";
import { Crypto } from "../../crypto";
import { MessageSchemas, type Announce, type Request, type Response } from "../../Messages";
import WebSocketClient from "./client";
import type { WebSocketServerConnection } from "./server";

type PendingRequest = {
  resolve: (value: any) => void
  reject: (reason?: any) => void
}

export class Peer {
  private nonce = -1;
  private _points = 0; // Sum of past confidence confidence scores
  private _events = 0; // Number of events that triggered a point change
  private pendingRequests = new Map<number, PendingRequest>()

  constructor(private readonly socket: WebSocketClient | WebSocketServerConnection, addPeer: (peer: WebSocketClient) => void, crypto: Crypto, serverPort: number, onClose: () => void) {
    // console.log('LOG:', `Creating peer ${socket.address} as ${socket instanceof WebSocketClient ? 'client' : 'server'}`)
    this.socket.onClose(onClose)
    this.socket.onMessage(async message => {
      const { nonce, ...result } = JSON.parse(message)
      const type = 'request' in result ? 'request' as const : 'response' in result ? 'response' as const : 'announce' in result ? 'announce' : null;
      if (type === 'request') {
        const request = MessageSchemas.request.parse(result.request)
        if (!request) return console.warn('WARN:', 'Unexpected request', `- ${message}`)
        socket.send(JSON.stringify({ response: await metadataManager.handleRequest(request), nonce }))
      } else if (type === 'response') {
        const pending = this.pendingRequests.get(nonce)
        if (!pending) return console.warn('WARN:', `Unexpected response with nonce ${nonce}`, `- ${message}`)
        pending.resolve(MessageSchemas.response.parse(result.response))
        this.pendingRequests.delete(nonce)
      } else if (type === 'announce') {
        console.log('LOG:', `Discovered peer through ${socket.address}`)
        const peer = await WebSocketClient.init(MessageSchemas.announce.parse(result.announce).address, crypto, `ws://${CONFIG.serverHostname}:${serverPort}`)
        if (peer) addPeer(peer)
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

  public async sendRequest<T extends Request['type']>(request: Request & { type: T }): Promise<Response<T>> {
    if (!this.socket.isOpened) {
      console.warn('WARN:', `Cannot send request to unconnected peer ${this.socket.address}`)
      return []
    }

    const nonce = ++this.nonce

    return new Promise<Response<T>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(nonce)
        reject(new Error(`Request ${nonce} timed out after 5s`))
      }, 15_000)

      this.pendingRequests.set(nonce, {
        resolve: (response: Response<T>) => {
          clearTimeout(timeout)
          resolve(response)
        },
        reject: (err: unknown) => {
          clearTimeout(timeout)
          reject(err)
        }
      })

      this.socket.send(JSON.stringify({ nonce, request }))
    })
  }

  public async announcePeer(announce: Announce) {
    if (this.socket.hostname === announce.address) return // console.log('LOG:', "Won't announce peer to itself")
    if (!this.socket.isOpened) return console.warn('WARN:', `Cannot send announce to unconnected peer ${this.socket.address}`)
    this.socket.send(JSON.stringify({ announce }))
  }
}
