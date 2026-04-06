import ipLookup from '@iplookup/country'
import { countryCodeEmoji } from 'country-code-emoji'

import type { Config, NodeStats, PartialNodeStats, RuntimeConfigEnvVar } from '../types/hydrabase'

interface DnsAnswer {
  data?: string
  type?: number
}

interface DnsResponse {
  Answer?: DnsAnswer[]
}

export const fmt = (n: null | number | undefined, d = 1): string => n === null ? '—' : Number(n).toFixed(d)

export const fmtBytes = (bytes: number): string => bytes > 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(2)}MB`
  : bytes > 1024
  ? `${(bytes / 1024).toFixed(2)}KB`
  : `${bytes}B`

export const shortAddr = (a?: null | string): string => a ? `${a.slice(0, 10)}…${a.slice(-6)}` : '—'

export const parseWsHost = (wsUrl: string): { hostname: string; port: number } => {
  const url = new URL(wsUrl)
  return { hostname: url.hostname, port: Number(url.port) }
}

const fmtDuration = (totalSeconds: number): string => {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor(seconds / 3_600) % 24
  const minutes = Math.floor(seconds / 60) % 60
  const secs = seconds % 60

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m ${secs}s`
}

export const fmtUptime = (ms: number): string => fmtDuration(ms / 1_000)

export const fmtClock = (seconds: number): string => fmtDuration(seconds)

export const toEmoji = (country: string): string => country === 'N/A' || country === '-' ? '🌐' : countryCodeEmoji(country)

const ipMap = new Map<string, string>()
const resolvedHostMap = new Map<string, Promise<null | string>>()

const IPV4_PART = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4_REGEX = new RegExp(`^(?:${IPV4_PART}\\.){3}${IPV4_PART}$`, 'u')
const IPV6_REGEX = /^[\da-f:]+$/iu

const isIpAddress = (hostname: string): boolean => IPV4_REGEX.test(hostname) || (hostname.includes(':') && IPV6_REGEX.test(hostname))

const normalizeHostname = (hostname: string): string => hostname.replace(/^\[(?<host>[^\]]+)\]$/u, '$<host>').replace(/\.$/u, '').toLowerCase()

const LEGACY_ENV_ALIASES: Record<string, string[]> = {
  apiKey: ['API_KEY'],
  'node.bio': ['BIO'],
  'node.hostname': ['DOMAIN'],
  'node.port': ['PORT'],
  'node.username': ['USERNAME'],
  telemetry: ['HYDRABASE_TELEMETRY'],
}

const toEnvKey = (path: string): string => `HYDRABASE_${path.replace(/\./gu, '_').toUpperCase()}`

const collectLeafPaths = (value: unknown, prefix = ''): string[] => {
  if (typeof value !== 'object' || value === null) return prefix ? [prefix] : []

  const entries = Object.entries(value)
  if (entries.length === 0) return prefix ? [prefix] : []

  return entries.flatMap(([key, child]) => collectLeafPaths(child, prefix ? `${prefix}.${key}` : key))
}

export const getConfigurableEnvVarsFromConfig = (config: Config): RuntimeConfigEnvVar[] => collectLeafPaths(config).map(path => ({
  aliases: LEGACY_ENV_ALIASES[path] ?? [],
  env: toEnvKey(path),
  path,
}))

export const parseEndpoint = (endpoint: string): { hostname: string; port: null | number } => {
  try {
    const url = new URL(endpoint.includes('://') ? endpoint : `ws://${endpoint}`)
    return { hostname: normalizeHostname(url.hostname), port: url.port ? Number(url.port) : null }
  } catch {
    const [hostname = '', port] = endpoint.split(':')
    return { hostname: normalizeHostname(hostname), port: port ? Number(port) || null : null }
  }
}

const lookupDnsRecord = async (hostname: string, recordType: 'A' | 'AAAA'): Promise<null | string> => {
  try {
    const response = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=${recordType}`, {
      headers: { accept: 'application/dns-json' },
    })
    if (!response.ok) return null

    const payload = await response.json() as DnsResponse
    const answer = payload.Answer?.find(({ data, type }) => Boolean(data) && (recordType === 'A' ? type === 1 : type === 28))
    return answer?.data ?? null
  } catch {
    return null
  }
}

export const resolveHostnameToIp = (hostname: string): Promise<null | string> => {
  const normalizedHostname = normalizeHostname(hostname)
  if (!normalizedHostname || isIpAddress(normalizedHostname)) return Promise.resolve(normalizedHostname || null)

  const pendingResolution = resolvedHostMap.get(normalizedHostname)
  if (pendingResolution) return pendingResolution

  const resolution = (async () => {
    const ipv4 = await lookupDnsRecord(normalizedHostname, 'A')
    if (ipv4) return ipv4
    return lookupDnsRecord(normalizedHostname, 'AAAA')
  })()

  resolvedHostMap.set(normalizedHostname, resolution)
  return resolution
}

export const getCountry = async (ip: string): Promise<string> => {
  const known = ipMap.get(ip)
  if (known) return known
  const result = await ipLookup(ip)
  if (!result || !('country' in result) || !result.country) return 'N/A'
  const { country } = result
  ipMap.set(ip, country)
  return country
}

export const getCountryForHost = async (endpoint: string): Promise<string> => {
  const { hostname } = parseEndpoint(endpoint)
  const resolvedIp = await resolveHostnameToIp(hostname)
  return resolvedIp ? getCountry(resolvedIp) : 'N/A'
}

export const mergePartialStats = (current: NodeStats | null, partial: PartialNodeStats): NodeStats => {
  if (!current) {
    return {
      dhtNodes: partial.dhtNodes ?? [],
      peers: {
        known: partial.peers?.known ?? [],
        plugins: partial.peers?.plugins ?? [],
        pluginVotes: partial.peers?.pluginVotes ?? {},
        votes: partial.peers?.votes ?? { albums: 0, artists: 0, tracks: 0 },
      },
      self: {
        address: partial.self?.address ?? ('0x0' as const),
        hostname: partial.self?.hostname ?? '',
        nodeStartTime: partial.self?.nodeStartTime ?? Date.now(),
        plugins: partial.self?.plugins ?? [],
        pluginVotes: partial.self?.pluginVotes ?? {},
        votes: partial.self?.votes ?? { albums: 0, artists: 0, tracks: 0 },
      },

    }
  }

  return {
    dhtNodes: partial.dhtNodes ?? current.dhtNodes,
    peers: {
      known: partial.peers?.known ?? current.peers.known,
      plugins: partial.peers?.plugins ?? current.peers.plugins,
      pluginVotes: partial.peers?.pluginVotes ?? current.peers.pluginVotes,
      votes: partial.peers?.votes ?? current.peers.votes,
    },
    self: {
      address: partial.self?.address ?? current.self.address,
      hostname: partial.self?.hostname ?? current.self.hostname,
      nodeStartTime: partial.self?.nodeStartTime ?? current.self.nodeStartTime,
      plugins: partial.self?.plugins ?? current.self.plugins,
      pluginVotes: partial.self?.pluginVotes ?? current.self.pluginVotes,
      votes: partial.self?.votes ?? current.self.votes,
    },
  }
}
