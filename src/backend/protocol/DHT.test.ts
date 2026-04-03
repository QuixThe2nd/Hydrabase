import { describe, expect, it } from 'bun:test'

import { BaseMessage, BinaryHex, BinaryString, ErrorMessage, QueryMessage, ResponseMessageSchema } from './DHT'

describe('DHT response schema', () => {
  it('accepts standard KRPC response payloads', () => {
    const result = ResponseMessageSchema.safeParse({
      r: {
        id: new Uint8Array([1, 2, 3]),
        nodes: new Uint8Array([4, 5, 6]),
        token: new Uint8Array([7, 8, 9]),
      },
      t: new Uint8Array([65, 66]),
      y: 'r',
    })

    expect(result.success).toBe(true)
  })

  it('rejects response with wrong y value', () => {
    const result = ResponseMessageSchema.safeParse({
      r: {},
      t: new Uint8Array([65]),
      y: 'q',
    })
    expect(result.success).toBe(false)
  })

  it('accepts response with empty r object', () => {
    const result = ResponseMessageSchema.safeParse({ r: {}, y: 'r' })
    expect(result.success).toBe(true)
  })

  it('accepts response without optional t field', () => {
    const result = ResponseMessageSchema.safeParse({ r: { id: new Uint8Array([1]) }, y: 'r' })
    expect(result.success).toBe(true)
  })
})

describe('BinaryString', () => {
  it('decodes a Uint8Array to a UTF-8 string', () => {
    const encoded = new TextEncoder().encode('hello')
    const result = BinaryString.safeParse(encoded)
    expect(result.success).toBe(true)
    expect(result.data).toBe('hello')
  })

  it('rejects non-Uint8Array input', () => {
    const result = BinaryString.safeParse('not a buffer')
    expect(result.success).toBe(false)
  })
})

describe('BinaryHex', () => {
  it('converts Uint8Array to hex string', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    const result = BinaryHex.safeParse(bytes)
    expect(result.success).toBe(true)
    expect(result.data).toBe('deadbeef')
  })

  it('rejects non-Uint8Array input', () => {
    const result = BinaryHex.safeParse(42)
    expect(result.success).toBe(false)
  })
})

describe('BaseMessage', () => {
  it('accepts a message with a valid t field', () => {
    const result = BaseMessage.safeParse({ t: new Uint8Array([65]) })
    expect(result.success).toBe(true)
    expect(result.data?.t).toBe('A')
  })

  it('accepts a message without the optional t field', () => {
    const result = BaseMessage.safeParse({})
    expect(result.success).toBe(true)
  })
})

describe('ErrorMessage', () => {
  it('accepts a numeric code with text', () => {
    const result = ErrorMessage.safeParse({
      e: [404, new Uint8Array(new TextEncoder().encode('not found'))],
      y: 'e',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a single text error', () => {
    const result = ErrorMessage.safeParse({
      e: [new Uint8Array(new TextEncoder().encode('error msg'))],
      y: 'e',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a single numeric error', () => {
    const result = ErrorMessage.safeParse({
      e: [500],
      y: 'e',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an error message with wrong y', () => {
    const result = ErrorMessage.safeParse({
      e: [500, new Uint8Array(new TextEncoder().encode('server error'))],
      y: 'r',
    })
    expect(result.success).toBe(false)
  })
})

describe('QueryMessage', () => {
  it('accepts a valid query message', () => {
    const result = QueryMessage.safeParse({
      a: { id: new Uint8Array(new TextEncoder().encode('nodeid1234567890')) },
      q: new Uint8Array(new TextEncoder().encode('find_node')),
      y: 'q',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a query message missing a', () => {
    const result = QueryMessage.safeParse({
      q: new Uint8Array(new TextEncoder().encode('find_node')),
      y: 'q',
    })
    expect(result.success).toBe(false)
  })
})