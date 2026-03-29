import { watch } from 'node:fs'
import { resolve } from 'node:path'

import type PeerManager from './PeerManager'

import { warn } from '../utils/log'
import { Trace } from '../utils/trace'
import { buildWebUI } from './webui'

const BACKEND_DIR = resolve('./src/backend')
const BACKEND_REFRESH_DEBOUNCE_MS = 250
const FRONTEND_BUILD_DEBOUNCE_MS = 250
const FRONTEND_DIR = resolve('./src/frontend')

const isRunningInDocker = (): boolean => {
  if (process.env['DOCKER_CONTAINER'] === 'true') return true
  if (process.env['container'] === 'docker') return true

  try {
    if (Bun.file('/.dockerenv').size > 0) return true
  } catch {
    // Ignore filesystem detection errors and continue with env-based checks.
  }

  return false
}

const isDirectBunHostRun = (): boolean => typeof Bun !== 'undefined' && !isRunningInDocker()

const queueFrontendBuildFactory = () => {
  let frontendBuildTimer: NodeJS.Timeout | undefined
  let frontendBuildChain = Promise.resolve()

  return () => {
    if (frontendBuildTimer) clearTimeout(frontendBuildTimer)
    frontendBuildTimer = setTimeout(() => {
      frontendBuildChain = frontendBuildChain
        .then(async () => {
          const trace = Trace.start('[DEV] Frontend change detected')
          try {
            await buildWebUI()
            trace.success()
          } catch (error) {
            trace.caughtError(String(error))
            trace.fail('[DEV] Frontend rebuild failed')
          }
        })
        .catch((error: unknown) => {
          warn('DEVWARN:', `[DEV] Failed frontend rebuild: ${String(error)}`)
        })
    }, FRONTEND_BUILD_DEBOUNCE_MS)
  }
}

const queueRefreshFactory = (peerManager: PeerManager) => {
  let backendRefreshTimer: NodeJS.Timeout | undefined

  return () => {
    if (backendRefreshTimer) clearTimeout(backendRefreshTimer)
    backendRefreshTimer = setTimeout(() => {
      const trace = Trace.start('[DEV] Backend change detected')
      const sent = peerManager.sendRefreshUi(trace)
      if (sent > 0) trace.success()
      else trace.softFail('[DEV] No API clients connected for refresh_ui')
    }, BACKEND_REFRESH_DEBOUNCE_MS)
  }
}

const startFrontendWatch = (queueFrontendBuild: () => void): void => {
  try {
    const frontendWatcher = watch(FRONTEND_DIR, { recursive: true }, () => {
      queueFrontendBuild()
    })
    frontendWatcher.on('error', (error) => {
      warn('DEVWARN:', `[DEV] Frontend watcher error: ${String(error)}`)
    })
  } catch (error) {
    warn('DEVWARN:', `[DEV] Failed to watch frontend directory: ${String(error)}`)
  }
}

const startBackendWatch = (queueRefresh: () => void): void => {
  try {
    const backendWatcher = watch(BACKEND_DIR, { recursive: true }, () => {
      queueRefresh()
    })
    backendWatcher.on('error', (error) => {
      warn('DEVWARN:', `[DEV] Backend watcher error: ${String(error)}`)
    })
  } catch (error) {
    warn('DEVWARN:', `[DEV] Failed to watch backend directory: ${String(error)}`)
  }
}

export const startDevWatchers = (peerManager: PeerManager): void => {
  if (process.env['NODE_ENV'] === 'production' || process.env['HYDRABASE_DEV_WATCH'] === 'false') return
  if (!isDirectBunHostRun()) return

  const queueFrontendBuild = queueFrontendBuildFactory()
  const queueRefresh = queueRefreshFactory(peerManager)

  startFrontendWatch(queueFrontendBuild)
  startBackendWatch(queueRefresh)
}