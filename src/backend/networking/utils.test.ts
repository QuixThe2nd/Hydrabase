import { afterEach, describe, expect, it, mock } from 'bun:test'

import { getIp } from './utils'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('getIp', () => {
  it('returns trimmed IP from provider response', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response('203.0.113.9\n', { status: 200 }))) as unknown as typeof fetch

    await expect(getIp()).resolves.toBe('203.0.113.9')
  })

  it('throws when all providers fail', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('network unreachable'))) as unknown as typeof fetch

    await expect(getIp()).rejects.toThrow('[IP] Failed to fetch external IP from all providers')
  })
})
