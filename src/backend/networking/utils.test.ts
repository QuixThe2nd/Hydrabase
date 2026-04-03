import { describe, expect, it } from 'bun:test'

import { isAllowedPeer, isPeerLocalHostname, PEER_PORT_MAX, PEER_PORT_MIN } from './utils'

describe('PEER_PORT constants', () => {
  it('defines min port as 4000', () => {
    expect(PEER_PORT_MIN).toBe(4000)
  })

  it('defines max port as 5000', () => {
    expect(PEER_PORT_MAX).toBe(5000)
  })
})

describe('isPeerLocalHostname', () => {
  it('returns true for 127.0.0.1', () => {
    expect(isPeerLocalHostname('127.0.0.1')).toBe(true)
  })

  it('returns true for localhost', () => {
    expect(isPeerLocalHostname('localhost')).toBe(true)
  })

  it('returns true for ::1', () => {
    expect(isPeerLocalHostname('::1')).toBe(true)
  })

  it('returns true for [::1]', () => {
    expect(isPeerLocalHostname('[::1]')).toBe(true)
  })

  it('returns false for an external IP', () => {
    expect(isPeerLocalHostname('1.2.3.4')).toBe(false)
  })

  it('returns false for a domain name', () => {
    expect(isPeerLocalHostname('example.com')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isPeerLocalHostname('')).toBe(false)
  })
})

describe('isAllowedPeer', () => {
  it('allows localhost on any port', () => {
    expect(isAllowedPeer('127.0.0.1', 80)).toBe(true)
    expect(isAllowedPeer('127.0.0.1', 9999)).toBe(true)
    expect(isAllowedPeer('127.0.0.1', 1)).toBe(true)
  })

  it('allows ::1 on any port', () => {
    expect(isAllowedPeer('::1', 80)).toBe(true)
  })

  it('allows [::1] on any port', () => {
    expect(isAllowedPeer('[::1]', 3000)).toBe(true)
  })

  it('allows external IP on port 4000 (min boundary)', () => {
    expect(isAllowedPeer('1.2.3.4', 4000)).toBe(true)
  })

  it('allows external IP on port 5000 (max boundary)', () => {
    expect(isAllowedPeer('1.2.3.4', 5000)).toBe(true)
  })

  it('allows external IP on port inside range', () => {
    expect(isAllowedPeer('1.2.3.4', 4500)).toBe(true)
  })

  it('rejects external IP on port below range', () => {
    expect(isAllowedPeer('1.2.3.4', 3999)).toBe(false)
  })

  it('rejects external IP on port above range', () => {
    expect(isAllowedPeer('1.2.3.4', 5001)).toBe(false)
  })

  it('rejects external IP on port 80', () => {
    expect(isAllowedPeer('203.0.113.1', 80)).toBe(false)
  })

  it('rejects external domain on port outside range', () => {
    expect(isAllowedPeer('example.com', 443)).toBe(false)
  })

  it('allows external domain on port inside range', () => {
    expect(isAllowedPeer('example.com', 4545)).toBe(true)
  })
})
