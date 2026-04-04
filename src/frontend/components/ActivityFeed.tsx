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

const LogEntry = ({ entry }: { entry: EventEntry }) => (
  <div style={{ alignItems: 'baseline', display: 'flex', fontFamily: 'monospace', fontSize: 11, gap: 10, padding: '2px 14px', width: '100%' }}>
    <span style={{ color: MUTED, flexShrink: 0, minWidth: 58 }}>{entry.t}</span>
    <span style={{ color: LV_COLOR[entry.lv] ?? ACCENT, flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '.06em', minWidth: 40 }}>{entry.lv}</span>
    <span style={{ color: entry.lv === 'ERROR' ? '#ffa198' : entry.lv === 'WARN' ? '#e3b341' : TEXT }}>{entry.m}</span>
  </div>
)

const TraceEntry = ({ entry }: { entry: EventEntry }) => (
  <div style={{ borderBottom: `1px solid ${BORD}`, padding: '6px 14px' }}>
    <div style={{ alignItems: 'baseline', display: 'flex', fontFamily: 'monospace', fontSize: 11, gap: 10, marginBottom: 4 }}>
      <span style={{ color: MUTED, flexShrink: 0, minWidth: 58 }}>{entry.t}</span>
      <span style={{ color: LV_COLOR[entry.lv] ?? ACCENT, flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '.06em', minWidth: 40 }}>{entry.lv}</span>
      <span style={{ color: entry.lv === 'ERROR' ? '#ffa198' : '#e3b341' }}>{entry.m}</span>
    </div>
    <div style={{ background: '#0d1117', border: `1px solid ${BORD}`, borderRadius: 4, color: '#8b949e', fontFamily: 'monospace', fontSize: 10, lineHeight: 1.5, maxHeight: 200, overflow: 'auto', padding: '6px 8px', whiteSpace: 'pre', wordBreak: 'break-all' }}>
      {entry.stack}
    </div>
  </div>
)

const ActivityTabs = ({
  eventLogCount,
  onTabSelect,
  tab,
  traceCount,
}: {
  eventLogCount: number
  onTabSelect: (tab: 'logs' | 'traces') => void
  tab: 'logs' | 'traces'
  traceCount: number
}) => {
  const tabBtn = (id: 'logs' | 'traces', label: string, count: number) => (
    <button
      onClick={e => { e.stopPropagation(); onTabSelect(id) }}
      style={{
        background: 'none',
        border: 'none',
        borderBottom: tab === id ? `2px solid ${ACCENT}` : '2px solid transparent',
        color: tab === id ? TEXT : MUTED,
        cursor: 'pointer',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '.05em',
        padding: '4px 10px 3px',
      }}
      type="button"
    >
      {label}{count > 0 && <span style={{ color: MUTED, marginLeft: 4 }}>{count}</span>}
    </button>
  )

  return (
    <div style={{ alignItems: 'center', borderBottom: `1px solid ${BORD}`, display: 'flex', padding: '0 6px' }}>
      {tabBtn('logs', 'LOGS', eventLogCount)}
      {tabBtn('traces', 'TRACES', traceCount)}
    </div>
  )
}

const ActivityStatusRow = ({ expanded, latest }: { expanded: boolean, latest: EventEntry | undefined }) => (
  <>
    <span style={{ animation: 'blink 2s infinite', background: '#3fb950', borderRadius: '50%', boxShadow: '0 0 5px #3fb950', display: 'inline-block', flexShrink: 0, height: 5, width: 5 }} />
    {latest ? <>
      <span style={{ color: LV_COLOR[latest.lv] ?? ACCENT, flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '.06em' }}>{latest.lv}</span>
      <span style={{ color: MUTED, flex: 1, fontFamily: 'monospace', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{latest.m}</span>
      <span style={{ color: MUTED, flexShrink: 0, fontFamily: 'monospace', fontSize: 10 }}>{latest.t}</span>
    </> : <span style={{ color: MUTED, fontFamily: 'monospace', fontSize: 11 }}>Waiting for events…</span>}
    <span style={{ color: MUTED, flexShrink: 0, fontSize: 10, marginLeft: 6, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▲</span>
  </>
)

export const ActivityFeed = ({ eventLog }: Props) => {
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState<'logs' | 'traces'>('logs')

  const traces = eventLog.filter(e => e.stack !== undefined)
  const latest = eventLog[eventLog.length - 1]

  return (
    <div style={{ background: '#010409', borderTop: `1px solid ${BORD}`, bottom: 28, left: 0, position: 'fixed', right: 0, zIndex: 47 }}>
      {expanded && (
        <div>
          <ActivityTabs eventLogCount={eventLog.length} onTabSelect={setTab} tab={tab} traceCount={traces.length} />
          <div style={{ maxHeight: 220, overflowY: 'auto', padding: tab === 'logs' ? '4px 0' : 0 }}>
            {tab === 'logs' && (
              <>
                {[...eventLog].reverse().slice(0, 30).map((entry, i) => <LogEntry entry={entry} key={i} />)}
                {eventLog.length === 0 && <div style={{ color: MUTED, fontSize: 11, padding: '8px 14px' }}>No events yet…</div>}
              </>
            )}
            {tab === 'traces' && (
              <>
                {[...traces].reverse().slice(0, 20).map((entry, i) => <TraceEntry entry={entry} key={i} />)}
                {traces.length === 0 && <div style={{ color: MUTED, fontSize: 11, padding: '8px 14px' }}>No traces yet…</div>}
              </>
            )}
          </div>
        </div>
      )}
      <div onClick={() => setExpanded(e => !e)} style={{ alignItems: 'center', cursor: 'pointer', display: 'flex', gap: 10, height: 24, padding: '0 14px', userSelect: 'none' }}>
        <ActivityStatusRow expanded={expanded} latest={latest} />
      </div>
    </div>
  )
}
