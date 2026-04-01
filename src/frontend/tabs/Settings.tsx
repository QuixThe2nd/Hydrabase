import { useEffect, useMemo, useState } from 'react'

import type { RuntimeConfigPatch, RuntimeConfigSnapshot, RuntimeConfigUpdate } from '../../types/hydrabase'

import { BORD, MUTED, TEXT } from '../theme'

interface SettingsTabProps {
  config: null | RuntimeConfigSnapshot
  error: null | string
  isLoading: boolean
  onRefresh: () => Promise<void>
  onSave: (update: RuntimeConfigUpdate) => Promise<void>
}

// eslint-disable-next-line max-lines-per-function
export const SettingsTab = ({ config, error, isLoading, onRefresh, onSave }: SettingsTabProps) => {
  const [draftJson, setDraftJson] = useState('')
  const [saveError, setSaveError] = useState<null | string>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!config) return
    setDraftJson(JSON.stringify(config.desired, null, 2))
    setSaveError(null)
  }, [config])

  const normalizedDraft = useMemo(() => {
    try {
      const parsed = JSON.parse(draftJson)
      return JSON.stringify(parsed)
    } catch {
      return null
    }
  }, [draftJson])

  const dirty = useMemo(() => {
    if (!config) return false
    const current = JSON.stringify(config.desired)
    return normalizedDraft !== null && normalizedDraft !== current
  }, [config, normalizedDraft])

  const handleSave = async () => {
    if (!config) return
    let parsed: RuntimeConfigPatch
    try {
      parsed = JSON.parse(draftJson) as RuntimeConfigPatch
    } catch {
      setSaveError('Config JSON is invalid')
      return
    }
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
      Full node config is editable. Live-safe fields are applied immediately, while restart-bound fields are saved and applied on next restart.
    </p>
    <p style={{ color: MUTED, fontSize: 12, marginBottom: 18, marginTop: 0 }}>
      `node.ip` is auto-managed from startup discovery and is ignored when saving settings.
    </p>

    <div style={{ border: `1px solid ${BORD}`, borderRadius: 10, marginBottom: 16, padding: 16 }}>
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ color: MUTED, fontSize: 12 }}>Config JSON (includes preferred transport and all other keys)</span>
        <textarea onChange={(event) => setDraftJson(event.target.value)} rows={22} spellCheck={false} style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${BORD}`, borderRadius: 8, color: TEXT, fontFamily: "'JetBrains Mono','Courier New',monospace", fontSize: 12, lineHeight: 1.45, padding: '9px 10px', resize: 'vertical' }} value={draftJson} />
      </label>

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
