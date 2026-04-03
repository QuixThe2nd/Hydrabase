/* eslint-disable max-lines-per-function */
import { describe, expect, it } from 'bun:test'

import { StatsPulseHistory } from './StatsPulseHistory'

describe('StatsPulseHistory', () => {
  it('starts with empty history', () => {
    const history = new StatsPulseHistory(1_000)
    expect(history.getHistory()).toHaveLength(0)
  })

  it('records a pulse with correct totals', () => {
    const history = new StatsPulseHistory(5_000)
    history.recordPulse([
      { connection: { totalDL: 100, totalUL: 50 } },
      { connection: { totalDL: 200, totalUL: 75 } },
    ])
    const pulses = history.getHistory()
    expect(pulses).toHaveLength(1)
    expect(pulses[0]?.totalDL).toBe(300)
    expect(pulses[0]?.totalUL).toBe(125)
  })

  it('records the configured intervalMs', () => {
    const history = new StatsPulseHistory(10_000)
    history.recordPulse([])
    expect(history.getHistory()[0]?.intervalMs).toBe(10_000)
  })

  it('records a valid ISO timestamp', () => {
    const before = new Date()
    const history = new StatsPulseHistory(1_000)
    history.recordPulse([])
    const after = new Date()
    const pulseTime = new Date(history.getHistory()[0]?.timestamp ?? '')
    expect(pulseTime.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(pulseTime.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('accumulates multiple pulses', () => {
    const history = new StatsPulseHistory(1_000)
    history.recordPulse([{ connection: { totalDL: 10, totalUL: 5 } }])
    history.recordPulse([{ connection: { totalDL: 20, totalUL: 15 } }])
    history.recordPulse([{ connection: { totalDL: 30, totalUL: 25 } }])
    expect(history.getHistory()).toHaveLength(3)
  })

  it('handles peers with missing connection property', () => {
    const history = new StatsPulseHistory(1_000)
    history.recordPulse([{}, { connection: { totalDL: 50, totalUL: 25 } }])
    const [pulse] = history.getHistory()
    expect(pulse?.totalDL).toBe(50)
    expect(pulse?.totalUL).toBe(25)
  })

  it('handles peers with partial connection data (missing totalDL)', () => {
    const history = new StatsPulseHistory(1_000)
    history.recordPulse([{ connection: { totalUL: 10 } }])
    const [pulse] = history.getHistory()
    expect(pulse?.totalDL).toBe(0)
    expect(pulse?.totalUL).toBe(10)
  })

  it('handles peers with partial connection data (missing totalUL)', () => {
    const history = new StatsPulseHistory(1_000)
    history.recordPulse([{ connection: { totalDL: 42 } }])
    const [pulse] = history.getHistory()
    expect(pulse?.totalDL).toBe(42)
    expect(pulse?.totalUL).toBe(0)
  })

  it('records a zero-peer pulse as all zeros', () => {
    const history = new StatsPulseHistory(1_000)
    history.recordPulse([])
    const [pulse] = history.getHistory()
    expect(pulse?.totalDL).toBe(0)
    expect(pulse?.totalUL).toBe(0)
  })

  it('returns a copy of the history (immutable)', () => {
    const history = new StatsPulseHistory(1_000)
    history.recordPulse([{ connection: { totalDL: 10, totalUL: 5 } }])
    const copy = history.getHistory()
    copy.push({ intervalMs: 0, timestamp: '', totalDL: 0, totalUL: 0 })
    expect(history.getHistory()).toHaveLength(1)
  })
})
