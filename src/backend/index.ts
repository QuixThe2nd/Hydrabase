import * as Sentry from '@sentry/bun'

import type { HydrabaseTelemetryContext } from '../utils/log'

// @ts-expect-error: This is supported by bun
import VERSION from '../../VERSION' with { type: 'text' }
import { error, log } from '../utils/log'
import { makeSentryRelease } from '../utils/sentryRelease'
import { BRANCH } from './branch'
import { createLiveConfig } from './config'
import { startNode } from './Node'

const applyTelemetryScope = (scope: {
  setExtras: (extras: Record<string, unknown>) => void
  setTag: (key: string, value: string) => void
  setUser: (user: null | { id: string; username?: string }) => void
}, telemetry?: HydrabaseTelemetryContext) => {
  if (!telemetry) return
  if (telemetry.user) scope.setUser(telemetry.user)
  if (telemetry.tags) {
    for (const [key, value] of Object.entries(telemetry.tags)) {
      scope.setTag(key, value)
    }
  }
  if (telemetry.extras) scope.setExtras(telemetry.extras)
}

// eslint-disable-next-line max-lines-per-function
const initTelemetry = (enabled: boolean): void => {
  if (!enabled) {
    log('[TELEMETRY] Disabled (set HYDRABASE_TELEMETRY=true to enable)')
    return
  }
  const release = makeSentryRelease({ app: 'hydrabase', branch: BRANCH, version: VERSION })
  const environment = process.env['NODE_ENV'] ?? 'development'
  const defaultTags = {
    app: 'hydrabase',
    branch: BRANCH,
    runtime: 'bun',
  }

  Sentry.init({
    beforeSend(event) {
      event.tags = {
        ...defaultTags,
        ...(event.tags ?? {}),
      }
      return event
    },
    dsn: 'https://e048333b5d85bdc50499b9de2c440f81@o4511068837314560.ingest.de.sentry.io/4511068838625360',
    enableLogs: true,
    environment,
    integrations: [Sentry.consoleLoggingIntegration({ levels: ['log', 'warn', 'error'] })],
    release,
    sendDefaultPii: true,
    tracesSampleRate: 1.0,
  })

  log(`[TELEMETRY] Enabled (Sentry) release=${release}`)
  ;(globalThis as typeof globalThis & {
    __hydrabaseSentryLogger__?: unknown
  }).__hydrabaseSentryLogger__ = Sentry.logger
  ;(globalThis as typeof globalThis & {
    __hydrabaseCaptureException__?: (exception: unknown, telemetry?: HydrabaseTelemetryContext) => void
  }).__hydrabaseCaptureException__ = (exception, telemetry) => {
    if (!telemetry) {
      Sentry.captureException(exception)
      return
    }
    Sentry.withScope((scope) => {
      applyTelemetryScope(scope, telemetry)
      Sentry.captureException(exception)
    })
  }
  ;(globalThis as typeof globalThis & {
    __hydrabaseLogEvent__?: (event: {
      category: string
      context?: unknown
      level: 'debug' | 'error' | 'info' | 'warning'
      message: string
    }) => void
  }).__hydrabaseLogEvent__ = (event: {
    category: string
    context?: unknown
    level: 'debug' | 'error' | 'info' | 'warning'
    message: string
  }) => {
    Sentry.addBreadcrumb({
      category: event.category,
      data: event.context && typeof event.context === 'object' ? (event.context as Record<string, unknown>) : { context: event.context },
      level: event.level,
      message: event.message,
      timestamp: Date.now() / 1000,
      type: 'default',
    })
  }
}

process.on('unhandledRejection', (err) => error('ERROR:', '[MAIN] Unhandled rejection', {err}))
process.on('uncaughtException', (err) => error('ERROR:', '[MAIN] Uncaught exception', {err}))

const { config, envLockedPaths } = await createLiveConfig({ env: process.env })
initTelemetry(config.telemetry)
await startNode(config, envLockedPaths)
// TODO: Merge duplicate artists from diff plugins
