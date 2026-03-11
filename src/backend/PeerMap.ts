import type { Peer } from "./peer"

import { stats } from "../utils/log"

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
    this.log()
    return result
  }

  override set(key: `0x${string}`, value: Peer) {
    const result = super.set(key, value)
    this.log()
    return result
  }

  private log() {
    if (this.lastCount !== this.count) {
      stats(`[PEERS] Connected to ${this.count} peer${this.count === 1 ? '' : 's'}`)
      this.lastCount = this.count
    } // TODO: encrypt private key
  }
}
