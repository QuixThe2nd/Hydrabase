import { CONFIG } from "../../config";
import { Crypto } from "../../utils/crypto";
import WebSocketClient from "./client";
import type { WebSocketServerConnection } from "./server";
import type Node from "../../Node";
import type { Repositories } from "../../db";
import { RequestManager } from "../../protocol/HIP2/requests";
import { type Announce, type Album, type Artist, type Track, MessageSchemas } from "../../protocol/Messages";
import { getCapabilities } from "../../protocol/HIP1/capabilities";
import type { MetadataPlugin } from "../../Metadata";
import type { Request, Response } from '../../protocol/HIP2/requests'

export class Peer {
  private readonly requests = new RequestManager()

  private readonly handlers = {
    request: async <T extends Request['type']>(request: Request & { type: T }, nonce: number) => {
      console.log('LOG:', `Received request from ${this.socket.address}`)
      this.send.response(await this.node.search(request.type, request.query) as Response<T>, nonce)
    },
    response: (response: Response, nonce: number) => {
      const resolved = this.requests.resolve(nonce, response)
      if (!resolved) console.warn('WARN:', `Unexpected response nonce ${nonce} from ${this.socket.address}`)
    },
    announce: async (announce: Announce) => {
      console.log('LOG:', `Discovered peer through ${this.socket.address}`)
      const peer = await WebSocketClient.init(announce.address, this.crypto, `ws://${CONFIG.serverHostname}:${this.serverPort}`)
      if (peer) this.addPeer(peer)
    }
  }

  private readonly send = {
    request: async <T extends Request['type']>(request: Request & { type: T }): Promise<Response<T>> => {
      if (!this.isOpened) {
        console.warn('WARN:', `Cannot send request to unconnected peer ${this.socket.address}`)
        return []
      }

      const { nonce, promise } = this.requests.register<T>()
      this.socket.send(JSON.stringify({ nonce, request }))
      return promise
    },
    response: async (response: Response, nonce: number) => this.socket.send(JSON.stringify({ response, nonce })),
    announce: (announce: Announce) => {
      if (this.socket.hostname === announce.address) return // console.log('LOG:', "Won't announce peer to itself")
      if (!this.isOpened) return console.warn('WARN:', `Cannot send announce to unconnected peer ${this.socket.address}`)
      this.socket.send(JSON.stringify({ announce }))
    }
  }

  public async search<T extends Request['type']>(type: T, query: string): Promise<Response<T>> {
    const results = await this.send.request({ type, query })
    for (const _result of results) {
      if (type === 'track') this.db.track.upsertFromPeer(_result as Track, this.socket.address)
      else if (type === 'album') this.db.album.upsertFromPeer(_result as Album, this.socket.address)
      else if (type === 'artist') this.db.artist.upsertFromPeer(_result as Artist, this.socket.address)
    }
    return results;
  }

  constructor(private readonly socket: WebSocketClient | WebSocketServerConnection, private readonly addPeer: (peer: WebSocketClient) => void, private readonly crypto: Crypto, private readonly serverPort: number, onClose: () => void, private readonly node: Node, private readonly db: Repositories, plugins: MetadataPlugin[]) {
    // console.log('LOG:', `Creating peer ${socket.address} as ${socket instanceof WebSocketClient ? 'client' : 'server'}`)
    this.socket.onClose(() => {
      this.requests.close()
      onClose()
    })
    this.socket.onMessage(async message => {
      const { nonce, ...result } = JSON.parse(message)

      const type = 'capability' in result ? 'capability'
        : 'request' in result ? 'request'
        : 'response' in result ? 'response'
        : 'announce' in result ? 'announce'
        : null;
      if (type === null) return console.warn('WARN:', 'Unexpected message', `- ${message}`)

      if (type === 'capability') {
        const ok = this.requests.receiveCapability(result.capability)
        if (!ok) {
          console.warn('WARN:', `Invalid capability from ${this.socket.address}, disconnecting`)
          this.socket.close()
        }
        return
      }

      if (!this.requests.handshakeComplete) {
        console.warn('WARN:', `Message from ${this.socket.address} before handshake, disconnecting`)
        this.socket.close()
        return
      }

      const data = MessageSchemas[type].safeParse(result[type]).data
      if (!data) return console.warn('WARN:', `Unexpected ${type}`, `- ${message}`)
      await this.handlers[type](data, nonce)
    })


    this.socket.send(JSON.stringify({
      capability: getCapabilities(plugins)  // plugins passed in — see step 5
    }))
    this.requests.handshake.catch(err => {
      console.warn('WARN:', `Disconnecting ${this.socket.address}: ${err.message}`)
      this.socket.close()
    })
  }

  get isOpened() {
    return this.socket.isOpened
  }

  public readonly announcePeer = (peer: Announce) => this.send.announce(peer)
}
