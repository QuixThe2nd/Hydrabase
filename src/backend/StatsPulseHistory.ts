import type { StatsPulsePayload } from '../types/hydrabase'

const PULSE_HISTORY_WINDOW_MS = 6 * 60 * 60 * 1000

export class StatsPulseHistory {
  private readonly pulseHistory: StatsPulsePayload[] = []
  private readonly pulseThrottleMs: number

  constructor(pulseThrottleMs: number) {
    this.pulseThrottleMs = pulseThrottleMs
  }

  getHistory(): StatsPulsePayload[] {
    return [...this.pulseHistory]
  }

  recordPulse(peers: { connection?: { totalDL?: number, totalUL?: number } }[]): void {
    const pulse = peers.reduce((totals, peer) => ({
      totalDL: totals.totalDL + (peer.connection?.totalDL ?? 0),
      totalUL: totals.totalUL + (peer.connection?.totalUL ?? 0),
    }), { totalDL: 0, totalUL: 0 })
    const timestamp = new Date().toISOString()
    const statsPulse: StatsPulsePayload = {
      intervalMs: this.pulseThrottleMs,
      timestamp,
      totalDL: pulse.totalDL,
      totalUL: pulse.totalUL,
    }
    this.pulseHistory.push(statsPulse)
    this.trimPulseHistory()
  }

  private trimPulseHistory(): void {
    const cutoff = Date.now() - PULSE_HISTORY_WINDOW_MS
    const firstValidIndex = this.pulseHistory.findIndex(p => new Date(p.timestamp).getTime() >= cutoff)
    if (firstValidIndex > 0) this.pulseHistory.splice(0, firstValidIndex)
  }
}
