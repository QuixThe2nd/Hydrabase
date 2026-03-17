/* eslint-disable no-console */
type Context = `- ${string}` | Event | Record<string, unknown>
type Message = `[${string}] ${string}`

const time = () => (new Date()).toISOString()

const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const grey = (s: string) => `\x1b[90m${s}\x1b[0m`
const blue = (s: string) => `\x1b[94m${s}\x1b[0m`

export const error = (level: 'ERROR:', message: Message, context?: Context): false => {
  if (context === undefined) console.error(time(), red(level), red(message))
  else console.error(time(), red(level), red(message), context)
  return false
}
export const warn = (level: 'DEVWARN:' | 'WARN:', message: Message, context?: Context): false => {
  if (context === undefined) console.warn(time(), yellow(level), yellow(message))
  else console.warn(time(), yellow(level), yellow(message), context)
  return false
}
export const stats = (message: Message, context?: Context): void => context === undefined ? console.log(time(), blue('STAT:'), blue(message)) : console.log(time(), blue('STAT:'), blue(message), context)
export const debug = (message: Message, context?: Context): void => context === undefined ? console.log(time(), grey('DEBUG:'), grey(message)) : console.log(time(), grey('DEBUG:'), grey(message), context)
export const log = (message: Message, context?: Context): void => context === undefined ? console.log(time(), 'LOG:', message) : console.log(time(), 'LOG:', message, context)

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
