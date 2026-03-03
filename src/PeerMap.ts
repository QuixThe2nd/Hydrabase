import type { Peer } from "./networking/ws/peer"

import { log } from "./log"

export class PeerMap extends Map<`0x${string}`, Peer> {
  private lastCount = 0
  get addresses(): `0x${string}`[] {
    return [...this.keys().filter(address => address !== '0x0')]
  }
  get count(): number {
    return this.addresses.length
  }

  private log() {
    if (this.lastCount !== this.count) {
      log(`[PEERS] Connected to ${this.count} peer${this.count === 1 ? '' : 's'}`)
      this.lastCount = this.count
    }
  }

  override delete(key: `0x${string}`) {
    const result = super.delete(key)
    this.log()
    return result
  }

  override set(key: `0x${string}`, value: Peer) {
    const result = super.set(key, value)
    this.log()
    return result
  }
}
