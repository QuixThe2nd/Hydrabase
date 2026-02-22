import { HIP1_Conn_Capabilities } from "../../protocol/HIP1/capabilities";
import { RequestManager, type Album, type Artist, type Request, type Response, type Track } from "../../RequestManager";
import { HIP4_Conn_Announce, type Announce } from "../../protocol/HIP4/announce";
import { Crypto } from "../../Crypto";
import WebSocketClient from "./client";
import type { WebSocketServerConnection } from "./server";
import type Node from "../../Node";
import type { Repositories } from "../../db";
import type { MetadataPlugin } from "../../Metadata";
import { HIP2_Conn_Message } from "../../protocol/HIP2/message";

export class Peer {
  private readonly HIP1_Conn_Capabilities: HIP1_Conn_Capabilities
  private readonly requestManager: RequestManager
  private readonly HIP4_Conn_Announce: HIP4_Conn_Announce

  constructor(private readonly socket: WebSocketClient | WebSocketServerConnection, addPeer: (peer: WebSocketClient) => void, crypto: Crypto, onClose: () => void, private readonly node: Node, private readonly db: Repositories, public readonly plugins: MetadataPlugin[]) {
    this.HIP1_Conn_Capabilities = new HIP1_Conn_Capabilities(this)
    this.requestManager = new RequestManager()
    this.HIP4_Conn_Announce = new HIP4_Conn_Announce(crypto, this, addPeer)
    // console.log('LOG:', `Creating peer ${socket.address} as ${socket instanceof WebSocketClient ? 'client' : 'server'}`)
    this.socket.onClose(() => {
      this.requestManager.close()
      onClose()
    })
    this.socket.onMessage(async message => {
      const { nonce, ...result } = JSON.parse(message)

      const type = HIP2_Conn_Message.identifyType(result)
      if (type === null) return console.warn('WARN:', 'Unexpected message', `- ${message}`)

      if (type === 'capability') {
        const ok = this.requestManager.receiveCapability(result.capability)
        if (!ok) {
          console.warn('WARN:', `Invalid capability from ${this.socket.address}, disconnecting`)
          this.socket.close()
        }
        return
      }

      if (!this.requestManager.handshakeComplete) {
        console.warn('WARN:', `Message from ${this.socket.address} before handshake, disconnecting`)
        this.socket.close()
        return
      }

      const data = HIP2_Conn_Message.parse(type, result)
      if (!data) return console.warn('WARN:', `Unexpected ${type}`, `- ${message}`)
      await this.handlers[type](data, nonce)
    })

    this.socket.send(JSON.stringify({ capability: this.HIP1_Conn_Capabilities.capabilities }))
    this.requestManager.handshake.catch(err => {
      console.warn('WARN:', `Disconnecting ${this.socket.address}: ${err.message}`)
      this.socket.close()
    })
  }

  get isOpened() {
    return this.socket.isOpened
  }

  get address() {
    return this.socket.address
  }

  get hostname() {
    return this.socket.hostname
  }

  public readonly announcePeer = (announce: Announce) => this.HIP4_Conn_Announce.sendAnnounce(announce)

  private readonly handlers = { // TODO: Move to HIP5
    request: async <T extends Request['type']>(request: Request & { type: T }, nonce: number) => {
      console.log('LOG:', `Received request from ${this.socket.address}`)
      this.send.response(await this.node.search(request.type, request.query) as Response<T>, nonce)
    },
    response: (response: Response, nonce: number) => {
      const resolved = this.requestManager.resolve(nonce, response)
      if (!resolved) console.warn('WARN:', `Unexpected response nonce ${nonce} from ${this.socket.address}`)
    },
    announce: (announce: Announce) => this.HIP4_Conn_Announce.handleAnnounce(announce)
  }

  private readonly send = { // TODO: Move to HIP5
    request: async <T extends Request['type']>(request: Request & { type: T }): Promise<Response<T>> => {
      if (!this.isOpened) {
        console.warn('WARN:', `Cannot send request to unconnected peer ${this.socket.address}`)
        return []
      }

      const { nonce, promise } = this.requestManager.register<T>()
      this.socket.send(JSON.stringify({ nonce, request }))
      return promise
    },
    response: async (response: Response, nonce: number) => this.socket.send(JSON.stringify({ response, nonce }))
  }

  public async search<T extends Request['type']>(type: T, query: string): Promise<Response<T>> { // TODO: Move to HIP5
    const results = await this.send.request({ type, query })
    for (const _result of results) {
      if (type === 'track') this.db.track.upsertFromPeer(_result as Track, this.socket.address)
      else if (type === 'album') this.db.album.upsertFromPeer(_result as Album, this.socket.address)
      else if (type === 'artist') this.db.artist.upsertFromPeer(_result as Artist, this.socket.address)
    }
    return results;
  }
}
