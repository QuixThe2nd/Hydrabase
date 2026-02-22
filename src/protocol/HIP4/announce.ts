import z from 'zod'
import WebSocketClient from '../../networking/ws/client'
import type { Crypto } from '../../Crypto'
import type { Peer } from '../../networking/ws/peer'

export const AnnounceSchema = z.object({ hostname: z.string().startsWith('ws://').transform((val) => val as `ws://${string}`) })
export type Announce = z.infer<typeof AnnounceSchema>

export class HIP4_Conn_Announce {
  constructor(private readonly crypto: Crypto, private readonly peer: Peer, private readonly addPeer: (peer: WebSocketClient) => void) {}

  sendAnnounce(announce: Announce): void {
    if (this.peer.hostname === announce.hostname) return
    if (!this.peer.isOpened) return
    this.peer.socket.send(JSON.stringify(announce))
  }

  async handleAnnounce(announce: Announce): Promise<void> {
    console.log('LOG:', `[HIP4] Discovered peer through ${this.peer.address}: ${announce.hostname}`)
    const peer = await WebSocketClient.init(this.crypto, announce.hostname, this.peer.hostname)
    if (peer) this.addPeer(peer)
  }
}
