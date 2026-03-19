/* eslint-disable no-console */
import type { AsyncLocalStorage as ALS } from 'node:async_hooks'

export type HydrabaseGlobal = typeof globalThis & {
  __hydrabaseCaptureException__?: (exception: unknown) => void
  __hydrabaseLogEvent__?: (event: {
    category: string
    context?: unknown
    level: 'debug' | 'error' | 'info' | 'warning'
    message: string
  }) => void
  __hydrabaseSentryLogger__?: {
    debug: (message: string, data?: Record<string, unknown>) => void
    error: (message: string, data?: Record<string, unknown>) => void
    info: (message: string, data?: Record<string, unknown>) => void
    warn: (message: string, data?: Record<string, unknown>) => void
  }
}

export const getSentryLogger = (): HydrabaseGlobal['__hydrabaseSentryLogger__'] => {
  const globalWithCapture = globalThis as HydrabaseGlobal
  return globalWithCapture.__hydrabaseSentryLogger__
}

export const captureException = (exception: unknown): void => {
  const globalWithCapture = globalThis as HydrabaseGlobal
  globalWithCapture.__hydrabaseCaptureException__?.(exception)
}

export const logEvent = (event: {
  category: string
  context?: unknown
  level: 'debug' | 'error' | 'info' | 'warning'
  message: string
}): void => {
  const globalWithCapture = globalThis as HydrabaseGlobal
  globalWithCapture.__hydrabaseLogEvent__?.(event)
}

type Context = `- ${string}` | Event | Record<string, unknown>

let asyncLocalStorage: ALS<{ contexts: string[] }> | undefined
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AsyncLocalStorage } = require('node:async_hooks') as typeof import('node:async_hooks')
  asyncLocalStorage = new AsyncLocalStorage()
} catch {
  // Browser environment — AsyncLocalStorage not available, log context prefixes disabled
}

export const logContext = <T>(context: string, callback: () => T): T => {
  if (!asyncLocalStorage) return callback()
  const store = asyncLocalStorage.getStore()
  const contexts = store ? [...store.contexts, context] : [context]
  return asyncLocalStorage.run({ contexts }, callback)
}

const time = () => (new Date()).toISOString()

const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const grey = (s: string) => `\x1b[90m${s}\x1b[0m`
const blue = (s: string) => `\x1b[94m${s}\x1b[0m`

const formatMessage = (message: string): string => {
  const store = asyncLocalStorage?.getStore()
  if (!store) return message
  const contextPrefix = store.contexts.map(ctx => `[${ctx}]`).join(' ')
  return `${contextPrefix} ${message}`
}

const contextToData = (context?: Context): Record<string, unknown> | undefined => {
  if (context === undefined) return undefined
  if (typeof context === 'string') return { context }
  if (typeof context === 'object' && context !== null) return context as Record<string, unknown>
  return { context }
}

const exceptionFromContext = (message: string, context?: Context): unknown => {
  if (context instanceof Error) return context
  if (context && typeof context === 'object') {
    const record = context as Record<string, unknown>
    const keysToCheck = ['err', 'error', 'e'] as const
    for (const key of keysToCheck) {
      const value = record[key]
      if (value instanceof Error) return value
    }
    for (const value of Object.values(record)) {
      if (value instanceof Error) return value
    }
  }
  return new Error(message)
}

export const error = (level: 'ERROR:', message: string, context?: Context): false => {
  const formattedMessage = formatMessage(message)
  if (context === undefined) console.error(time(), red(level), red(formattedMessage))
  else console.error(time(), red(level), red(formattedMessage), context)
  logEvent({ category: 'log', context, level: 'error', message: formattedMessage })
  getSentryLogger()?.error(formattedMessage, contextToData(context))
  captureException(exceptionFromContext(formattedMessage, context))
  return false
}
export const warn = (level: 'DEVWARN:' | 'WARN:', message: string, context?: Context): false => {
  const formattedMessage = formatMessage(message)
  if (context === undefined) console.warn(time(), yellow(level), yellow(formattedMessage))
  else console.warn(time(), yellow(level), yellow(formattedMessage), context)
  logEvent({ category: 'log', context, level: 'warning', message: formattedMessage })
  getSentryLogger()?.warn(formattedMessage, contextToData(context))
  return false
}
export const stats = (message: string, context?: Context): void => {
  const formattedMessage = formatMessage(message)
  logEvent({ category: 'stats', context, level: 'info', message: formattedMessage })
  getSentryLogger()?.info(formattedMessage, contextToData(context))
  return context === undefined ? console.log(time(), blue('STAT:'), blue(formattedMessage)) : console.log(time(), blue('STAT:'), blue(formattedMessage), context)
}
export const debug = (message: string, context?: Context): void => {
  const formattedMessage = formatMessage(message)
  logEvent({ category: 'debug', context, level: 'debug', message: formattedMessage })
  getSentryLogger()?.debug(formattedMessage, contextToData(context))
  return context === undefined ? console.log(time(), grey('DEBUG:'), grey(formattedMessage)) : console.log(time(), grey('DEBUG:'), grey(formattedMessage), context)
}
export const log = (message: string, context?: Context): void => {
  const formattedMessage = formatMessage(message)
  logEvent({ category: 'log', context, level: 'info', message: formattedMessage })
  getSentryLogger()?.info(formattedMessage, contextToData(context))
  return context === undefined ? console.log(time(), 'LOG:', formattedMessage) : console.log(time(), 'LOG:', formattedMessage, context)
}

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`
}

export const formatUptime = (ms: number): string => {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${minutes % 60}m`
}

export const truncateAddress = (address: string): string => 
  address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address
