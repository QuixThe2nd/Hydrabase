export interface ParsedHydrabaseUserAgent {
  branch: string
  version: string
}

const HYDRABASE_USER_AGENT_PREFIX = 'Hydrabase/'
const NUMERIC_VERSION_PREFIX = /^(?:v)?(?<segments>\d+(?:\.\d+)*)/u

export const parseHydrabaseUserAgent = (userAgent: string): null | ParsedHydrabaseUserAgent => {
  const normalized = userAgent.trim()
  if (!normalized.startsWith(HYDRABASE_USER_AGENT_PREFIX)) return null

  const metadata = normalized.slice(HYDRABASE_USER_AGENT_PREFIX.length)
  const separatorIndex = metadata.lastIndexOf('-')
  if (separatorIndex <= 0 || separatorIndex >= metadata.length - 1) return null

  const branch = metadata.slice(0, separatorIndex).trim()
  const version = metadata.slice(separatorIndex + 1).trim()
  if (!branch || !version) return null

  return { branch, version }
}

const parseVersionSegments = (version: string): null | number[] => {
  const normalized = version.trim()
  const matchedPrefix = normalized.match(NUMERIC_VERSION_PREFIX)
  const segmentsText = matchedPrefix?.groups?.['segments']
  if (!segmentsText) return null

  const segments = segmentsText.split('.').map(segment => Number.parseInt(segment, 10))
  return segments.some(Number.isNaN) ? null : segments
}

export const compareVersions = (left: string, right: string): null | number => {
  const leftSegments = parseVersionSegments(left)
  const rightSegments = parseVersionSegments(right)
  if (!leftSegments || !rightSegments) return null

  const maxLength = Math.max(leftSegments.length, rightSegments.length)
  for (let i = 0; i < maxLength; i++) {
    const leftSegment = leftSegments[i] ?? 0
    const rightSegment = rightSegments[i] ?? 0
    if (leftSegment > rightSegment) return 1
    if (leftSegment < rightSegment) return -1
  }

  return 0
}
