import type { Config, RuntimeConfigEnvVar } from './hydrabase'

export const CONFIG_LEGACY_ENV_ALIASES: Readonly<Record<string, readonly string[]>> = {
  apiKey: ['API_KEY'],
  'node.bio': ['BIO'],
  'node.hostname': ['DOMAIN'],
  'node.port': ['PORT'],
  'node.username': ['USERNAME'],
}

export const toEnvKey = (path: string): string => `HYDRABASE_${path.replace(/\./gu, '_').toUpperCase()}`

export const collectLeafPaths = (value: unknown, prefix = ''): string[] => {
  if (typeof value !== 'object' || value === null) return prefix ? [prefix] : []

  const entries = Object.entries(value)
  if (entries.length === 0) return prefix ? [prefix] : []

  return entries.flatMap(([key, child]) => collectLeafPaths(child, prefix ? `${prefix}.${key}` : key))
}

export const toRuntimeConfigEnvVars = (config: Config): RuntimeConfigEnvVar[] => collectLeafPaths(config).map(path => ({
  aliases: [...(CONFIG_LEGACY_ENV_ALIASES[path] ?? [])],
  env: toEnvKey(path),
  path,
}))