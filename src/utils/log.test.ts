/// <reference types="bun" />
/* eslint-disable max-lines-per-function */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { captureException, exceptionFromContext, formatBytes, formatUptime, type HydrabaseGlobal, type HydrabaseTelemetryContext, logContext, truncateAddress, withTelemetryContext } from './log'

interface CapturedEvent {
  exception: unknown
  telemetry?: HydrabaseTelemetryContext | undefined
}

const testError = new Error('telemetry test')
let capturedEvents: CapturedEvent[] = []

beforeEach(() => {
  capturedEvents = []
  ;(globalThis as HydrabaseGlobal).__hydrabaseCaptureException__ = (exception, telemetry) => {
    capturedEvents.push({ exception, telemetry })
  }
})

afterEach(() => {
  delete (globalThis as HydrabaseGlobal).__hydrabaseCaptureException__
})

describe('telemetry context', () => {
  it('forwards explicit telemetry context on captureException', () => {
    captureException(testError, {
      tags: { transport: 'ws' },
      user: { id: '0xabc' },
    })

    expect(capturedEvents).toHaveLength(1)
    expect(capturedEvents[0]?.telemetry?.user?.id).toBe('0xabc')
    expect(capturedEvents[0]?.telemetry?.tags?.['transport']).toBe('ws')
  })

  it('propagates telemetry context through AsyncLocalStorage', async () => {
    await withTelemetryContext({
      tags: { session: 'ws-1' },
      user: { id: '0x1234' },
    }, async () => {
      await Promise.resolve()
      captureException(testError)
    })

    expect(capturedEvents).toHaveLength(1)
    expect(capturedEvents[0]?.telemetry?.user?.id).toBe('0x1234')
    expect(capturedEvents[0]?.telemetry?.tags?.['session']).toBe('ws-1')
  })

  it('merges explicit telemetry with ambient telemetry and prefers explicit user', () => {
    withTelemetryContext({
      extras: { trace_id: 'trace-a' },
      tags: { transport: 'ws' },
      user: { id: '0xambient' },
    }, () => {
      captureException(testError, {
        extras: { sentry_session_id: 'ws-trace-a' },
        tags: { auth_method: 'peer_signature' },
        user: { id: '0xexplicit' },
      })
    })

    expect(capturedEvents).toHaveLength(1)
    expect(capturedEvents[0]?.telemetry?.user?.id).toBe('0xexplicit')
    expect(capturedEvents[0]?.telemetry?.tags?.['transport']).toBe('ws')
    expect(capturedEvents[0]?.telemetry?.tags?.['auth_method']).toBe('peer_signature')
    expect(capturedEvents[0]?.telemetry?.extras?.['trace_id']).toBe('trace-a')
    expect(capturedEvents[0]?.telemetry?.extras?.['sentry_session_id']).toBe('ws-trace-a')
  })

  it('does not call captureException if handler is not set', () => {
    delete (globalThis as HydrabaseGlobal).__hydrabaseCaptureException__
    expect(() => captureException(testError)).not.toThrow()
  })

  it('does not forward telemetry when no context and no explicit telemetry', () => {
    captureException(testError)
    expect(capturedEvents).toHaveLength(1)
    expect(capturedEvents[0]?.telemetry).toBeUndefined()
  })
})

describe('logContext', () => {
  it('runs callback and returns its value', () => {
    const result = logContext('test-ctx', () => 42)
    expect(result).toBe(42)
  })

  it('is re-entrant safe (same label does not duplicate context)', () => {
    let innerResult: unknown
    logContext('ctx', () => {
      logContext('ctx', () => {
        innerResult = 'ran'
      })
    })
    expect(innerResult).toBe('ran')
  })
})

describe('formatBytes', () => {
  it('formats bytes below 1 KB', () => {
    expect(formatBytes(0)).toBe('0B')
    expect(formatBytes(512)).toBe('512B')
    expect(formatBytes(1023)).toBe('1023B')
  })

  it('formats bytes in KB range', () => {
    expect(formatBytes(1024)).toBe('1.0KB')
    expect(formatBytes(2048)).toBe('2.0KB')
    expect(formatBytes(1536)).toBe('1.5KB')
  })

  it('formats bytes in MB range', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0MB')
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5MB')
  })

  it('formats bytes in GB range', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0GB')
    expect(formatBytes(1024 * 1024 * 1024 * 3)).toBe('3.0GB')
  })
})

describe('formatUptime', () => {
  it('formats seconds below 60', () => {
    expect(formatUptime(0)).toBe('0s')
    expect(formatUptime(1000)).toBe('1s')
    expect(formatUptime(59_000)).toBe('59s')
  })

  it('formats minutes (exactly 60 seconds)', () => {
    expect(formatUptime(60_000)).toBe('1m')
  })

  it('formats minutes below 1 hour', () => {
    expect(formatUptime(90_000)).toBe('1m')
    expect(formatUptime(120_000)).toBe('2m')
    expect(formatUptime(3599_000)).toBe('59m')
  })

  it('formats hours and remaining minutes', () => {
    expect(formatUptime(3600_000)).toBe('1h0m')
    expect(formatUptime(3660_000)).toBe('1h1m')
    expect(formatUptime(7200_000)).toBe('2h0m')
    expect(formatUptime(7320_000)).toBe('2h2m')
  })
})

describe('truncateAddress', () => {
  it('truncates addresses longer than 12 characters', () => {
    expect(truncateAddress('0x1234567890abcdef')).toBe('0x1234...cdef')
  })

  it('does not truncate addresses of 12 or fewer characters', () => {
    expect(truncateAddress('0x1234567890')).toBe('0x1234567890')
    expect(truncateAddress('short')).toBe('short')
  })

  it('truncates a full Ethereum-style address', () => {
    const address = '0xabcdef1234567890abcdef1234567890abcdef12'
    const result = truncateAddress(address)
    expect(result).toBe(`${address.slice(0, 6)}...${address.slice(-4)}`)
  })
})

describe('exceptionFromContext', () => {
  it('returns the context itself when it is an Error', () => {
    const err = new Error('original')
    expect(exceptionFromContext('msg', err)).toBe(err)
  })

  it('extracts error from context.error property', () => {
    const err = new Error('nested')
    expect(exceptionFromContext('msg', { error: err })).toBe(err)
  })

  it('extracts error from context.err property', () => {
    const err = new Error('nested')
    expect(exceptionFromContext('msg', { err })).toBe(err)
  })

  it('extracts error from context.e property', () => {
    const err = new Error('nested')
    expect(exceptionFromContext('msg', { e: err })).toBe(err)
  })

  it('extracts error from any value in the context object', () => {
    const err = new Error('nested')
    expect(exceptionFromContext('msg', { something: err })).toBe(err)
  })

  it('returns a new Error with the message when no Error found in context', () => {
    const result = exceptionFromContext('fallback message', { key: 'value' })
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe('fallback message')
  })

  it('returns a new Error when context is undefined', () => {
    const result = exceptionFromContext('msg')
    expect(result).toBeInstanceOf(Error)
  })
})
