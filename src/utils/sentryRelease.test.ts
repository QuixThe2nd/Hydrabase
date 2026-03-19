import { describe, expect, it } from 'bun:test'

import { makeSentryRelease, sanitizeSegment } from './sentryRelease'

describe('sanitizeSegment', () => {
  it('trims and collapses whitespace to dashes', () => {
    expect(sanitizeSegment('  my  app\tname\n')).toBe('my-app-name')
  })

  it('replaces forward slashes with dashes', () => {
    expect(sanitizeSegment('feature/foo')).toBe('feature-foo')
  })

  it('replaces back slashes with dashes', () => {
    expect(sanitizeSegment('feature\\foo')).toBe('feature-foo')
  })

  it('replaces mixed slashes with a single dash', () => {
    expect(sanitizeSegment('feature/foo\\bar')).toBe('feature-foo-bar')
  })

  it('replaces unicode / exotic characters with dashes', () => {
    // é and á are adjacent non-ASCII chars → collapsed into one dash
    expect(sanitizeSegment('reléásé!@#name')).toBe('rel-s-name')
  })

  it('returns "unknown" for empty string', () => {
    expect(sanitizeSegment('')).toBe('unknown')
  })

  it('returns "unknown" for whitespace-only input', () => {
    expect(sanitizeSegment('   ')).toBe('unknown')
  })

  it('caps output at 64 characters', () => {
    expect(sanitizeSegment('a'.repeat(100))).toHaveLength(64)
  })

  it('does not truncate input that is exactly 64 characters', () => {
    const input = 'a'.repeat(64)
    expect(sanitizeSegment(input)).toBe(input)
  })

  it('preserves allowed characters: alphanumeric, dots, underscores, dashes', () => {
    expect(sanitizeSegment('my_app.v1-beta')).toBe('my_app.v1-beta')
  })

  it('collapses consecutive dashes into one', () => {
    expect(sanitizeSegment('foo--bar')).toBe('foo-bar')
  })

  it('strips leading and trailing dashes after normalization', () => {
    expect(sanitizeSegment('!hello!')).toBe('hello')
  })
})

describe('makeSentryRelease', () => {
  it('combines sanitized segments in the expected format', () => {
    expect(makeSentryRelease({ app: 'myapp', branch: 'main', version: '1.0.0' })).toBe(
      'myapp@1.0.0+main',
    )
  })

  it('sanitizes all three segments', () => {
    expect(
      makeSentryRelease({ app: ' my app ', branch: ' feature/foo ', version: ' 1.2.3 ' }),
    ).toBe('my-app@1.2.3+feature-foo')
  })

  it('uses "unknown" for empty app', () => {
    expect(makeSentryRelease({ app: '', branch: 'main', version: '1.0.0' })).toBe(
      'unknown@1.0.0+main',
    )
  })

  it('uses "unknown" for empty branch', () => {
    expect(makeSentryRelease({ app: 'myapp', branch: '', version: '1.0.0' })).toBe(
      'myapp@1.0.0+unknown',
    )
  })

  it('uses "unknown" for empty version', () => {
    expect(makeSentryRelease({ app: 'myapp', branch: 'main', version: '' })).toBe(
      'myapp@unknown+main',
    )
  })

  it('handles branch names with slashes', () => {
    expect(
      makeSentryRelease({ app: 'app', branch: 'feature/my-feature', version: '2.0.0' }),
    ).toBe('app@2.0.0+feature-my-feature')
  })

  it('caps each segment individually to 64 characters', () => {
    const long = 'a'.repeat(100)
    const result = makeSentryRelease({ app: long, branch: long, version: long })
    const [appAndVersion, branch] = result.split('+')
    const [app, version] = appAndVersion.split('@')
    expect(app).toHaveLength(64)
    expect(version).toHaveLength(64)
    expect(branch).toHaveLength(64)
  })
})
