#!/usr/bin/env bun

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { classifyGitSyncState, parseAutoUpdateIntervalMs, resolveAutoUpdateEnabled } from '../src/backend/autoUpdate'
import { isRunningInDockerEnvironment } from '../src/backend/runtime'

const REPO_ROOT = resolve(import.meta.dir, '..')
const BACKEND_ENTRY = 'src/backend'
const MAX_CRASH_RESTARTS = 5
const RESTART_WINDOW_MS = 60_000
const RESTART_DELAY_MS = 1_000

interface CommandResult {
  ok: boolean
  stderr: string
  stdout: string
}

interface SupervisorState {
  child: Bun.Subprocess<'inherit', 'inherit', 'inherit'>
  shuttingDown: boolean
  updateRestartPending: boolean
}

type UpdateOutcome =
  | { kind: 'applied'; message: string }
  | { kind: 'skipped'; message: string }

const runCommand = (cmd: string[], cwd = REPO_ROOT): CommandResult => {
  const proc = Bun.spawnSync(cmd, {
    cwd,
    stderr: 'pipe',
    stdout: 'pipe',
  })

  return {
    ok: proc.exitCode === 0,
    stderr: proc.stderr.toString().trim(),
    stdout: proc.stdout.toString().trim(),
  }
}

const logLine = (scope: string, message: string): void => {
  process.stdout.write(`[${scope}] ${message}\n`)
}

const hasGitWorktree = (): boolean => existsSync(resolve(REPO_ROOT, '.git'))

