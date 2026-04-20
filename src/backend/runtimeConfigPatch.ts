import type { Config, RuntimeConfigPatch } from '../types/hydrabase'

const setIfDefined = <T>(value: T | undefined, updater: (nextValue: T) => void): void => {
  if (value !== undefined) updater(value)
}

const filterNestedPatch = <T extends object>(
  section: Partial<T> | undefined,
  pathPrefix: string,
  envLockedPathSet: ReadonlySet<string>,
): Partial<T> | undefined => {
  if (!section) return undefined

  const filteredSection = Object.fromEntries(Object.entries(section).filter(([key]) => !envLockedPathSet.has(`${pathPrefix}.${key}`))) as Partial<T>
  if (Object.keys(filteredSection).length === 0) return undefined

  return filteredSection
}

export const applyRuntimePatch = (target: Config, patch: RuntimeConfigPatch): void => {
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

export const stripAutoManagedNodeFields = (patch: null | RuntimeConfigPatch): null | RuntimeConfigPatch => {
  if (!patch?.node) return patch

  const nextNode = Object.fromEntries(Object.entries(patch.node).filter(([key]) => key !== 'ip')) as Partial<Config['node']>
  if (Object.keys(nextNode).length === 0) {
    const rest = { ...patch }
    delete rest.node
    return rest
  }

  return { ...patch, node: nextNode }
}

export const stripEnvLockedFields = (patch: null | RuntimeConfigPatch, envLockedPathSet: ReadonlySet<string>): null | RuntimeConfigPatch => {
  if (!patch) return patch

  const nextPatch: RuntimeConfigPatch = { ...patch }
  if (envLockedPathSet.has('apiKey')) delete nextPatch.apiKey
  if (envLockedPathSet.has('bootstrapPeers')) delete nextPatch.bootstrapPeers
  if (envLockedPathSet.has('soulIdCutoff')) delete nextPatch.soulIdCutoff
  if (envLockedPathSet.has('telemetry')) delete nextPatch.telemetry

  const nextDht = filterNestedPatch(nextPatch.dht, 'dht', envLockedPathSet)
  if (nextDht) nextPatch.dht = nextDht
  else delete nextPatch.dht

  const nextFormulas = filterNestedPatch(nextPatch.formulas, 'formulas', envLockedPathSet)
  if (nextFormulas) nextPatch.formulas = nextFormulas
  else delete nextPatch.formulas

  const nextNode = filterNestedPatch(nextPatch.node, 'node', envLockedPathSet)
  if (nextNode) nextPatch.node = nextNode
  else delete nextPatch.node

  const nextRpc = filterNestedPatch(nextPatch.rpc, 'rpc', envLockedPathSet)
  if (nextRpc) nextPatch.rpc = nextRpc
  else delete nextPatch.rpc

  const nextUpnp = filterNestedPatch(nextPatch.upnp, 'upnp', envLockedPathSet)
  if (nextUpnp) nextPatch.upnp = nextUpnp
  else delete nextPatch.upnp

  return nextPatch
}