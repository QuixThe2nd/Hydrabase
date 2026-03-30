import { useState } from 'react'

import type { PeerConnectionAttempt } from '../../types/hydrabase'

import { error } from '../../utils/log'
import { ACCENT, BORD, MUTED, panel } from '../theme'

interface ConnectPeerDialogProps {
  connectionAttempts: PeerConnectionAttempt[]
  onClose: () => void
  onConnect: (hostname: `${string}:${number}`) => void
}

const ATTEMPT_STATUS_COLORS = {
  failed: '#f85149',
  pending: '#d29922',
} as const

const formatAttemptTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const StackTraceToggle = ({
  isExpanded,
  nonce,
  stack,
  toggleTrace,
}: {
  isExpanded: boolean
  nonce: number
  stack: string
  toggleTrace: (nonce: number) => void
}) => (
  <>
    <button
      onClick={() => toggleTrace(nonce)}
      style={{ background: 'none', border: 'none', color: ACCENT, cursor: 'pointer', fontSize: 11, padding: 0, textDecoration: 'underline' }}
      type="button"
    >
      {isExpanded ? 'Hide' : 'Show'} Backend Stack Trace
    </button>
    {isExpanded && (
      <div style={{ background: '#0d1117', border: `1px solid ${BORD}`, borderRadius: 4, color: '#8b949e', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.4, marginTop: 8, maxHeight: 220, overflow: 'auto', padding: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {stack}
      </div>
    )}
  </>
)

const AttemptCard = ({
  attempt,
  expandedTraces,
  toggleTrace,
}: {
  attempt: PeerConnectionAttempt
  expandedTraces: Record<number, boolean>
  toggleTrace: (nonce: number) => void
}) => {
  const color = ATTEMPT_STATUS_COLORS[attempt.state]
  const stack = attempt.error?.stack
  const isExpanded = Boolean(expandedTraces[attempt.nonce])
  const statusLabel = attempt.state === 'pending'
    ? 'Pending'
    : attempt.timedOut
      ? `Timed out (${attempt.error?.status ?? 408})`
      : `Failed (${attempt.error?.status ?? 500})`

  return (
    <div style={{ background: 'rgba(248,81,73,.06)', border: '1px solid #30363d', borderRadius: 4, padding: 10 }}>
      <div style={{ alignItems: 'center', display: 'flex', gap: 8, justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ color: '#c9d1d9', fontSize: 12, fontWeight: 700 }}>{attempt.hostname}</div>
        <div style={{ color, fontSize: 11, fontWeight: 700 }}>{statusLabel}</div>
      </div>
      <div style={{ color: MUTED, fontSize: 10, marginBottom: attempt.error ? 6 : 0 }}>
        Attempt #{attempt.nonce} at {formatAttemptTime(attempt.startedAt)}
      </div>
      {attempt.error && <div style={{ color, fontSize: 12, marginBottom: stack ? 6 : 0 }}>{attempt.error.message}</div>}
      {stack && <StackTraceToggle isExpanded={isExpanded} nonce={attempt.nonce} stack={stack} toggleTrace={toggleTrace} />}
    </div>
  )
}

const AttemptHistory = ({
  attempts,
  expandedTraces,
  toggleTrace,
}: {
  attempts: PeerConnectionAttempt[]
  expandedTraces: Record<number, boolean>
  toggleTrace: (nonce: number) => void
}) => {
  if (attempts.length === 0) return null

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color: MUTED, fontSize: 11, marginBottom: 6 }}>Connection attempts</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
        {attempts.map((attempt) => <AttemptCard attempt={attempt} expandedTraces={expandedTraces} key={attempt.nonce} toggleTrace={toggleTrace} />)}
      </div>
    </div>
  )
}

const PendingNotice = ({ hasPending }: { hasPending: boolean }) => {
  if (!hasPending) return null
  return (
    <div style={{ color: MUTED, fontSize: 12, marginBottom: 10 }}>
      Waiting for peer response...
    </div>
  )
}

const InputField = ({
  label,
  onChange,
  onKeyDown,
  placeholder,
  value,
}: {
  label: string
  onChange: (value: string) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  placeholder: string
  value: string
}) => (
  <div style={{ marginBottom: 12 }}>
    <label style={{ color: MUTED, display: 'block', fontSize: 11, marginBottom: 4 }}>{label}</label>
    <input
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      style={{ background: '#0d1117', border: `1px solid ${BORD}`, borderRadius: 4, boxSizing: 'border-box', color: '#fff', fontSize: 12, padding: '8px 10px', width: '100%' }}
      type="text"
      value={value}
    />
  </div>
)

const ButtonGroup = ({
  hasPending,
  onClose,
  onConnect,
}: {
  hasPending: boolean
  onClose: () => void
  onConnect: () => void
}) => (
  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
    <button onClick={onClose} style={{ background: 'none', border: `1px solid ${BORD}`, borderRadius: 4, color: '#fff', cursor: 'pointer', padding: '8px 14px' }} type="button">Cancel</button>
    <button disabled={hasPending} onClick={onConnect} style={{ background: '#238636', border: 'none', borderRadius: 4, color: '#fff', cursor: hasPending ? 'not-allowed' : 'pointer', opacity: hasPending ? 0.6 : 1, padding: '8px 14px' }} type="button">{hasPending ? 'Connecting...' : 'Connect'}</button>
  </div>
)

export default function ConnectPeerDialog({ connectionAttempts, onClose, onConnect }: ConnectPeerDialogProps) {
  const [hostname, setHostname] = useState('')
  const [port, setPort] = useState('4545')
  const [expandedTraces, setExpandedTraces] = useState<Record<number, boolean>>({})
  const hasPending = connectionAttempts.some((attempt) => attempt.state === 'pending')

  const handleConnect = () => {
    if (!hostname.trim() || !port.trim()) {
      error('ERROR:', 'Hostname and port are required')
      return
    }
    const portNum = Number.parseInt(port, 10)
    if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
      error('ERROR:', 'Port must be a number between 1 and 65535')
      return
    }
    onConnect(`${hostname}:${portNum}`)
  }

  const toggleTrace = (nonce: number) => {
    setExpandedTraces((prev) => ({
      ...prev,
      [nonce]: !prev[nonce],
    }))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConnect()
  }

  return (
    <div style={{ alignItems: 'center', background: 'rgba(0,0,0,.5)', display: 'flex', height: '100%', justifyContent: 'center', left: 0, position: 'fixed', top: 0, width: '100%', zIndex: 1000 }}>
      <div style={{ ...panel(), background: '#0d1117', borderColor: BORD, maxHeight: '80vh', maxWidth: 600, overflow: 'auto', width: '90%' }}>
        <div style={{ padding: 16 }}>
          <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 15, margin: 0 }}>Connect to Peer</h2>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: MUTED, cursor: 'pointer', fontSize: 18 }} type="button">x</button>
          </div>

          <PendingNotice hasPending={hasPending} />

          <AttemptHistory attempts={connectionAttempts} expandedTraces={expandedTraces} toggleTrace={toggleTrace} />
          <InputField label="Hostname" onChange={setHostname} onKeyDown={handleKeyDown} placeholder="localhost" value={hostname} />
          <InputField label="Port" onChange={setPort} onKeyDown={handleKeyDown} placeholder="4545" value={port} />
          <ButtonGroup hasPending={hasPending} onClose={onClose} onConnect={handleConnect} />
        </div>
      </div>
    </div>
  )
}
