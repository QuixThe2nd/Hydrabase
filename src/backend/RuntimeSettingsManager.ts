import type { Config, RuntimeConfigPatch, RuntimeConfigSnapshot, RuntimeConfigUpdate } from '../types/hydrabase'
import type { Repositories } from './db'

import { warn } from '../utils/log'
import { CONFIGURABLE_ENV_VARS } from './config'

const KEY_DESIRED_CONFIG = 'runtime.config.desired'

const USERNAME_REGEX = /^[a-zA-Z0-9]{3,20}$/u
const LIVE_UPDATE_PATHS = [
  'formulas.finalConfidence',
  'formulas.pluginConfidence',
  'node.bio',
  'node.connectMessage',
  'node.preferTransport',
  'node.username',
] as const
const ALL_CONFIG_PATHS = [
  'apiKey',
  'bootstrapPeers',
  'dht.bootstrapNodes',
  'dht.reannounce',
  'dht.requireReady',
  'dht.roomSeed',
  'formulas.finalConfidence',
  'formulas.pluginConfidence',
  'node.bio',
  'node.connectMessage',
  'node.hostname',
  'node.ip',
  'node.listenAddress',
  'node.port',
  'node.preferTransport',
  'node.username',
  'rpc.prefix',
  'soulIdCutoff',
  'telemetry',
  'upnp.reannounce',
  'upnp.ttl',
] as const
const LIVE_UPDATE_PATH_SET = new Set<string>(LIVE_UPDATE_PATHS)
const RESTART_REQUIRED_PATHS = ALL_CONFIG_PATHS.filter(path => !LIVE_UPDATE_PATH_SET.has(path))

const cloneConfig = (config: Config): Config => JSON.parse(JSON.stringify(config)) as Config

const toSettingValue = (value: RuntimeConfigPatch): string => JSON.stringify(value)

const fromSettingValue = (value: string): null | RuntimeConfigPatch => {
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as RuntimeConfigPatch
  } catch {
    return null
  }
}

const getPathValue = (config: Config, path: string): unknown => path.split('.').reduce<unknown>((current, key) => {
  if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
  return (current as Record<string, unknown>)[key]
}, config)

const setIfDefined = <T>(value: T | undefined, updater: (nextValue: T) => void): void => {
  if (value !== undefined) updater(value)
}

const normalizeLoadedPatch = (patch: RuntimeConfigPatch): { normalizedPatch: RuntimeConfigPatch; warnings: string[] } => {
  const warnings: string[] = []
  const normalizedPatch: RuntimeConfigPatch = { ...patch }

  const telemetryValue = (normalizedPatch as Record<string, unknown>)['telemetry']
  if (telemetryValue !== undefined && typeof telemetryValue !== 'boolean') {
    if (typeof telemetryValue === 'string') {
      const nextTelemetry = telemetryValue.trim().toLowerCase()
      if (nextTelemetry === 'true') normalizedPatch.telemetry = true
      else if (nextTelemetry === 'false') normalizedPatch.telemetry = false
      else delete normalizedPatch.telemetry
    } else if (telemetryValue === 1) normalizedPatch.telemetry = true
    else if (telemetryValue === 0) normalizedPatch.telemetry = false
    else delete normalizedPatch.telemetry
    if (normalizedPatch.telemetry === undefined) warnings.push('[SETTINGS] Ignoring invalid persisted telemetry value (expected boolean)')
  }

  return { normalizedPatch, warnings }
}

export class RuntimeSettingsManager {
  private readonly desiredConfig: Config
  private readonly envLockedPathSet: ReadonlySet<string>

  constructor(
    private readonly activeConfig: Config,
    private readonly repos: Repositories,
    private readonly onPluginConfidenceFormulaChanged: (formula: string) => void,
    envLockedPaths: string[] = [],
  ) {
    this.desiredConfig = cloneConfig(activeConfig)
    this.envLockedPathSet = new Set(envLockedPaths)
  }

  private static applyPatch(target: Config, patch: RuntimeConfigPatch): void {
    setIfDefined(patch.apiKey, value => { target.apiKey = value })
    setIfDefined(patch.bootstrapPeers, value => { target.bootstrapPeers = value })
    setIfDefined(patch.soulIdCutoff, value => { target.soulIdCutoff = value })

    if (patch.dht) target.dht = { ...target.dht, ...patch.dht }
    if (patch.formulas) target.formulas = { ...target.formulas, ...patch.formulas }
    if (patch.node) target.node = { ...target.node, ...patch.node }
    if (patch.rpc) target.rpc = { ...target.rpc, ...patch.rpc }
    if (patch.telemetry !== undefined) target.telemetry = patch.telemetry
    if (patch.upnp) target.upnp = { ...target.upnp, ...patch.upnp }
  }

