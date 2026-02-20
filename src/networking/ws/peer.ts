import { metadataManager } from "../..";
import { CONFIG } from "../../config";
import { Crypto } from "../../crypto";
import type { startDatabase } from "../../database";
import { MessageSchemas, type Announce, type Request, type Response } from "../../Messages";
import { tracks, albums, artists } from "../../schema";
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

  constructor(private readonly socket: WebSocketClient | WebSocketServerConnection, addPeer: (peer: WebSocketClient) => void, crypto: Crypto, serverPort: number, onClose: () => void, private readonly db: ReturnType<typeof startDatabase>) {
    // console.log('LOG:', `Creating peer ${socket.address} as ${socket instanceof WebSocketClient ? 'client' : 'server'}`)
    this.socket.onClose(onClose)
    this.socket.onMessage(async message => {
      const { nonce, ...result } = JSON.parse(message)
      const type = 'request' in result ? 'request' as const : 'response' in result ? 'response' as const : 'announce' in result ? 'announce' : null;
      if (type === 'request') {
        const request = MessageSchemas.request.safeParse(result.request).data
        if (!request) return console.warn('WARN:', 'Unexpected request', `- ${message}`)
        socket.send(JSON.stringify({ response: await metadataManager.handleRequest(request), nonce }))
      } else if (type === 'response') {
        const pending = this.pendingRequests.get(nonce)
        if (!pending) return console.warn('WARN:', `Unexpected response with nonce ${nonce}`, `- ${message}`)
        const response = MessageSchemas.response.safeParse(result.response)
        if (response.error) return console.warn('WARN:', 'Received bad response', response.error)
        else pending.resolve(response.data)
        this.pendingRequests.delete(nonce)
      } else if (type === 'announce') {
        console.log('LOG:', `Discovered peer through ${socket.address}`)
        const announce = MessageSchemas.announce.safeParse(result.announce).data
        if (announce) {
          const peer = await WebSocketClient.init(announce.address, crypto, `ws://${CONFIG.serverHostname}:${serverPort}`)
          if (peer) addPeer(peer)
        }
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
  set points(points: number) { // TODO: Use db to calculate trust
    this._points += points
    this._events++
  }

  public readonly searchTrack = async (query: string): Promise<Response<'track'>> => {
    const results = await this.sendRequest({ type: 'track', query })
    for (const result of results) this.db.insert(tracks).values({ ...result, artists: result.artists.join(','), external_urls: JSON.stringify(result.external_urls), address: this.socket.address }).onConflictDoNothing().run()
    return results;
  }
  public readonly searchArtist = async (query: string): Promise<Response<'artist'>> => {
    const results = await this.sendRequest({ type: 'artist', query })
    for (const result of results) this.db.insert(artists).values({ ...result, genres: result.genres.join(','), external_urls: JSON.stringify(result.external_urls), address: this.socket.address }).onConflictDoNothing().run()
    return results;
  }
  public readonly searchAlbum = async (query: string): Promise<Response<'album'>> => {
    const results = await this.sendRequest({ type: 'album', query })
    for (const result of results) this.db.insert(albums).values({ ...result, artists: result.artists.join(','), external_urls: JSON.stringify(result.external_urls), address: this.socket.address }).onConflictDoNothing().run()
    return results;
  }

  private async sendRequest<T extends Request['type']>(request: Request & { type: T }): Promise<Response<T>> {
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
  }

  public async announcePeer(announce: Announce) {
    if (this.socket.hostname === announce.address) return // console.log('LOG:', "Won't announce peer to itself")
    if (!this.socket.isOpened) return console.warn('WARN:', `Cannot send announce to unconnected peer ${this.socket.address}`)
    this.socket.send(JSON.stringify({ announce }))
  }
}
