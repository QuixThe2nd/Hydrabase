import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

type IpLookup = (ip: string) => Promise<null | { country?: string }>

const CDN_URL = 'https://cdn.jsdelivr.net/npm/@iplookup/country/'
const CDN_VERSION = '1.0.20260331'

// The package ships the real CDN index; read it via the real fetch (bun
// supports file: URLs) before the stub below replaces global fetch.
const indexBytes = new Uint8Array(
  await (await fetch(new URL('../../node_modules/@iplookup/country/4.idx', import.meta.url))).arrayBuffer()
)
const ipv4Index = new Uint32Array(indexBytes.buffer)
const ipv6Index = new BigUint64Array(indexBytes.buffer)

const toBase36Dir = (line: number): string => line.toString(36).padStart(2, '_')

// Single-record data file spanning the whole address space, country code 'DE'.
const dataRecord = (isIpv6: boolean): ArrayBuffer => {
  const view = new DataView(new ArrayBuffer(isIpv6 ? 18 : 10))
  if (isIpv6) {
    view.setBigUint64(0, 0n, true)
    view.setBigUint64(8, 0xffff_ffff_ffff_ffffn, true)
  } else {
    view.setUint32(0, 0, true)
    view.setUint32(4, 0xffff_ffff, true)
  }
  view.setUint16(isIpv6 ? 16 : 8, 0x4544, true)
  return view.buffer
}

const requestedUrls: string[] = []
const realFetch = globalThis.fetch

const stubbedFetch = (input: Parameters<typeof fetch>[0]): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  requestedUrls.push(url)
  if (url.endsWith('.idx')) {
    return Promise.resolve(new Response(indexBytes, { headers: { 'x-jsd-version': CDN_VERSION } }))
  }
  return Promise.resolve(new Response(dataRecord(url.includes('/6/'))))
}

let ipLookup: IpLookup

beforeAll(async () => {
  globalThis.fetch = stubbedFetch as typeof fetch
  // The module starts its CDN preloads while evaluating, so fetch and the
  // __CDN_URL__ build-time define must be in place first; a static import
  // is hoisted above both and cannot work here.
  Reflect.set(globalThis, '__CDN_URL__', CDN_URL)
  ;({ default: ipLookup } = await import('@iplookup/country'))
})

afterAll(() => {
  globalThis.fetch = realFetch
})

describe('@iplookup/country preload against a versioned CDN index', () => {
  it('resolves IPv6 lookups instead of throwing while building the index', async () => {
    // The library only parses addresses written with a '::' compression, so
    // format the last index entry's top 64 bits with a trailing '::'.
    const lastIp = `${(ipv6Index[ipv6Index.length - 1] ?? 0n).toString(16).padStart(16, '0').replace(/.{4}/gu, '$&:').replace(/:$/u, '')}::`
    await expect(ipLookup(lastIp)).resolves.toEqual({ country: 'DE' })
  })

  it('builds the IPv6 index from all 4096 index bytes', () => {
    expect(requestedUrls).toContain(`${CDN_URL.slice(0, -1)}@${CDN_VERSION}/6/${toBase36Dir(ipv6Index.length - 1)}`)
  })

  it('builds the IPv4 index from all 4096 index bytes', async () => {
    const last = ipv4Index[ipv4Index.length - 1] ?? 0
    const lastIp = [2 ** 24, 2 ** 16, 2 ** 8, 1].map((scale) => Math.floor(last / scale) % 256).join('.')
    await expect(ipLookup(lastIp)).resolves.toEqual({ country: 'DE' })
    expect(requestedUrls).toContain(`${CDN_URL.slice(0, -1)}@${CDN_VERSION}/4/${toBase36Dir(ipv4Index.length - 1)}`)
  })
})