  private static stripAutoManagedNodeFields(patch: null | RuntimeConfigPatch): null | RuntimeConfigPatch {
    if (!patch?.node) return patch
    const nextNode = Object.fromEntries(Object.entries(patch.node).filter(([key]) => key !== 'ip')) as Partial<Config['node']>
    if (Object.keys(nextNode).length === 0) {
      const rest = { ...patch }
      delete rest.node
      return rest
    }
    return { ...patch, node: nextNode }
  }

  private static stripEnvLockedFields(patch: null | RuntimeConfigPatch, envLockedPathSet: ReadonlySet<string>): null | RuntimeConfigPatch {
    if (!patch) return patch
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
      const nextNode = Object.fromEntries(Object.entries(nextPatch.node).filter(([key]) => !envLockedPathSet.has(`node.${key}`))) as Partial<Config['node']>
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

  private static toPersistedPatch(config: Config): RuntimeConfigPatch {
    const patch = cloneConfig(config) as unknown as RuntimeConfigPatch
    return RuntimeSettingsManager.stripAutoManagedNodeFields(patch) ?? {}
  }

  private static validatePatch(patch: RuntimeConfigPatch): void {
    if (patch.apiKey !== undefined && typeof patch.apiKey !== 'string') throw new Error('apiKey must be a string')
    if (patch.bootstrapPeers !== undefined && typeof patch.bootstrapPeers !== 'string') throw new Error('bootstrapPeers must be a string')

    if (patch.dht) {
      if (patch.dht.bootstrapNodes !== undefined && typeof patch.dht.bootstrapNodes !== 'string') throw new Error('dht.bootstrapNodes must be a string')
      if (patch.dht.reannounce !== undefined && (!Number.isFinite(patch.dht.reannounce) || patch.dht.reannounce <= 0)) throw new Error('dht.reannounce must be a positive number')
      if (patch.dht.requireReady !== undefined && typeof patch.dht.requireReady !== 'boolean') throw new Error('dht.requireReady must be a boolean')
      if (patch.dht.roomSeed !== undefined && typeof patch.dht.roomSeed !== 'string') throw new Error('dht.roomSeed must be a string')
    }

    if (patch.formulas) {
      if (patch.formulas.finalConfidence !== undefined && typeof patch.formulas.finalConfidence !== 'string') throw new Error('formulas.finalConfidence must be a string')
      if (patch.formulas.pluginConfidence !== undefined && typeof patch.formulas.pluginConfidence !== 'string') throw new Error('formulas.pluginConfidence must be a string')
    }

    if (patch.node) {
      if (patch.node.bio !== undefined) {
        if (typeof patch.node.bio !== 'string') throw new Error('node.bio must be a string')
        if (patch.node.bio.trim().length > 140) throw new Error('node.bio must be 140 characters or less')
      }
      if (patch.node.connectMessage !== undefined) {
        if (typeof patch.node.connectMessage !== 'string') throw new Error('node.connectMessage must be a string')
        if (patch.node.connectMessage.trim().length === 0) throw new Error('node.connectMessage cannot be empty')
        if (patch.node.connectMessage.trim().length > 280) throw new Error('node.connectMessage must be 280 characters or less')
      }
      if (patch.node.hostname !== undefined && typeof patch.node.hostname !== 'string') throw new Error('node.hostname must be a string')
      if (patch.node.ip !== undefined && typeof patch.node.ip !== 'string') throw new Error('node.ip must be a string')
      if (patch.node.listenAddress !== undefined && typeof patch.node.listenAddress !== 'string') throw new Error('node.listenAddress must be a string')
      if (patch.node.port !== undefined && (!Number.isInteger(patch.node.port) || patch.node.port <= 0 || patch.node.port > 65535)) throw new Error('node.port must be an integer between 1 and 65535')
      if (patch.node.preferTransport !== undefined && patch.node.preferTransport !== 'TCP' && patch.node.preferTransport !== 'UTP') throw new Error('node.preferTransport must be TCP or UTP')
      if (patch.node.username !== undefined) {
        if (typeof patch.node.username !== 'string') throw new Error('node.username must be a string')
        if (!USERNAME_REGEX.test(patch.node.username.trim())) throw new Error('Username must be 3-20 alphanumeric characters with no spaces')
      }
    }

    if (patch.rpc?.prefix !== undefined && typeof patch.rpc.prefix !== 'string') throw new Error('rpc.prefix must be a string')

    if (patch.soulIdCutoff !== undefined && (!Number.isInteger(patch.soulIdCutoff) || patch.soulIdCutoff <= 0)) throw new Error('soulIdCutoff must be a positive integer')

    if (patch.telemetry !== undefined && typeof patch.telemetry !== 'boolean') throw new Error('telemetry must be a boolean')

    if (patch.upnp) {
      if (patch.upnp.reannounce !== undefined && (!Number.isFinite(patch.upnp.reannounce) || patch.upnp.reannounce <= 0)) throw new Error('upnp.reannounce must be a positive number')
      if (patch.upnp.ttl !== undefined && (!Number.isFinite(patch.upnp.ttl) || patch.upnp.ttl <= 0)) throw new Error('upnp.ttl must be a positive number')
    }
  }

  getSnapshot(): RuntimeConfigSnapshot {
    return {
      active: cloneConfig(this.activeConfig),
      configurableEnvVars: CONFIGURABLE_ENV_VARS.map(entry => ({ aliases: [...entry.aliases], env: entry.env, path: entry.path })),
      desired: cloneConfig(this.desiredConfig),
      envLockedPaths: [...this.envLockedPathSet],
      liveUpdatePaths: [...LIVE_UPDATE_PATHS],
      pendingRestartPaths: RESTART_REQUIRED_PATHS.filter(path => getPathValue(this.activeConfig, path) !== getPathValue(this.desiredConfig, path)),
    }
  }

  loadFromStorage(): void {
    const [stored] = this.repos.settings.getByKeys([KEY_DESIRED_CONFIG])
    if (!stored) return
    const parsed = RuntimeSettingsManager.stripEnvLockedFields(
      RuntimeSettingsManager.stripAutoManagedNodeFields(fromSettingValue(stored.value)),
      this.envLockedPathSet,
    )
    if (!parsed) return

    const { normalizedPatch, warnings: normalizationWarnings } = normalizeLoadedPatch(parsed)
    for (const message of normalizationWarnings) warn('WARN:', message)

    try {
      RuntimeSettingsManager.validatePatch(normalizedPatch)
      RuntimeSettingsManager.applyPatch(this.desiredConfig, normalizedPatch)
      this.applyDesiredToActive()
    } catch (err) {
      warn('WARN:', `[SETTINGS] Failed to load runtime settings from storage: ${String(err)}`)
    }
  }

  update(update: RuntimeConfigUpdate, updatedBy: string): RuntimeConfigSnapshot {
    const patch = RuntimeSettingsManager.stripEnvLockedFields(
      RuntimeSettingsManager.stripAutoManagedNodeFields(update.config ?? {}),
      this.envLockedPathSet,
    ) ?? {}
    RuntimeSettingsManager.validatePatch(patch)
    RuntimeSettingsManager.applyPatch(this.desiredConfig, patch)
    this.applyLivePatchToActive(patch)

    this.repos.settings.upsertMany([
      {
        key: KEY_DESIRED_CONFIG,
        updatedAt: Date.now(),
        updatedBy,
        value: toSettingValue(RuntimeSettingsManager.toPersistedPatch(this.desiredConfig)),
      },
    ])

    return this.getSnapshot()
  }

  private applyDesiredToActive(): void {
    this.activeConfig.apiKey = this.desiredConfig.apiKey
    this.activeConfig.bootstrapPeers = this.desiredConfig.bootstrapPeers
    this.activeConfig.dht = { ...this.desiredConfig.dht }
    this.activeConfig.formulas = { ...this.desiredConfig.formulas }
    this.activeConfig.node = { ...this.desiredConfig.node }
    this.activeConfig.rpc = { ...this.desiredConfig.rpc }
    this.activeConfig.soulIdCutoff = this.desiredConfig.soulIdCutoff
    this.activeConfig.telemetry = this.desiredConfig.telemetry
    this.activeConfig.upnp = { ...this.desiredConfig.upnp }
    this.onPluginConfidenceFormulaChanged(this.activeConfig.formulas.pluginConfidence)
  }

  private applyLivePatchToActive(patch: RuntimeConfigPatch): void {
    if (patch.formulas?.finalConfidence !== undefined) this.activeConfig.formulas.finalConfidence = patch.formulas.finalConfidence
    if (patch.formulas?.pluginConfidence !== undefined) {
      this.activeConfig.formulas.pluginConfidence = patch.formulas.pluginConfidence
      this.onPluginConfidenceFormulaChanged(patch.formulas.pluginConfidence)
    }
    if (patch.node?.bio !== undefined) this.activeConfig.node.bio = patch.node.bio
    if (patch.node?.connectMessage !== undefined) this.activeConfig.node.connectMessage = patch.node.connectMessage
    if (patch.node?.preferTransport !== undefined) this.activeConfig.node.preferTransport = patch.node.preferTransport
    if (patch.node?.username !== undefined) this.activeConfig.node.username = patch.node.username
  }
}
