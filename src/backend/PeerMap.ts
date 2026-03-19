import type { Peer } from './peer'

import { formatUptime, stats, truncateAddress } from '../utils/log'

export class PeerMap extends Map<`0x${string}`, Peer> {
  get addresses(): `0x${string}`[] {
    return [...this.keys().filter(address => address !== '0x0')]
  }
  get count(): number {
    return this.addresses.length
  }
  private lastCount = 0

  override delete(key: `0x${string}`) {
    const result = super.delete(key)
    this.log({ old: key })
    return result
  }

  override set(key: `0x${string}`, value: Peer) {
    const result = super.set(key, value)
    this.log({ new: key })
    return result
  }

  private log(diff: { new: `0x${string}` } | { old: `0x${string}` }) {
    if (this.lastCount !== this.count) {
      stats(`${this.count} peer${this.count === 1 ? '' : 's'} connected:`)
      for (const peer of this.values()) {
        if (peer.address === '0x0') continue
        const transport = peer.type === 'UDP' ? 'UDP' : 'WS'
        const latency = !isNaN(peer.latency) && isFinite(peer.latency) ? `${Math.ceil(peer.latency)}ms` : '?'
        const uptime = formatUptime(peer.uptimeMs)
        if ('new' in diff && peer.address === diff.new) stats(`  + ${peer.username} (${truncateAddress(peer.address)}) on ${peer.userAgent} via ${transport} ${peer.hostname}`)
        else if ('old' in diff && peer.address === diff.old) stats(`  - ${peer.username} (${truncateAddress(peer.address)}) on ${peer.userAgent} via ${transport} ${peer.hostname}`)
        else stats(`  • ${peer.username} (${truncateAddress(peer.address)}) on ${peer.userAgent} via ${transport} ${peer.hostname} — ${latency} latency, up ${uptime}`)
      }
      this.lastCount = this.count
    }
  }
}
