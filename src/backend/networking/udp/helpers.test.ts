import bencode from 'bencode'
import { describe, expect, it } from 'bun:test'
import dgram from 'dgram'

import type { RPCMessage } from './server'

import { handleAwaiter, handleInvalidUsernameError, tryDecodeMessage, tryParseError } from './helpers'

describe('handleAwaiter', () => {
  it('calls matching awaiter and returns true when done', () => {
    const awaiters = new Map<string, (msg: RPCMessage, rinfo: { address: string, port: number }) => boolean>()
    const txnId = 'abc1'
    let called = false
    awaiters.set(txnId, () => { called = true; return true })

    const msg = { t: txnId, y: 'r' } as unknown as RPCMessage
    const peer = { address: '127.0.0.1', port: 4545 } as dgram.RemoteInfo
    const result = handleAwaiter(msg, peer, awaiters)

    expect(result).toBe(true)
    expect(called).toBe(true)
    expect(awaiters.has(txnId)).toBe(false)
  })

  it('keeps awaiter in map when it returns false (not done)', () => {
    const awaiters = new Map<string, (msg: RPCMessage, rinfo: { address: string, port: number }) => boolean>()
    const txnId = 'abc2'
    awaiters.set(txnId, () => false)

    const msg = { t: txnId, y: 'r' } as unknown as RPCMessage
    const peer = { address: '127.0.0.1', port: 4545 } as dgram.RemoteInfo
    const result = handleAwaiter(msg, peer, awaiters)

    expect(result).toBe(false)
    expect(awaiters.has(txnId)).toBe(true)
  })

  it('returns false when no matching awaiter exists', () => {
    const awaiters = new Map<string, (msg: RPCMessage, rinfo: { address: string, port: number }) => boolean>()
    const msg = { t: 'unknown', y: 'r' } as unknown as RPCMessage
    const peer = { address: '127.0.0.1', port: 4545 } as dgram.RemoteInfo
    expect(handleAwaiter(msg, peer, awaiters)).toBe(false)
  })

  it('returns false when message has no transaction id', () => {
    const awaiters = new Map<string, (msg: RPCMessage, rinfo: { address: string, port: number }) => boolean>()
    const msg = { y: 'r' } as unknown as RPCMessage
    const peer = { address: '127.0.0.1', port: 4545 } as dgram.RemoteInfo
    expect(handleAwaiter(msg, peer, awaiters)).toBe(false)
  })
})

describe('handleInvalidUsernameError', () => {
  const peer = { address: '1.2.3.4', port: 4545 } as dgram.RemoteInfo

  it('returns true for a well-formed invalid-username error', () => {
    const error = {
      message: JSON.stringify({
        err: [{ message: 'Username must be 3-20 alphanumeric characters', path: ['username'] }],
      }),
    }
    expect(handleInvalidUsernameError(error, peer)).toBe(true)
  })

  it('returns false when the error is null', () => {
    expect(handleInvalidUsernameError(null, peer)).toBe(false)
  })

  it('returns false when the error is not an object', () => {
    expect(handleInvalidUsernameError('string error', peer)).toBe(false)
  })

  it('returns false when message is not valid JSON', () => {
    expect(handleInvalidUsernameError({ message: 'not-json' }, peer)).toBe(false)
  })

  it('returns false when the err array is empty', () => {
    const error = { message: JSON.stringify({ err: [] }) }
    expect(handleInvalidUsernameError(error, peer)).toBe(false)
  })

  it('returns false when path does not include username', () => {
    const error = {
      message: JSON.stringify({
        err: [{ message: 'Username must be 3-20 alphanumeric characters', path: ['email'] }],
      }),
    }
    expect(handleInvalidUsernameError(error, peer)).toBe(false)
  })

  it('returns false when error message does not match username text', () => {
    const error = {
      message: JSON.stringify({
        err: [{ message: 'Some other error', path: ['username'] }],
      }),
    }
    expect(handleInvalidUsernameError(error, peer)).toBe(false)
  })
})

describe('tryDecodeMessage', () => {
  it('decodes a valid bencode buffer', () => {
    const encoded = bencode.encode({ q: 'ping', y: 'q' })
    const result = tryDecodeMessage(Buffer.from(encoded))
    expect(result).toBeTruthy()
  })

  it('returns undefined for an invalid buffer', () => {
    const result = tryDecodeMessage(Buffer.from([0xff, 0xfe, 0x00]))
    expect(result).toBeUndefined()
  })

  it('returns null or undefined for an empty buffer', () => {
    const result = tryDecodeMessage(Buffer.alloc(0))
    expect(result === null || result === undefined).toBe(true)
  })
})

describe('tryParseError', () => {
  it('parses a valid JSON error message', () => {
    const error = { message: JSON.stringify({ code: 500, text: 'Server error' }) }
    const result = tryParseError(error)
    expect(result).toEqual({ code: 500, text: 'Server error' })
  })

  it('returns the original error if message is not valid JSON', () => {
    const error = { message: 'plain text error' }
    expect(tryParseError(error)).toBe(error)
  })

  it('returns the error as-is if it has no message property', () => {
    const error = { code: 500 }
    expect(tryParseError(error)).toBe(error)
  })

  it('returns null as-is', () => {
    expect(tryParseError(null)).toBe(null)
  })

  it('returns a string as-is', () => {
    expect(tryParseError('some error')).toBe('some error')
  })
})
