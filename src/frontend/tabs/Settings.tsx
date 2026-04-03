import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { Config, RuntimeConfigPatch, RuntimeConfigSnapshot, RuntimeConfigUpdate } from '../../types/hydrabase'

import { BORD, MUTED, TEXT } from '../theme'
import { getConfigurableEnvVarsFromConfig } from '../utils'

interface SettingsDraft extends Omit<Config, 'apiKey'> {
  apiKey: string
}

interface SettingsTabProps {
  config: null | RuntimeConfigSnapshot
  error: null | string
  isLoading: boolean
  isRestarting: boolean
  onRefresh: () => Promise<void>
  onRestart: () => void
  onSave: (update: RuntimeConfigUpdate) => Promise<void>
}

const textInputStyle = {
  background: 'rgba(255,255,255,.03)',
  border: `1px solid ${BORD}`,
  borderRadius: 8,
  color: TEXT,
  fontFamily: 'inherit',
  fontSize: 13,
  padding: '9px 10px',
} as const

const toDraft = (source: Config): SettingsDraft => ({
  ...source,
  apiKey: source.apiKey ?? '',
})

const toPatch = (current: SettingsDraft, draft: SettingsDraft, isEnvLocked: (path: string) => boolean): RuntimeConfigPatch => {
  const patch: RuntimeConfigPatch = {}

  if (!isEnvLocked('apiKey') && current.apiKey !== draft.apiKey) patch.apiKey = draft.apiKey
  if (!isEnvLocked('bootstrapPeers') && current.bootstrapPeers !== draft.bootstrapPeers) patch.bootstrapPeers = draft.bootstrapPeers
  if (!isEnvLocked('soulIdCutoff') && current.soulIdCutoff !== draft.soulIdCutoff) patch.soulIdCutoff = draft.soulIdCutoff
  if (!isEnvLocked('telemetry') && JSON.stringify(current.telemetry) !== JSON.stringify(draft.telemetry)) patch.telemetry = draft.telemetry

  const dht: Partial<Config['dht']> = {}
  if (!isEnvLocked('dht.bootstrapNodes') && current.dht.bootstrapNodes !== draft.dht.bootstrapNodes) dht.bootstrapNodes = draft.dht.bootstrapNodes
  if (!isEnvLocked('dht.reannounce') && current.dht.reannounce !== draft.dht.reannounce) dht.reannounce = draft.dht.reannounce
  if (!isEnvLocked('dht.requireReady') && current.dht.requireReady !== draft.dht.requireReady) dht.requireReady = draft.dht.requireReady
  if (!isEnvLocked('dht.roomSeed') && current.dht.roomSeed !== draft.dht.roomSeed) dht.roomSeed = draft.dht.roomSeed
  if (Object.keys(dht).length > 0) patch.dht = dht

  const formulas: Partial<Config['formulas']> = {}
  if (!isEnvLocked('formulas.finalConfidence') && current.formulas.finalConfidence !== draft.formulas.finalConfidence) formulas.finalConfidence = draft.formulas.finalConfidence
  if (!isEnvLocked('formulas.pluginConfidence') && current.formulas.pluginConfidence !== draft.formulas.pluginConfidence) formulas.pluginConfidence = draft.formulas.pluginConfidence
  if (Object.keys(formulas).length > 0) patch.formulas = formulas

  const node: Partial<Config['node']> = {}
  if (!isEnvLocked('node.bio') && current.node.bio !== draft.node.bio) node.bio = draft.node.bio ?? ''
  if (!isEnvLocked('node.connectMessage') && current.node.connectMessage !== draft.node.connectMessage) node.connectMessage = draft.node.connectMessage
  if (!isEnvLocked('node.hostname') && current.node.hostname !== draft.node.hostname) node.hostname = draft.node.hostname
  if (!isEnvLocked('node.listenAddress') && current.node.listenAddress !== draft.node.listenAddress) node.listenAddress = draft.node.listenAddress
  if (!isEnvLocked('node.port') && current.node.port !== draft.node.port) node.port = draft.node.port
  if (!isEnvLocked('node.preferTransport') && current.node.preferTransport !== draft.node.preferTransport) node.preferTransport = draft.node.preferTransport
  if (!isEnvLocked('node.username') && current.node.username !== draft.node.username) node.username = draft.node.username
  if (Object.keys(node).length > 0) patch.node = node

  const rpc: Partial<Config['rpc']> = {}
  if (!isEnvLocked('rpc.prefix') && current.rpc.prefix !== draft.rpc.prefix) rpc.prefix = draft.rpc.prefix
  if (Object.keys(rpc).length > 0) patch.rpc = rpc

  const upnp: Partial<Config['upnp']> = {}
  if (!isEnvLocked('upnp.reannounce') && current.upnp.reannounce !== draft.upnp.reannounce) upnp.reannounce = draft.upnp.reannounce
  if (!isEnvLocked('upnp.ttl') && current.upnp.ttl !== draft.upnp.ttl) upnp.ttl = draft.upnp.ttl
  if (Object.keys(upnp).length > 0) patch.upnp = upnp

  return patch
}

