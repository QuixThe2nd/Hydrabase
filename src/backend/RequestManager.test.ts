/* eslint-disable max-lines-per-function */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { RequestManager } from './RequestManager'

describe('RequestManager', () => {
  let manager: RequestManager

  beforeEach(() => {
    manager = new RequestManager(500)
  })

  afterEach(() => {
    manager.close()
  })

  it('registers a request and returns a nonce and promise', () => {
    const { nonce, promise } = manager.register()
    expect(typeof nonce).toBe('number')
    expect(promise).toBeInstanceOf(Promise)
  })

  it('nonces are sequential and monotonically increasing', () => {
    const { nonce: n1 } = manager.register()
    const { nonce: n2 } = manager.register()
    const { nonce: n3 } = manager.register()
    expect(n2).toBe(n1 + 1)
    expect(n3).toBe(n2 + 1)
  })

  it('resolves a registered request with the response', async () => {
    const { nonce, promise } = manager.register<'artists'>()
    const response: [] = []
    const resolved = manager.resolve(nonce, response)
    expect(resolved).toBe(true)
    expect(await promise).toEqual(response)
  })

  it('returns false when resolving an unknown nonce', () => {
    const resolved = manager.resolve(9999, [])
    expect(resolved).toBe(false)
  })

  it('returns false from promise after timeout', async () => {
    const { promise } = manager.register()
    const result = await promise
    expect(result).toBe(false)
  }, { timeout: 2_000 })

  it('averageLatencyMs is 0 before any resolves', () => {
    expect(manager.averageLatencyMs).toBe(0)
  })

  it('averageLatencyMs is a non-negative number after a resolve', async () => {
    const { nonce, promise } = manager.register<'artists'>()
    manager.resolve(nonce, [])
    await promise
    expect(manager.averageLatencyMs).toBeGreaterThanOrEqual(0)
  })

  it('averageLatencyMs reflects multiple resolves', async () => {
    const r1 = manager.register<'artists'>()
    const r2 = manager.register<'artists'>()
    manager.resolve(r1.nonce, [])
    manager.resolve(r2.nonce, [])
    await Promise.all([r1.promise, r2.promise])
    expect(manager.averageLatencyMs).toBeGreaterThanOrEqual(0)
  })

  it('close resolves all pending requests with false', async () => {
    const { promise: p1 } = manager.register()
    const { promise: p2 } = manager.register()
    manager.close('test close')
    const [result1, result2] = await Promise.all([p1, p2])
    expect(result1).toBe(false)
    expect(result2).toBe(false)
  })

  it('resolve returns false after close', () => {
    const { nonce } = manager.register()
    manager.close()
    expect(manager.resolve(nonce, [])).toBe(false)
  })

  it('does not resolve same nonce twice', async () => {
    const { nonce, promise } = manager.register<'artists'>()
    manager.resolve(nonce, [])
    const secondResolve = manager.resolve(nonce, [])
    expect(secondResolve).toBe(false)
    expect(await promise).toEqual([])
  })
})
