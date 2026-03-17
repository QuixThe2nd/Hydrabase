/* eslint-disable no-console */
type Context = `- ${string}` | Event | Record<string, unknown>

type AsyncLocalStorageType = { getStore(): { contexts: string[] } | undefined; run<T>(store: { contexts: string[] }, callback: () => T): T }
let asyncLocalStorage: AsyncLocalStorageType | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AsyncLocalStorage } = require('async_hooks') as { AsyncLocalStorage: new () => AsyncLocalStorageType }
  asyncLocalStorage = new AsyncLocalStorage()
} catch { /* browser environment — logContext is a no-op */ }

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
  if (store) {
    const contextPrefix = store.contexts.map(ctx => `[${ctx}]`).join(' ')
    return `${contextPrefix} ${message}`
  }
  return message
}

export const error = (level: 'ERROR:', message: string, context?: Context): false => {
  const formattedMessage = formatMessage(message)
  if (context === undefined) console.error(time(), red(level), red(formattedMessage))
  else console.error(time(), red(level), red(formattedMessage), context)
  return false
}
export const warn = (level: 'DEVWARN:' | 'WARN:', message: string, context?: Context): false => {
  const formattedMessage = formatMessage(message)
  if (context === undefined) console.warn(time(), yellow(level), yellow(formattedMessage))
  else console.warn(time(), yellow(level), yellow(formattedMessage), context)
  return false
}
export const stats = (message: string, context?: Context): void => {
  const formattedMessage = formatMessage(message)
  return context === undefined ? console.log(time(), blue('STAT:'), blue(formattedMessage)) : console.log(time(), blue('STAT:'), blue(formattedMessage), context)
}
export const debug = (message: string, context?: Context): void => {
  const formattedMessage = formatMessage(message)
  return context === undefined ? console.log(time(), grey('DEBUG:'), grey(formattedMessage)) : console.log(time(), grey('DEBUG:'), grey(formattedMessage), context)
}
export const log = (message: string, context?: Context): void => {
  const formattedMessage = formatMessage(message)
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