const getCurrentBranch = (): null | string => {
  const branchResult = runCommand(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
  if (!branchResult.ok || !branchResult.stdout) return null
  return branchResult.stdout
}

const hasCleanWorktree = (): boolean => {
  const statusResult = runCommand(['git', 'status', '--porcelain'])
  return statusResult.ok && statusResult.stdout.length === 0
}

const getHeadRef = (ref: string): null | string => {
  const result = runCommand(['git', 'rev-parse', ref])
  if (!result.ok || !result.stdout) return null
  return result.stdout
}

const getMergeBase = (left: string, right: string): null | string => {
  const result = runCommand(['git', 'merge-base', left, right])
  if (!result.ok || !result.stdout) return null
  return result.stdout
}

const fetchBranch = (branch: string): boolean => runCommand(['git', 'fetch', '--quiet', 'origin', branch]).ok

const installDependencies = (): boolean => runCommand(['bun', 'install', '--frozen-lockfile']).ok

const pullBranch = (branch: string): boolean => runCommand(['git', 'pull', '--ff-only', 'origin', branch]).ok

const maybeApplyAutoUpdate = (): UpdateOutcome => {
  if (!Bun.which('git')) return { kind: 'skipped', message: 'Auto-update disabled because git is not installed.' }
  if (!hasGitWorktree()) return { kind: 'skipped', message: 'Auto-update disabled because this install is not a git checkout.' }
  if (!hasCleanWorktree()) return { kind: 'skipped', message: 'Auto-update skipped because the working tree has local changes.' }

  const branch = getCurrentBranch()
  if (!branch || branch === 'HEAD') return { kind: 'skipped', message: 'Auto-update skipped because the current branch could not be resolved.' }
  if (!fetchBranch(branch)) return { kind: 'skipped', message: `Auto-update skipped because origin/${branch} could not be fetched.` }

  const localHead = getHeadRef('HEAD')
  const upstreamHead = getHeadRef(`origin/${branch}`)
  const mergeBase = getMergeBase('HEAD', `origin/${branch}`)
  if (!localHead || !upstreamHead || !mergeBase) return { kind: 'skipped', message: 'Auto-update skipped because git refs could not be compared.' }

  const syncState = classifyGitSyncState(localHead, upstreamHead, mergeBase)
  if (syncState === 'up-to-date') return { kind: 'skipped', message: 'Hydrabase is already up to date.' }
  if (syncState === 'ahead') return { kind: 'skipped', message: 'Auto-update skipped because the local branch is ahead of origin.' }
  if (syncState === 'diverged') return { kind: 'skipped', message: 'Auto-update skipped because the local branch has diverged from origin.' }

  logLine('AUTOUPDATE', `Updating ${branch} from origin/${branch}.`)
  if (!pullBranch(branch)) return { kind: 'skipped', message: `Auto-update failed while pulling origin/${branch}.` }
  if (!installDependencies()) return { kind: 'skipped', message: 'Auto-update failed while installing dependencies with bun install --frozen-lockfile.' }

  return { kind: 'applied', message: `Applied updates from origin/${branch}.` }
}

const startBackend = (): Bun.Subprocess<'inherit', 'inherit', 'inherit'> => Bun.spawn(['bun', BACKEND_ENTRY], {
  cwd: REPO_ROOT,
  env: {
    ...process.env,
    HYDRABASE_SUPERVISED: 'true',
  },
  stderr: 'inherit',
  stdin: 'inherit',
  stdout: 'inherit',
})

const trimRestartHistory = (restarts: number[], now: number): number[] => restarts.filter(timestamp => now - timestamp <= RESTART_WINDOW_MS)

const stopChild = (state: SupervisorState, signal: NodeJS.Signals): void => {
  if (state.child.killed) return
  state.child.kill(signal)
}

const requestUpdateRestart = (state: SupervisorState): void => {
  state.updateRestartPending = true
  stopChild(state, 'SIGTERM')
}

const launchBackend = (state: SupervisorState): void => {
  state.child = startBackend()
}

const registerShutdownHandlers = (state: SupervisorState): void => {
  const handleShutdown = (signal: NodeJS.Signals): void => {
    state.shuttingDown = true
    stopChild(state, signal)
  }

  process.once('SIGINT', () => { handleShutdown('SIGINT') })
  process.once('SIGTERM', () => { handleShutdown('SIGTERM') })
}

const logAutoUpdateMode = (autoUpdateEnabled: boolean, isDocker: boolean): void => {
  if (autoUpdateEnabled) return
  if (isDocker) {
    logLine('AUTOUPDATE', 'Docker runtime detected. In-app auto-update is disabled; update by pulling a newer container image.')
    return
  }

  logLine('AUTOUPDATE', 'Auto-update disabled via HYDRABASE_AUTO_UPDATE=false.')
}

const runInitialAutoUpdate = (state: SupervisorState, autoUpdateEnabled: boolean): void => {
  if (!autoUpdateEnabled) return

  const outcome = maybeApplyAutoUpdate()
  logLine('AUTOUPDATE', outcome.message)
  if (outcome.kind === 'applied') requestUpdateRestart(state)
}

const createUpdateTimer = (state: SupervisorState, autoUpdateEnabled: boolean, autoUpdateIntervalMs: number): null | ReturnType<typeof setInterval> => {
  if (!autoUpdateEnabled || autoUpdateIntervalMs <= 0) return null

  const timer = setInterval(() => {
    if (state.shuttingDown || state.updateRestartPending) return

    const outcome = maybeApplyAutoUpdate()
    logLine('AUTOUPDATE', outcome.message)
    if (outcome.kind === 'applied') requestUpdateRestart(state)
  }, autoUpdateIntervalMs)

  timer.unref?.()
  return timer
}

const shouldAbortAfterCrash = (restartHistory: number[]): boolean => {
  const now = Date.now()
  restartHistory.push(now)
  const recentRestarts = trimRestartHistory(restartHistory, now)
  restartHistory.splice(0, restartHistory.length, ...recentRestarts)
  return recentRestarts.length > MAX_CRASH_RESTARTS
}

const runSupervisorLoop = async (state: SupervisorState, restartHistory: number[]): Promise<void> => {
  while (true) {
    const activeChild = state.child
    const exitCode = await activeChild.exited
    if (state.child !== activeChild) continue
    if (state.shuttingDown) return

    if (state.updateRestartPending) {
      state.updateRestartPending = false
      logLine('START', 'Restarting backend after update.')
      launchBackend(state)
      continue
    }

    if (shouldAbortAfterCrash(restartHistory)) {
      logLine('START', `Backend exited too many times within ${RESTART_WINDOW_MS / 1000}s. Last exit code: ${exitCode}.`)
      process.exit(typeof exitCode === 'number' ? exitCode : 1)
    }

    logLine('START', `Backend exited with code ${exitCode}. Restarting in ${RESTART_DELAY_MS}ms.`)
    await Bun.sleep(RESTART_DELAY_MS)
    launchBackend(state)
  }
}

const main = async (): Promise<void> => {
  const isDocker = isRunningInDockerEnvironment()
  const autoUpdateEnabled = resolveAutoUpdateEnabled(process.env['HYDRABASE_AUTO_UPDATE'], isDocker)
  const autoUpdateIntervalMs = parseAutoUpdateIntervalMs(process.env['HYDRABASE_AUTO_UPDATE_INTERVAL_MS'])
  const restartHistory: number[] = []
  const state: SupervisorState = {
    child: startBackend(),
    shuttingDown: false,
    updateRestartPending: false,
  }

  registerShutdownHandlers(state)
  logAutoUpdateMode(autoUpdateEnabled, isDocker)
  runInitialAutoUpdate(state, autoUpdateEnabled)

  const updateTimer = createUpdateTimer(state, autoUpdateEnabled, autoUpdateIntervalMs)
  await runSupervisorLoop(state, restartHistory)
  if (updateTimer) clearInterval(updateTimer)
}

await main()