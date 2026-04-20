import z from 'zod'

import type { Peer } from '../../Peer'
import type PeerManager from '../../PeerManager'

import { Trace } from '../../../utils/trace'

export const AnnounceSchema = z.object({ hostname: z.string().transform(a => a as `${string}:${number}`) })
export type Announce = z.infer<typeof AnnounceSchema>

export class HIP3_AnnouncePeers {
  constructor(private readonly peer: Peer, private readonly peers: PeerManager) {}

  async handleAnnounce(announce: Announce): Promise<void> {
    if (this.isSelfHostname(announce.hostname) || announce.hostname === this.peer.hostname) return
    const trace = Trace.start(`[HIP3] Discovered server through ${this.peer.address}: ${announce.hostname}`)
    await this.peers.handleDiscoveredHostname(this.peer.address, announce.hostname, trace)
  }

  sendAnnounce(announce: Announce, trace: Trace): void {
    if (this.peer.hostname === announce.hostname || this.isSelfHostname(announce.hostname)) return
    trace.step(`[HIP3] Announcing peer ${announce.hostname} ${this.peer.address}`)
    this.peer.send({ announce: { hostname: announce.hostname }, nonce: this.peer.nonce++ }, trace)
  }

  private isSelfHostname(hostname: `${string}:${number}`): boolean {
    return hostname === `${this.peers.nodeConfig.hostname}:${this.peers.nodeConfig.port}` || hostname === `${this.peers.nodeConfig.ip}:${this.peers.nodeConfig.port}`
  }
}
