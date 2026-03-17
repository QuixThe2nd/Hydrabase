import z from 'zod'

import type { Peer } from '../../peer'
import type PeerManager from '../../PeerManager'

import { Trace } from '../../../utils/trace'

// TODO: reputation endorsement - vouch for peer and get rewarded/penalised based off their activity
export const AnnounceSchema = z.object({ hostname: z.string().transform(a => a as `${string}:${number}`) })
export type Announce = z.infer<typeof AnnounceSchema>

export class HIP3_Conn_Announce {
  constructor(private readonly peer: Peer, private readonly peers: PeerManager) {}

  async handleAnnounce(announce: Announce): Promise<void> {
    const trace = Trace.start(`[HIP3] Discovered server through ${this.peer.address}: ${announce.hostname}`)
    await this.peers.add(announce.hostname, trace)
  }

  sendAnnounce(announce: Announce, trace: Trace): void {
    if (this.peer.hostname === announce.hostname || this.peer.address === this.peers.account.address) return
    trace.step(`[HIP3] Announcing server ${announce.hostname} ${this.peer.address}`)
    this.peer.send({ announce: { hostname: announce.hostname }, nonce: this.peer.nonce++ }, trace)
  }
}
