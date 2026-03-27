import { describe, expect, it } from 'bun:test'

import { ResponseMessageSchema } from './DHT'

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
})