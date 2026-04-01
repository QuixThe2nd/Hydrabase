import { useEffect, useMemo, useState } from 'react'

import type { Config, RuntimeConfigPatch, RuntimeConfigSnapshot, RuntimeConfigUpdate } from '../../types/hydrabase'

import { BORD, MUTED, TEXT } from '../theme'

interface SettingsDraft extends Omit<Config, 'apiKey'> {
  apiKey: string
}

interface SettingsTabProps {
  config: null | RuntimeConfigSnapshot
  error: null | string
  isLoading: boolean
  onRefresh: () => Promise<void>
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

const toPatch = (draft: SettingsDraft): RuntimeConfigPatch => ({
  apiKey: draft.apiKey,
  bootstrapPeers: draft.bootstrapPeers,
  dht: { ...draft.dht },
  formulas: { ...draft.formulas },
  node: { ...draft.node },
  rpc: { ...draft.rpc },
  soulIdCutoff: draft.soulIdCutoff,
  upnp: { ...draft.upnp },
})

const normalizePatch = (patch: RuntimeConfigPatch): string => JSON.stringify(patch)

// eslint-disable-next-line max-lines-per-function
export const SettingsTab = ({ config, error, isLoading, onRefresh, onSave }: SettingsTabProps) => {
  const [draft, setDraft] = useState<null | SettingsDraft>(null)
  const [saveError, setSaveError] = useState<null | string>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!config) return
    setDraft(toDraft(config.desired))
    setSaveError(null)
  }, [config])

  const currentPatch = useMemo(() => config ? toPatch(toDraft(config.desired)) : null, [config])
  const draftPatch = useMemo(() => draft ? toPatch(draft) : null, [draft])

  const dirty = useMemo(() => {
    if (!currentPatch || !draftPatch) return false
    return normalizePatch(currentPatch) !== normalizePatch(draftPatch)
  }, [currentPatch, draftPatch])

  const handleSave = async () => {
    if (!draft) return
    const parsed: RuntimeConfigPatch = toPatch(draft)
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
    <p style={{ color: MUTED, marginBottom: 18, marginTop: 0 }}>
      Configure runtime settings with individual fields. Live-safe fields are applied immediately, while restart-bound fields are saved and applied on next restart.
    </p>
    <p style={{ color: MUTED, fontSize: 12, marginBottom: 18, marginTop: 0 }}>
      `node.ip` is auto-managed from startup discovery and is ignored when saving settings.
    </p>

    <div style={{ border: `1px solid ${BORD}`, borderRadius: 10, marginBottom: 16, padding: 16 }}>
      {draft && <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ border: `1px solid ${BORD}`, borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginBottom: 10, marginTop: 0 }}>General</h3>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>API Key</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, apiKey: event.target.value } : prev)} style={textInputStyle} type='text' value={draft.apiKey} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Bootstrap Peers</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, bootstrapPeers: event.target.value } : prev)} style={textInputStyle} type='text' value={draft.bootstrapPeers} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Soul ID Cutoff</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, soulIdCutoff: Number(event.target.value) } : prev)} style={textInputStyle} type='number' value={draft.soulIdCutoff} />
            </label>
          </div>
        </div>

        <div style={{ border: `1px solid ${BORD}`, borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginBottom: 10, marginTop: 0 }}>Node</h3>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Username</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, node: { ...prev.node, username: event.target.value } } : prev)} style={textInputStyle} type='text' value={draft.node.username} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Hostname</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, node: { ...prev.node, hostname: event.target.value } } : prev)} style={textInputStyle} type='text' value={draft.node.hostname} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Connect Message</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, node: { ...prev.node, connectMessage: event.target.value } } : prev)} style={textInputStyle} type='text' value={draft.node.connectMessage} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Bio</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, node: { ...prev.node, bio: event.target.value } } : prev)} style={textInputStyle} type='text' value={draft.node.bio ?? ''} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Listen Address</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, node: { ...prev.node, listenAddress: event.target.value } } : prev)} style={textInputStyle} type='text' value={draft.node.listenAddress} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Port</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, node: { ...prev.node, port: Number(event.target.value) } } : prev)} style={textInputStyle} type='number' value={draft.node.port} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Preferred Transport</span>
              <select onChange={(event) => setDraft((prev) => prev ? { ...prev, node: { ...prev.node, preferTransport: event.target.value as Config['node']['preferTransport'] } } : prev)} style={textInputStyle} value={draft.node.preferTransport}>
                <option value='TCP'>TCP</option>
                <option value='UDP'>UDP</option>
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
          <h3 style={{ marginBottom: 10, marginTop: 0 }}>DHT</h3>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
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
              <input checked={draft.dht.requireReady} onChange={(event) => setDraft((prev) => prev ? { ...prev, dht: { ...prev.dht, requireReady: event.target.checked } } : prev)} type='checkbox' />
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
          <h3 style={{ marginBottom: 10, marginTop: 0 }}>RPC & UPnP</h3>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>RPC Prefix</span>
              <input onChange={(event) => setDraft((prev) => prev ? { ...prev, rpc: { ...prev.rpc, prefix: event.target.value } } : prev)} style={textInputStyle} type='text' value={draft.rpc.prefix} />
            </label>
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
      </div>
      {saveError && <div style={{ color: '#ff7b72', marginTop: 10 }}>{saveError}</div>}
      {error && <div style={{ color: '#ff7b72', marginTop: 10 }}>{error}</div>}
      {isLoading && <div style={{ color: MUTED, marginTop: 10 }}>Loading settings...</div>}
    </div>

    {config && <div style={{ border: `1px solid ${BORD}`, borderRadius: 10, padding: 16 }}>
      <h3 style={{ marginBottom: 8, marginTop: 0 }}>Apply Mode</h3>
      <div style={{ color: MUTED, display: 'grid', fontSize: 12, gap: 6 }}>
        <div>Live update paths: {config.liveUpdatePaths.join(', ')}</div>
        <div>Pending restart paths: {config.pendingRestartPaths.length > 0 ? config.pendingRestartPaths.join(', ') : 'None'}</div>
      </div>
    </div>}
  </section>
}
