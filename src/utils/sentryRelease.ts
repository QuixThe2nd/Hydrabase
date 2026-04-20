interface SentryReleaseParts {
  app: string
  branch: string
  version: string
}

export const sanitizeSegment = (input: string): string => {
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

const assertEqual = (actual: string, expected: string, message: string): void => {
  if (actual !== expected) {
    throw new Error(
      `sentryRelease self-test failed: ${message}. Expected "${expected}", got "${actual}".`,
    )
  }
}

const runSanitizeSegmentSelfTests = (): void => {
  assertEqual(
    sanitizeSegment('  my  app\tname\n'),
    'my-app-name',
    'whitespace should be collapsed to single dashes and trimmed',
  )

  assertEqual(
    sanitizeSegment('feature/foo\\bar'),
    'feature-foo-bar',
    'slashes should be normalized to dashes',
  )

  assertEqual(
    sanitizeSegment('reléásé!@#name'),
    'rel-s-name',
    'exotic characters should be replaced with dashes and cleaned',
  )

  assertEqual(
    sanitizeSegment('   '),
    'unknown',
    'empty or whitespace-only segments should map to "unknown"',
  )

  const longSegment = 'a'.repeat(100)
  const capped = sanitizeSegment(longSegment)
  assertEqual(
    String(capped.length),
    '64',
    'segments longer than 64 characters should be capped to length 64',
  )
}

const runMakeSentryReleaseSelfTests = (): void => {
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

// Lightweight self-test harness for sanitizeSegment/makeSentryRelease.
// This is intended to support static analysis requirements for critical
// release-string logic without affecting production behavior.
const runSentryReleaseSelfTest = (): void => {
  runSanitizeSegmentSelfTests()
  runMakeSentryReleaseSelfTests()
}

const getRuntimeEnv = (): Record<string, string | undefined> => {
  if (typeof process === 'undefined') return {}
  return process.env
}

// Run self-tests automatically in test environments only.
const env = getRuntimeEnv()
if (env['NODE_ENV'] === 'test' || env['SENTRY_RELEASE_SELFTEST'] === '1') {
  runSentryReleaseSelfTest()
}
