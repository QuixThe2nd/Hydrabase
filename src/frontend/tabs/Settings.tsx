import { useEffect, useMemo, useState } from 'react'

import type { RuntimeConfigSnapshot, RuntimeConfigUpdate } from '../../types/hydrabase'

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
  const [bio, setBio] = useState('')
  const [connectMessage, setConnectMessage] = useState('')
  const [saveError, setSaveError] = useState<null | string>(null)
  const [saving, setSaving] = useState(false)
  const [username, setUsername] = useState('')

  useEffect(() => {
    if (!config) return
    setBio(config.editable.nodeProfile.bio)
    setConnectMessage(config.editable.nodeProfile.connectMessage)
    setUsername(config.editable.nodeProfile.username)
    setSaveError(null)
  }, [config])

  const dirty = useMemo(() => {
    if (!config) return false
    return username !== config.editable.nodeProfile.username
      || bio !== config.editable.nodeProfile.bio
      || connectMessage !== config.editable.nodeProfile.connectMessage
  }, [bio, config, connectMessage, username])

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSave({ nodeProfile: { bio, connectMessage, username } })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return <section style={{ maxWidth: 820 }}>
    <h2 style={{ marginBottom: 8, marginTop: 0 }}>Settings</h2>
    <p style={{ color: MUTED, marginBottom: 18, marginTop: 0 }}>
      Update your node profile at runtime. Changes apply immediately and persist across restarts.
    </p>

    <div style={{ border: `1px solid ${BORD}`, borderRadius: 10, marginBottom: 16, padding: 16 }}>
      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ color: MUTED, fontSize: 12 }}>Username (3-20 alphanumeric)</span>
          <input maxLength={20} onChange={(event) => setUsername(event.target.value)} style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${BORD}`, borderRadius: 8, color: TEXT, fontFamily: 'inherit', fontSize: 13, padding: '9px 10px' }} value={username} />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ color: MUTED, fontSize: 12 }}>Bio (max 140)</span>
          <textarea maxLength={140} onChange={(event) => setBio(event.target.value)} rows={3} style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${BORD}`, borderRadius: 8, color: TEXT, fontFamily: 'inherit', fontSize: 13, padding: '9px 10px', resize: 'vertical' }} value={bio} />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ color: MUTED, fontSize: 12 }}>Connect Message (max 280)</span>
          <textarea maxLength={280} onChange={(event) => setConnectMessage(event.target.value)} rows={2} style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${BORD}`, borderRadius: 8, color: TEXT, fontFamily: 'inherit', fontSize: 13, padding: '9px 10px', resize: 'vertical' }} value={connectMessage} />
        </label>
      </div>

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
      <h3 style={{ marginBottom: 8, marginTop: 0 }}>Read-only (restart required)</h3>
      <div style={{ color: MUTED, display: 'grid', fontSize: 12, gap: 6 }}>
        <div>Host: {config.readonly.node.hostname}</div>
        <div>IP: {config.readonly.node.ip}</div>
        <div>Listen Address: {config.readonly.node.listenAddress}</div>
        <div>Port: {config.readonly.node.port}</div>
        <div>API Key Configured: {config.readonly.apiKeyConfigured ? 'Yes' : 'No'}</div>
      </div>
    </div>}
  </section>
}
