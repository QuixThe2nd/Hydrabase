import z from 'zod'

import type { Peer } from '../../peer'
import type Peers from '../../Peers'

import { log } from '../../../utils/log'

// TODO: reputation endorsement - vouch for peer and get rewarded/penalised based off their activity
export const AnnounceSchema = z.object({ hostname: z.string().transform(a => a as `${string}:${number}`) })
export type Announce = z.infer<typeof AnnounceSchema>

export class HIP3_Conn_Announce {
  constructor(private readonly peer: Peer, private readonly peers: Peers) {}

  async handleAnnounce(announce: Announce): Promise<void> {
    log(`[HIP3] Discovered server through ${this.peer.address}: ${announce.hostname}`)
    await this.peers.add(announce.hostname)
  }

  sendAnnounce(announce: Announce): void {
    if (this.peer.hostname === announce.hostname || this.peer.address === this.peers.account.address) return
    log(`[HIP3] Announcing server ${announce.hostname} ${this.peer.address}`)
    this.peer.send({ announce, nonce: this.peer.nonce++ })
  }
}
