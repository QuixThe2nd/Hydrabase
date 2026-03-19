/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { captureException, type HydrabaseGlobal, type HydrabaseTelemetryContext, withTelemetryContext } from './log'

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
})
