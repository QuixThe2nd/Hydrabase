import type z from "zod";
import { metadataManager } from "../..";
import { CONFIG } from "../../config";
import { Crypto } from "../../crypto";
import type { startDatabase } from "../../database";
import { MessageSchemas, type Announce, type MetadataMap, type Request, type Response } from "../../Messages";
import { schema } from "../../schema";
import WebSocketClient from "./client";
import type { WebSocketServerConnection } from "./server";

type PendingRequest = {
  resolve: <T extends Request['type']>(value: Response<T>) => void
  reject: (reason?: any) => void
}

export class Peer {
  private nonce = -1;
  private _points = 0; // Sum of past confidence confidence scores
  private _events = 0; // Number of events that triggered a point change
  private pendingRequests = new Map<number, PendingRequest>()

  private readonly handlers = {
    request: async (request: z.infer<typeof MessageSchemas.request>, nonce: number) => {
      console.log('LOG:', `Received request from ${this.socket.address}`)
      this.send.response(await metadataManager.handleRequest(request), nonce)
    },
    response: (response: z.infer<typeof MessageSchemas.response>, nonce: number, message: string) => {
      const pending = this.pendingRequests.get(nonce)
      if (!pending) return console.warn('WARN:', `Unexpected response with nonce ${nonce} from ${this.socket.address}`, `- ${message}`)
      else {
        console.log('LOG:', `Received response from ${this.socket.address}`)
        pending.resolve(response)
        this.pendingRequests.delete(nonce)
      }
    },
    announce: async (announce: z.infer<typeof MessageSchemas.announce>) => {
      console.log('LOG:', `Discovered peer through ${this.socket.address}`)
      const peer = await WebSocketClient.init(announce.address, this.crypto, `ws://${CONFIG.serverHostname}:${this.serverPort}`)
      if (peer) this.addPeer(peer)
    }
  }

  private readonly send = {
    request: async <T extends Request['type']>(request: Request & { type: T }): Promise<Response<T>> => {
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
          resolve: response => {
            clearTimeout(timeout)
            resolve(response as Response<T>)
          },
          reject: err => {
            clearTimeout(timeout)
            reject(err)
          }
        })

        this.socket.send(JSON.stringify({ nonce, request }))
      })
    },
    response: async (response: z.infer<typeof MessageSchemas.response>, nonce: number) => this.socket.send(JSON.stringify({ response, nonce })),
    announce: (announce: z.infer<typeof MessageSchemas.announce>) => {
      if (this.socket.hostname === announce.address) return console.log('LOG:', "Won't announce peer to itself")
      if (!this.socket.isOpened) return console.warn('WARN:', `Cannot send announce to unconnected peer ${this.socket.address}`)
      this.socket.send(JSON.stringify({ announce }))
    }
  }

  public async search<T extends Request['type']>(type: T, query: string): Promise<Response<T>> {
    const results = await this.send.request({ type, query })
    for (const _result of results) {
      if (type === 'track') {
        const result = _result as MetadataMap['track']
        this.db.insert(schema[type as 'track']).values({ ...result, artists: result.artists.join(','), external_urls: JSON.stringify(result.external_urls), address: this.socket.address }).onConflictDoNothing().run()
      } else if (type === 'album') {
        const result = _result as MetadataMap['album']
        this.db.insert(schema[type as 'album']).values({ ...result, artists: result.artists.join(','), external_urls: JSON.stringify(result.external_urls), address: this.socket.address }).onConflictDoNothing().run()
      } else if (type === 'artist') {
        const result = _result as MetadataMap['artist']
        this.db.insert(schema[type as 'artist']).values({ ...result, genres: result.genres.join(','), external_urls: JSON.stringify(result.external_urls), address: this.socket.address }).onConflictDoNothing().run()
      }
    }
    return results;
  }

  constructor(private readonly socket: WebSocketClient | WebSocketServerConnection, private readonly addPeer: (peer: WebSocketClient) => void, private readonly crypto: Crypto, private readonly serverPort: number, onClose: () => void, private readonly db: ReturnType<typeof startDatabase>) {
    // console.log('LOG:', `Creating peer ${socket.address} as ${socket instanceof WebSocketClient ? 'client' : 'server'}`)
    this.socket.onClose(onClose)
    this.socket.onMessage(async message => {
      const { nonce, ...result } = JSON.parse(message)

      const type = 'request' in result ? 'request' as const : 'response' in result ? 'response' as const : 'announce' in result ? 'announce' : null;
      if (type === null) return console.warn('WARN:', 'Unexpected message', `- ${message}`)

      const data = MessageSchemas[type].safeParse(result[type]).data
      if (!data) return console.warn('WARN:', `Unexpected ${type}`, `- ${message}`)

      await this.handlers[type](data, nonce, message)
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
  set points(points: number) { // TODO: Use db to calculate trust
    this._points += points
    this._events++
  }

  public readonly announcePeer = (peer: Announce) => this.send.announce(peer)
}
