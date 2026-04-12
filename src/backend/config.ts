
import dgram from 'dgram'
import net from 'net'

import type { Config, RuntimeConfigPatch } from '../types/hydrabase'

import { warn } from '../utils/log'
import { getIp } from './networking/utils'

export const DEFAULT_CONFIG: Config = {
  apiKey: undefined,
  bootstrapPeers: 'ddns.yazdani.au:4543,ddns.yazdani.au:4544,ddns.yazdani.au:4545,bob.yazdani.au:4545',
  dht: {
    bootstrapNodes: 'router.bittorrent.com:6881,router.utorrent.com:6881,dht.transmissionbt.com:6881,ddns.yazdani.au:4543,ddns.yazdani.au:4544,ddns.yazdani.au:4545,bob.yazdani.au:4545',
    reannounce: 15 * 60 * 1_000,
    requireReady: true,
    roomSeed: 'hydrabase',
  },
  formulas: {
    finalConfidence: 'avg(x, y, z)',
    pluginConfidence: 'x / (x + y)',
  },
  node: {
    bio: 'Welcome to my part of the internet',
    connectMessage: 'Hello!',
    hostname: '127.0.0.1',
    ip: '127.0.0.1',
    listenAddress: '0.0.0.0',
    port: 4545,
    preferTransport: 'UTP',
    username: 'Anonymous',
  },
  rpc: {
    prefix: 'hydra_',
  },
  soulIdCutoff: 32,
  telemetry: false,
  upnp: {
    reannounce: 1_800_000,
    ttl: 3_600_000,
  },
}

type EnvConfigPath = LeafPath<Config>
type LeafPath<T> = {
  [K in keyof T & string]: T[K] extends Primitive
    ? K
    : T[K] extends Record<string, unknown>
      ? `${K}.${LeafPath<T[K]>}`
      : K
}[keyof T & string]
type PathValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? PathValue<T[K], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never

type Primitive = boolean | number | string | undefined

