import { useState } from 'react'

import type { EventEntry } from '../../types/hydrabase'

import { ACCENT, BORD, MUTED, TEXT } from '../theme'

interface Props {
  eventLog: EventEntry[]
}

const LV_COLOR: Record<string, string> = {
  DEBUG: '#484f58',
  ERROR: '#f85149',
  INFO:  ACCENT,
  WARN:  '#d29922',
}

const LogEntry = ({ entry }: { entry: EventEntry }) => {
  const [stackExpanded, setStackExpanded] = useState(false)
  return (
    <div style={{ alignItems: 'baseline', display: 'flex', flexDirection: 'column', fontFamily: 'monospace', fontSize: 11, padding: '2px 14px' }}>
      <div style={{ alignItems: 'baseline', display: 'flex', gap: 10, width: '100%' }}>
        <span style={{ color: MUTED, flexShrink: 0, minWidth: 58 }}>{entry.t}</span>
        <span style={{ color: LV_COLOR[entry.lv] ?? ACCENT, flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '.06em', minWidth: 40 }}>{entry.lv}</span>
        <span style={{ color: entry.lv === 'ERROR' ? '#ffa198' : entry.lv === 'WARN' ? '#e3b341' : TEXT }}>{entry.m}</span>
        {entry.stack && (
          <button
            onClick={() => setStackExpanded(e => !e)}
            style={{ background: 'none', border: 'none', color: ACCENT, cursor: 'pointer', flexShrink: 0, fontSize: 10, marginLeft: 'auto', padding: '0 4px', textDecoration: 'underline' }}
            type="button"
          >
            {stackExpanded ? 'hide trace' : 'trace'}
          </button>
        )}
      </div>
      {entry.stack && stackExpanded && (
        <div style={{ background: '#0d1117', border: `1px solid ${BORD}`, borderRadius: 4, color: '#8b949e', fontSize: 10, lineHeight: 1.5, marginTop: 4, maxHeight: 180, overflow: 'auto', padding: '6px 8px', whiteSpace: 'pre-wrap', width: '100%', wordBreak: 'break-word' }}>
          {entry.stack}
        </div>
      )}
    </div>
  )
}

export const ActivityFeed = ({ eventLog }: Props) => {
  const [expanded, setExpanded] = useState(false)
  const latest = eventLog[eventLog.length - 1]
  return <div style={{ background: '#010409', borderTop: `1px solid ${BORD}`, bottom: 28, left: 0, position: 'fixed', right: 0, zIndex: 47 }}>
    {expanded && <div style={{ borderBottom: `1px solid ${BORD}`, maxHeight: 200, overflowY: 'auto', padding: '4px 0' }}>
      {[...eventLog].reverse().slice(0, 30).map((entry, i) => (
        <LogEntry entry={entry} key={i} />
      ))}
      {eventLog.length === 0 && <div style={{ color: MUTED, fontSize: 11, padding: '8px 14px' }}>No events yet…</div>}
    </div>}
    <div onClick={() => setExpanded(e => !e)} style={{ alignItems: 'center', cursor: 'pointer', display: 'flex', gap: 10, height: 24, padding: '0 14px', userSelect: 'none' }}>
      <span style={{ animation: 'blink 2s infinite', background: '#3fb950', borderRadius: '50%', boxShadow: '0 0 5px #3fb950', display: 'inline-block', flexShrink: 0, height: 5, width: 5 }} />
      {latest ? <>
        <span style={{ color: LV_COLOR[latest.lv] ?? ACCENT, flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '.06em' }}>{latest.lv}</span>
        <span style={{ color: MUTED, flex: 1, fontFamily: 'monospace', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{latest.m}</span>
        <span style={{ color: MUTED, flexShrink: 0, fontFamily: 'monospace', fontSize: 10 }}>{latest.t}</span>
      </> : <span style={{ color: MUTED, fontFamily: 'monospace', fontSize: 11 }}>Waiting for events…</span>}
      <span style={{ color: MUTED, flexShrink: 0, fontSize: 10, marginLeft: 6, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▲</span>
    </div>
  </div>
}