const normalizePatch = (patch: RuntimeConfigPatch): string => JSON.stringify(patch)
const isEmptyPatch = (patch: RuntimeConfigPatch): boolean => normalizePatch(patch) === '{}'

// eslint-disable-next-line max-lines-per-function
export const SettingsTab = ({ config, error, isLoading, isRestarting, onRefresh, onRestart, onSave }: SettingsTabProps) => {
  const [draft, setDraft] = useState<null | SettingsDraft>(null)
  const [saveError, setSaveError] = useState<null | string>(null)
  const [saving, setSaving] = useState(false)
  const envLockedPathSet = useMemo(() => new Set(config?.envLockedPaths ?? []), [config?.envLockedPaths])
  const configurableEnvVars = useMemo(() => {
    if (config?.configurableEnvVars && config.configurableEnvVars.length > 0) return config.configurableEnvVars
    if (!config) return []

    return getConfigurableEnvVarsFromConfig(config.desired)
  }, [config])

  const isEnvLocked = useCallback((path: string): boolean => envLockedPathSet.has(path), [envLockedPathSet])
  const fieldStyle = (path: string) => ({
    ...textInputStyle,
    opacity: isEnvLocked(path) ? 0.7 : 1,
  })

  useEffect(() => {
    if (!config) return
    setDraft(toDraft(config.desired))
    setSaveError(null)
  }, [config])

  const patch = useMemo(() => {
    if (!config || !draft) return null
    return toPatch(toDraft(config.desired), draft, isEnvLocked)
  }, [config, draft, isEnvLocked])

  const dirty = useMemo(() => {
    if (!patch) return false
    return normalizePatch(patch) !== '{}'
  }, [patch])

  const handleSave = async () => {
    if (!draft) return
    if (!config) return
    const parsed: RuntimeConfigPatch = toPatch(toDraft(config.desired), draft, isEnvLocked)
    if (isEmptyPatch(parsed)) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSave({ config: parsed })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return <section style={{ maxWidth: 820 }}>
    <h2 style={{ marginBottom: 8, marginTop: 0 }}>Settings</h2>
    <p style={{ color: MUTED, fontSize: 12, marginBottom: 18, marginTop: 0 }}>
      Fields configured via environment variables are locked and cannot be edited in the UI.
    </p>

    <div style={{ border: `1px solid ${BORD}`, borderRadius: 10, marginBottom: 16, padding: 16 }}>
      {draft && <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ border: `1px solid ${BORD}`, borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginBottom: 10, marginTop: 0 }}>General</h3>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>API Key</span>
              <input disabled={isEnvLocked('apiKey')} onChange={(event) => setDraft((prev) => prev ? { ...prev, apiKey: event.target.value } : prev)} style={fieldStyle('apiKey')} type='text' value={draft.apiKey} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Bootstrap Peers</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, bootstrapPeers: event.target.value } : prev)} style={textInputStyle} type='text' value={draft.bootstrapPeers} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Soul ID Cutoff</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, soulIdCutoff: Number(event.target.value) } : prev)} style={textInputStyle} type='number' value={draft.soulIdCutoff} />
            </label>
            <label style={{ alignItems: 'center', display: 'flex', gap: 8, marginTop: 22 }}>
              <input checked={Boolean(draft.telemetry)} onChange={(event) => setDraft((prev) => prev ? { ...prev, telemetry: event.target.checked } : prev)} type='checkbox' />
              <span style={{ color: MUTED, fontSize: 12 }}>Enable Telemetry (Sentry)</span>
            </label>
          </div>
        </div>

        <div style={{ border: `1px solid ${BORD}`, borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginBottom: 10, marginTop: 0 }}>Node</h3>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Username</span>
              <input disabled={isEnvLocked('node.username')} onChange={(event) => setDraft((prev) => prev ? { ...prev, node: { ...prev.node, username: event.target.value } } : prev)} style={fieldStyle('node.username')} type='text' value={draft.node.username} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Hostname</span>
              <input disabled={isEnvLocked('node.hostname')} onChange={(event) => setDraft((prev) => prev ? { ...prev, node: { ...prev.node, hostname: event.target.value } } : prev)} style={fieldStyle('node.hostname')} type='text' value={draft.node.hostname} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Connect Message</span>
              <input disabled={isEnvLocked('node.connectMessage')} onChange={(event) => setDraft((prev) => prev ? { ...prev, node: { ...prev.node, connectMessage: event.target.value } } : prev)} style={fieldStyle('node.connectMessage')} type='text' value={draft.node.connectMessage} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Bio</span>
              <input disabled={isEnvLocked('node.bio')} onChange={(event) => setDraft((prev) => prev ? { ...prev, node: { ...prev.node, bio: event.target.value } } : prev)} style={fieldStyle('node.bio')} type='text' value={draft.node.bio ?? ''} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Listen Address</span>
              <input disabled={isEnvLocked('node.listenAddress')} onChange={(event) => setDraft((prev) => prev ? { ...prev, node: { ...prev.node, listenAddress: event.target.value } } : prev)} style={fieldStyle('node.listenAddress')} type='text' value={draft.node.listenAddress} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Port</span>
              <input disabled={isEnvLocked('node.port')} onChange={(event) => setDraft((prev) => prev ? { ...prev, node: { ...prev.node, port: Number(event.target.value) } } : prev)} style={fieldStyle('node.port')} type='number' value={draft.node.port} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Preferred Transport</span>
              <select disabled={isEnvLocked('node.preferTransport')} onChange={(event) => setDraft((prev) => prev ? { ...prev, node: { ...prev.node, preferTransport: event.target.value as Config['node']['preferTransport'] } } : prev)} style={fieldStyle('node.preferTransport')} value={draft.node.preferTransport}>
                <option value='TCP'>TCP</option>
                <option value='UTP'>UTP</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Node IP (auto-managed)</span>
              <input disabled style={{ ...textInputStyle, opacity: 0.7 }} type='text' value={draft.node.ip} />
            </label>
          </div>
        </div>

        <div style={{ border: `1px solid ${BORD}`, borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginBottom: 10, marginTop: 0 }}>RPC & DHT</h3>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>RPC Prefix</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, rpc: { ...prev.rpc, prefix: event.target.value } } : prev)} style={textInputStyle} type='text' value={draft.rpc.prefix} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Bootstrap Nodes</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, dht: { ...prev.dht, bootstrapNodes: event.target.value } } : prev)} style={textInputStyle} type='text' value={draft.dht.bootstrapNodes} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Reannounce</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, dht: { ...prev.dht, reannounce: Number(event.target.value) } } : prev)} style={textInputStyle} type='number' value={draft.dht.reannounce} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Room Seed</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, dht: { ...prev.dht, roomSeed: event.target.value } } : prev)} style={textInputStyle} type='text' value={draft.dht.roomSeed} />
            </label>
            <label style={{ alignItems: 'center', display: 'flex', gap: 8, marginTop: 22 }}>
              <input checked={draft.dht.requireReady} disabled={isEnvLocked('dht.requireReady')} onChange={(event) => setDraft((prev) => prev ? { ...prev, dht: { ...prev.dht, requireReady: event.target.checked } } : prev)} type='checkbox' />
              <span style={{ color: MUTED, fontSize: 12 }}>Require Ready</span>
            </label>
          </div>
        </div>

        <div style={{ border: `1px solid ${BORD}`, borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginBottom: 10, marginTop: 0 }}>Formulas</h3>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Plugin Confidence</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, formulas: { ...prev.formulas, pluginConfidence: event.target.value } } : prev)} style={textInputStyle} type='text' value={draft.formulas.pluginConfidence} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Final Confidence</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, formulas: { ...prev.formulas, finalConfidence: event.target.value } } : prev)} style={textInputStyle} type='text' value={draft.formulas.finalConfidence} />
            </label>
          </div>
        </div>

        <div style={{ border: `1px solid ${BORD}`, borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginBottom: 10, marginTop: 0 }}>UPnP</h3>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>UPnP Reannounce</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, upnp: { ...prev.upnp, reannounce: Number(event.target.value) } } : prev)} style={textInputStyle} type='number' value={draft.upnp.reannounce} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>UPnP TTL</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, upnp: { ...prev.upnp, ttl: Number(event.target.value) } } : prev)} style={textInputStyle} type='number' value={draft.upnp.ttl} />
            </label>
          </div>
        </div>
      </div>}

      <div style={{ alignItems: 'center', display: 'flex', gap: 10, marginTop: 14 }}>
        <button disabled={!dirty || isLoading || saving} onClick={handleSave} style={{ background: (!dirty || isLoading || saving) ? 'rgba(88,166,255,.15)' : '#58a6ff', border: 'none', borderRadius: 7, color: '#071224', cursor: (!dirty || isLoading || saving) ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 700, padding: '8px 14px' }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button disabled={isLoading || saving} onClick={onRefresh} style={{ background: 'transparent', border: `1px solid ${BORD}`, borderRadius: 7, color: TEXT, cursor: isLoading || saving ? 'default' : 'pointer', fontFamily: 'inherit', padding: '8px 14px' }}>
          Refresh
        </button>
        <button disabled={isRestarting} onClick={onRestart} style={{ alignItems: 'center', background: 'rgba(255,74,94,.08)', border: '1px solid rgba(255,74,94,.2)', borderRadius: 7, color: '#ff4a5e', cursor: isRestarting ? 'default' : 'pointer', display: 'flex', fontFamily: 'inherit', gap: 6, marginLeft: 'auto', opacity: isRestarting ? 0.8 : 1, padding: '8px 12px' }} title='Restart the Hydrabase backend process'>
          <RefreshCw size={13} style={{ animation: isRestarting ? 'spin 1s linear infinite' : undefined }} />
          {isRestarting ? 'Restarting...' : 'Restart Node'}
        </button>
      </div>
      {saveError && <div style={{ color: '#ff7b72', marginTop: 10 }}>{saveError}</div>}
      {error && <div style={{ color: '#ff7b72', marginTop: 10 }}>{error}</div>}
      {isLoading && <div style={{ color: MUTED, marginTop: 10 }}>Loading settings...</div>}
    </div>

    {config && <div style={{ border: `1px solid ${BORD}`, borderRadius: 10, padding: 16 }}>
      <h3 style={{ marginBottom: 8, marginTop: 0 }}>Apply Mode</h3>
      <div style={{ color: MUTED, display: 'grid', fontSize: 12, gap: 6 }}>
        <div>ENV-locked paths: {config.envLockedPaths.length > 0 ? config.envLockedPaths.join(', ') : 'None'}</div>
        <div>Live update paths: {config.liveUpdatePaths.join(', ')}</div>
        <div>Pending restart paths: {config.pendingRestartPaths.length > 0 ? config.pendingRestartPaths.join(', ') : 'None'}</div>
      </div>

      <h3 style={{ marginBottom: 8, marginTop: 14 }}>Configurable ENV Vars</h3>
      <div style={{ border: `1px solid ${BORD}`, borderRadius: 8, display: 'grid', fontSize: 12, gap: 6, maxHeight: 220, overflowY: 'auto', padding: 10 }}>
        {configurableEnvVars.map(({ aliases, env, path }) => <div key={env} style={{ color: MUTED, display: 'grid', gap: 2 }}>
          <div style={{ color: TEXT, fontWeight: 600 }}>{env}</div>
          <div>Path: {path}</div>
          {aliases.length > 0 && <div>Aliases: {aliases.join(', ')}</div>}
        </div>)}
      </div>
    </div>}
  </section>
}
