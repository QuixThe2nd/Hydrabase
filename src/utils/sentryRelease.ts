export interface SentryReleaseParts {
  app: string
  branch: string
  version: string
}

const sanitizeSegment = (input: string): string => {
  const trimmed = input.trim()
  if (!trimmed) return 'unknown'

  // Keep release strings stable and Sentry-friendly:
  // - Avoid whitespace
  // - Avoid slashes from branch names (feature/foo)
  // - Avoid exotic characters that can make releases hard to query
  const normalized = trimmed
    .replace(/\s+/gu, '-')
    .replace(/[\\/]+/gu, '-')
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')

  // Cap to avoid accidental high-cardinality / huge tag values
  return normalized.length > 64 ? normalized.slice(0, 64) : normalized
}

export const makeSentryRelease = ({ app, branch, version }: SentryReleaseParts): string => {
  const a = sanitizeSegment(app)
  const b = sanitizeSegment(branch)
  const v = sanitizeSegment(version)
  return `${a}@${v}+${b}`
}

// Lightweight self-test harness for sanitizeSegment/makeSentryRelease.
// This is intended to support static analysis requirements for critical
// release-string logic without affecting production behavior.
const runSentryReleaseSelfTest = (): void => {
  const assertEqual = (actual: string, expected: string, message: string): void => {
    if (actual !== expected) {
      throw new Error(
        `sentryRelease self-test failed: ${message}. Expected "${expected}", got "${actual}".`,
      )
    }
  }

  // Whitespace normalization
  assertEqual(
    sanitizeSegment('  my  app\tname\n'),
    'my-app-name',
    'whitespace should be collapsed to single dashes and trimmed',
  )

  // Slash normalization (e.g. branch names like feature/foo or feature\bar)
  assertEqual(
    sanitizeSegment('feature/foo\\bar'),
    'feature-foo-bar',
    'slashes should be normalized to dashes',
  )

  // Exotic characters normalization
  assertEqual(
    sanitizeSegment('reléásé!@#name'),
    'rel-ase-name',
    'exotic characters should be replaced with dashes and cleaned',
  )

  // Empty / whitespace-only segments become "unknown"
  assertEqual(
    sanitizeSegment('   '),
    'unknown',
    'empty or whitespace-only segments should map to "unknown"',
  )

  // Length capping at 64 characters
  const longSegment = 'a'.repeat(100)
  const capped = sanitizeSegment(longSegment)
  assertEqual(
    String(capped.length),
    '64',
    'segments longer than 64 characters should be capped to length 64',
  )

  // makeSentryRelease combines sanitized segments in a stable format
  assertEqual(
    makeSentryRelease({
      app: ' my app ',
      branch: ' feature/foo ',
      version: ' 1.2.3 ',
    }),
    'my-app@1.2.3+feature-foo',
    'makeSentryRelease should combine sanitized segments as app@version+branch',
  )
}

// Run self-tests automatically in test environments only.
if (typeof process !== 'undefined') {
  const env = (process as any).env || {}
  if (env.NODE_ENV === 'test' || env.SENTRY_RELEASE_SELFTEST === '1') {
    runSentryReleaseSelfTest()
  }
}
