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

  it('returns null for empty string', () => {
    expect(parseHydrabaseUserAgent('')).toBeNull()
  })

  it('returns null when separator is at the start (no branch)', () => {
    expect(parseHydrabaseUserAgent('Hydrabase/-1.0.0')).toBeNull()
  })

  it('returns null when separator is at the end (no version)', () => {
    expect(parseHydrabaseUserAgent('Hydrabase/main-')).toBeNull()
  })

  it('handles whitespace in the user agent by trimming', () => {
    expect(parseHydrabaseUserAgent('  Hydrabase/main-1.0.0  ')).toEqual({
      branch: 'main',
      version: '1.0.0',
    })
  })

  it('handles deep nested branch with multiple dashes', () => {
    expect(parseHydrabaseUserAgent('Hydrabase/fix-cool-thing-3.0.1')).toEqual({
      branch: 'fix-cool-thing',
      version: '3.0.1',
    })
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

  it('returns 0 for identical versions', () => {
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0)
  })

  it('returns null when both are non-numeric', () => {
    expect(compareVersions('latest', 'stable')).toBeNull()
  })

  it('returns null when right version is non-numeric', () => {
    expect(compareVersions('1.0.0', 'unknown')).toBeNull()
  })

  it('handles major version difference', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.9.9', '2.0.0')).toBe(-1)
  })

  it('handles deep version segments', () => {
    expect(compareVersions('1.0.0.1', '1.0.0.0')).toBe(1)
  })

  it('handles v-prefix on right side', () => {
    expect(compareVersions('1.0.0', 'v1.0.0')).toBe(0)
  })
})