const LEGACY_ENV_ALIASES: Partial<Record<EnvConfigPath, readonly string[]>> = {
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

const ENV_CONFIG_PATH_KEYS = collectLeafPaths(DEFAULT_CONFIG) as EnvConfigPath[]

const getEnvKeysForPath = (path: EnvConfigPath): readonly string[] => [toEnvKey(path), ...(LEGACY_ENV_ALIASES[path] ?? [])]

export const ENV_CONFIG_PATHS: readonly { env: string; path: EnvConfigPath }[] = ENV_CONFIG_PATH_KEYS
  .map(path => ({ env: toEnvKey(path), path }))

export const CONFIGURABLE_ENV_VARS: readonly { aliases: readonly string[]; env: string; path: EnvConfigPath }[] = ENV_CONFIG_PATH_KEYS
  .map(path => ({
    aliases: LEGACY_ENV_ALIASES[path] ?? [],
    env: toEnvKey(path),
    path,
  }))

type EnvConfigInput = Readonly<Record<string, string | undefined>>

const cloneDefaultConfig = (): Config => JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config

const socketHandler = (socket: net.Server, resolve: (value: boolean) => void, reject: (reason: Error) => void) => {
  socket.addListener('listening', () => {
    socket.close()
    resolve(false)
  })
  socket.addListener('error', (err: Error) => {
    socket.close()
    if ((err as unknown as { code?: string }).code === 'EADDRINUSE') resolve(true)
    else reject(err)
  })
}

const isTCPPortInUse = (port: number) => new Promise<boolean>((resolve, reject) => {
  const server = net.createServer()
  socketHandler(server, resolve, reject)
  server.listen(port)
})

const isUDPPortInUse = (port: number) => new Promise<boolean>((resolve, reject) => {
  const socket = dgram.createSocket('udp4')
  socket.once('listening', () => {
    try { socket.close() } catch { /* already closed */ }
    resolve(false)
  })
  socket.once('error', (err: NodeJS.ErrnoException) => {
    try { socket.close() } catch { /* already closed */ }
    if (err.code === 'EADDRINUSE') resolve(true)
    else reject(err)
  })
  socket.bind(port)
})

const getPathValue = <T, P extends LeafPath<T>>(target: T, path: P): PathValue<T, P> => {
  const [head, ...rest] = path.split('.')
  if (!head) throw new Error('Invalid config path')
  let current: unknown = (target as Record<string, unknown>)[head]
  for (const segment of rest) current = (current as Record<string, unknown>)[segment]
  return current as PathValue<T, P>
}

const setPathValue = <T, P extends LeafPath<T>>(target: T, path: P, value: PathValue<T, P>): void => {
  const segments = path.split('.')
  const last = segments.pop()
  if (!last) return

  let current = target as unknown as Record<string, unknown>
  for (const segment of segments) current = current[segment] as Record<string, unknown>
  current[last] = value as unknown
}

const parseEnvValue = <P extends EnvConfigPath>(path: P, raw: string, fallback: PathValue<Config, P>): PathValue<Config, P> => {
  if (path === 'node.preferTransport') {
    if (raw === 'TCP' || raw === 'UTP') return raw as PathValue<Config, P>
    return fallback
  }

  if (typeof fallback === 'number') {
    const parsed = Number(raw)
    return (Number.isFinite(parsed) ? parsed : fallback) as PathValue<Config, P>
  }
  if (typeof fallback === 'boolean') return (raw === 'true') as PathValue<Config, P>
  return raw as PathValue<Config, P>
}

const readEnvValue = (env: EnvConfigInput, path: EnvConfigPath): string | undefined => {
  const envKeys = getEnvKeysForPath(path)
  for (const envKey of envKeys) {
    const value = env[envKey]
    if (value !== undefined) return value
  }
  return undefined
}

const setIfDefined = <T>(value: T | undefined, updater: (nextValue: T) => void): void => {
  if (value !== undefined) updater(value)
}

const applyRuntimePatch = (target: Config, patch: RuntimeConfigPatch): void => {
  setIfDefined(patch.apiKey, value => { target.apiKey = value })
  setIfDefined(patch.bootstrapPeers, value => { target.bootstrapPeers = value })
  setIfDefined(patch.soulIdCutoff, value => { target.soulIdCutoff = value })

  if (patch.dht) target.dht = { ...target.dht, ...patch.dht }
  if (patch.formulas) target.formulas = { ...target.formulas, ...patch.formulas }
  if (patch.node) target.node = { ...target.node, ...patch.node }
  if (patch.rpc) target.rpc = { ...target.rpc, ...patch.rpc }
  if (patch.telemetry !== undefined) target.telemetry = patch.telemetry as Config['telemetry']
  if (patch.upnp) target.upnp = { ...target.upnp, ...patch.upnp }
}

const stripEnvLockedFields = (patch: RuntimeConfigPatch, envLockedPathSet: ReadonlySet<string>): RuntimeConfigPatch => {
  const nextPatch: RuntimeConfigPatch = { ...patch }

  if (envLockedPathSet.has('apiKey')) delete nextPatch.apiKey
  if (envLockedPathSet.has('bootstrapPeers')) delete nextPatch.bootstrapPeers
  if (envLockedPathSet.has('soulIdCutoff')) delete nextPatch.soulIdCutoff
  if (envLockedPathSet.has('telemetry')) delete nextPatch.telemetry

  if (nextPatch.dht) {
    const nextDht = Object.fromEntries(Object.entries(nextPatch.dht).filter(([key]) => !envLockedPathSet.has(`dht.${key}`))) as Partial<Config['dht']>
    if (Object.keys(nextDht).length === 0) delete nextPatch.dht
    else nextPatch.dht = nextDht
  }

  if (nextPatch.formulas) {
    const nextFormulas = Object.fromEntries(Object.entries(nextPatch.formulas).filter(([key]) => !envLockedPathSet.has(`formulas.${key}`))) as Partial<Config['formulas']>
    if (Object.keys(nextFormulas).length === 0) delete nextPatch.formulas
    else nextPatch.formulas = nextFormulas
  }

  if (nextPatch.node) {
    const nextNode = Object.fromEntries(Object.entries(nextPatch.node).filter(([key]) => key !== 'ip' && !envLockedPathSet.has(`node.${key}`))) as Partial<Config['node']>
    if (Object.keys(nextNode).length === 0) delete nextPatch.node
    else nextPatch.node = nextNode
  }

  if (nextPatch.rpc) {
    const nextRpc = Object.fromEntries(Object.entries(nextPatch.rpc).filter(([key]) => !envLockedPathSet.has(`rpc.${key}`))) as Partial<Config['rpc']>
    if (Object.keys(nextRpc).length === 0) delete nextPatch.rpc
    else nextPatch.rpc = nextRpc
  }

  if (nextPatch.upnp) {
    const nextUpnp = Object.fromEntries(Object.entries(nextPatch.upnp).filter(([key]) => !envLockedPathSet.has(`upnp.${key}`))) as Partial<Config['upnp']>
    if (Object.keys(nextUpnp).length === 0) delete nextPatch.upnp
    else nextPatch.upnp = nextUpnp
  }

  return nextPatch
}

const resolvePort = async (env: EnvConfigInput): Promise<number> => {
  const requestedPortRaw = readEnvValue(env, 'node.port') ?? '4545'
  const requestedPortParsed = Number(requestedPortRaw)
  const requestedPort = Number.isInteger(requestedPortParsed) && requestedPortParsed > 0 ? requestedPortParsed : 4545

  let port = requestedPort
  while ((await Promise.all([isTCPPortInUse(port), isUDPPortInUse(port)])).some(Boolean)) port++
  if (port !== requestedPort) warn('WARN:', `[SERVER] Port ${requestedPortRaw} in use - Using ${port} instead`)

  return port
}

export const getEnvLockedPaths = (env: EnvConfigInput): EnvConfigPath[] => ENV_CONFIG_PATHS
  .filter(({ path }) => readEnvValue(env, path) !== undefined)
  .map(({ path }) => path)

export const createLiveConfig = async ({
  env = process.env,
  guiConfig,
}: {
  env?: EnvConfigInput
  guiConfig?: RuntimeConfigPatch
}): Promise<{ config: Config; envLockedPaths: EnvConfigPath[] }> => {
  const ip = await getIp()
  const port = await resolvePort(env)
  const isEnvHostnameLocked = readEnvValue(env, 'node.hostname') !== undefined
  const isEnvIpLocked = readEnvValue(env, 'node.ip') !== undefined
  const envLockedPaths = getEnvLockedPaths(env)
  const envLockedPathSet = new Set(envLockedPaths)

  const config = cloneDefaultConfig()

  for (const path of ENV_CONFIG_PATH_KEYS) {
    const rawValue = readEnvValue(env, path)
    if (rawValue === undefined) continue
    const fallback = getPathValue(config, path)
    setPathValue(config, path, parseEnvValue(path, rawValue, fallback))
  }

  if (!isEnvIpLocked) config.node.ip = ip
  if (!isEnvHostnameLocked && (config.node.hostname.trim().length === 0 || config.node.hostname === DEFAULT_CONFIG.node.hostname)) {
    config.node.hostname = ip
  }
  config.node.port = port
  if (config.node.bio !== undefined) config.node.bio = config.node.bio.slice(0, 140)

  if (guiConfig) {
    const filteredGuiConfig = stripEnvLockedFields(guiConfig, envLockedPathSet)
    applyRuntimePatch(config, filteredGuiConfig)
    if (!isEnvIpLocked) config.node.ip = ip
    if (!isEnvHostnameLocked && (config.node.hostname.trim().length === 0 || config.node.hostname === DEFAULT_CONFIG.node.hostname)) {
      config.node.hostname = ip
    }
    config.node.port = port
  }

  return { config, envLockedPaths }
}
