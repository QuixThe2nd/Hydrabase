import { describe, expect, it } from 'bun:test'

import { compareVersions, parseHydrabaseUserAgent } from './versioning'

describe('parseHydrabaseUserAgent', () => {
  it('parses branch and version from standard Hydrabase user agent', () => {
    expect(parseHydrabaseUserAgent('Hydrabase/main-1.2.3')).toEqual({
      branch: 'main',
      version: '1.2.3',
    })
  })

  it('keeps branch dashes by splitting on last dash', () => {
    expect(parseHydrabaseUserAgent('Hydrabase/feature-cool-2.0.0')).toEqual({
      branch: 'feature-cool',
      version: '2.0.0',
    })
  })

  it('returns null for non-Hydrabase user agents', () => {
    expect(parseHydrabaseUserAgent('SomeApp/main-1.2.3')).toBeNull()
  })

  it('returns null when no branch-version separator exists', () => {
    expect(parseHydrabaseUserAgent('Hydrabase/main')).toBeNull()
  })
})

describe('compareVersions', () => {
  it('returns positive when left version is newer', () => {
    expect(compareVersions('1.2.4', '1.2.3')).toBe(1)
  })

  it('returns negative when left version is older', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1)
  })

  it('treats missing patch segment as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
  })

  it('accepts v-prefixed versions', () => {
    expect(compareVersions('v1.3.0', '1.2.9')).toBe(1)
  })

  it('ignores prerelease suffix after numeric prefix', () => {
    expect(compareVersions('1.2.3-beta.1', '1.2.2')).toBe(1)
  })

  it('returns null for non-numeric versions', () => {
    expect(compareVersions('latest', '1.2.3')).toBeNull()
  })
})
