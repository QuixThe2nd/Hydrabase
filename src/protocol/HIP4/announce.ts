import z from 'zod'

import type { Peer } from '../../networking/ws/peer'
import type Peers from '../../Peers'

import { log } from '../../log'
import WebSocketClient from '../../networking/ws/client'

// TODO: reputation endorsement - vouch for peer and get rewarded/penalised based off their activity
export const AnnounceSchema = z.object({ hostname: z.string() })
export type Announce = z.infer<typeof AnnounceSchema>

export class HIP4_Conn_Announce {
  constructor(private readonly peer: Peer, private readonly peers: Peers) {}

  async handleAnnounce(announce: Announce): Promise<void> {
    log(`[HIP4] Discovered server through ${this.peer.address}: ${announce.hostname}`)
    const peer = await WebSocketClient.init(this.peers, announce.hostname)
    if (peer) this.peers.add(peer)
  }

  sendAnnounce(announce: Announce, address: `0x${string}`): void {
    if (this.peer.hostname === announce.hostname || this.peer.address === address) return
    log(`[HIP4] Announcing server ${announce.hostname} ${address}`)
    this.peer.send({ announce, nonce: this.peer.nonce++ })
  }
}
