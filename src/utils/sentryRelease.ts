export type SentryReleaseParts = {
  app: string
  version: string
  branch: string
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

export const makeSentryRelease = ({ app, version, branch }: SentryReleaseParts): string => {
  const a = sanitizeSegment(app)
  const v = sanitizeSegment(version)
  const b = sanitizeSegment(branch)
  return `${a}@${v}+${b}`
}
