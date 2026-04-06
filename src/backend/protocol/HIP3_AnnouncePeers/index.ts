import z from 'zod'

import type { Peer } from '../../Peer'
import type PeerManager from '../../PeerManager'

import { Trace } from '../../../utils/trace'

// TODO: reputation endorsement - vouch for peer and get rewarded/penalised based off their activity
export const AnnounceSchema = z.object({ hostname: z.string().transform(a => a as `${string}:${number}`) })
export type Announce = z.infer<typeof AnnounceSchema>

export class HIP3_AnnouncePeers {
  constructor(private readonly peer: Peer, private readonly peers: PeerManager) {}

  private static normalizeHostname(hostname: `${string}:${number}`): string {
    // Normalize by splitting and rejoining to handle IP vs hostname differences
    return hostname.toLowerCase()
  }

  async handleAnnounce(announce: Announce): Promise<void> {
    if (this.isSelfHostname(announce.hostname) || announce.hostname === this.peer.hostname) return
    const trace = Trace.start(`[HIP3] Discovered server through ${this.peer.address}: ${announce.hostname}`)
    await this.peers.handleDiscoveredHostname(this.peer.address, announce.hostname, trace)
  }

  sendAnnounce(announce: Announce, trace: Trace): void {
    if (this.peer.hostname === announce.hostname || this.isSelfHostname(announce.hostname)) return
    trace.step(`[HIP3] Announcing peer ${announce.hostname} ${this.peer.address}`)
    this.peer.send({ announce: { hostname: announce.hostname }, nonce: this.peer.nonce++ }, trace)
    this.peers.recordPeerAnnouncedHostname(this.peer.address, announce.hostname)

    // Track topology during the initial peer-list exchange.
    const announcedPeer = this.findPeerByHostname(announce.hostname)
    if (announcedPeer) {
      this.peers.recordPeerAnnouncement(announcedPeer.address, this.peer.address)
    }
  }

  private findPeerByHostname(hostname: `${string}:${number}`): Peer | undefined {
    // Try exact match first
    for (const peer of this.peers.connectedPeers) {
      if (peer.hostname === hostname) return peer
    }
    // Try normalized match
    const normalized = HIP3_AnnouncePeers.normalizeHostname(hostname)
    for (const peer of this.peers.connectedPeers) {
      if (HIP3_AnnouncePeers.normalizeHostname(peer.hostname) === normalized) return peer
    }
    return undefined
  }

  private isSelfHostname(hostname: `${string}:${number}`): boolean {
    return hostname === `${this.peers.nodeConfig.hostname}:${this.peers.nodeConfig.port}` || hostname === `${this.peers.nodeConfig.ip}:${this.peers.nodeConfig.port}`
  }
}
