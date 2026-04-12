export const DEFAULT_AUTO_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1_000

export type GitSyncState = 'ahead' | 'behind' | 'diverged' | 'up-to-date'

export const classifyGitSyncState = (localHead: string, upstreamHead: string, mergeBase: string): GitSyncState => {
  if (localHead === upstreamHead) return 'up-to-date'
  if (localHead === mergeBase) return 'behind'
  if (upstreamHead === mergeBase) return 'ahead'
  return 'diverged'
}

export const parseAutoUpdateIntervalMs = (raw: string | undefined): number => {
  if (raw === undefined) return DEFAULT_AUTO_UPDATE_INTERVAL_MS

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_AUTO_UPDATE_INTERVAL_MS
  return parsed
}

export const resolveAutoUpdateEnabled = (raw: string | undefined, isRunningInDocker: boolean): boolean => {
  if (raw === 'false') return false
  if (raw === 'true') return true
  return !isRunningInDocker
}