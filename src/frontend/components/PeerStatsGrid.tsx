import type { Connection } from '../../types/hydrabase'

import { ACCENT, latColor, MUTED } from '../theme'
import { fmtBytes, fmtTimeAgo, fmtUptime } from '../utils'

interface Props {
  connection: Connection | undefined
}

export const PeerStatsGrid = ({ connection }: Props) => (
  <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(100px,1fr))', marginBottom: 10 }}>
    {([
      ['Latency', connection?.latency ? `${Math.round(connection?.latency * 10) / 10}ms` : '—', connection?.latency ? latColor(connection?.latency) : MUTED],
      ['Last Ponged Ping', fmtTimeAgo(connection?.lastPongedPingSentAt), '#a5d6ff'],
      ['↑ UL (Session)', fmtBytes(connection?.totalUL ?? 0), ACCENT],
      ['↓ DL (Session)', fmtBytes(connection?.totalDL ?? 0), '#f0883e'],
      ['↑ UL (Lifetime)', fmtBytes(connection?.lifetimeUL ?? 0), ACCENT],
      ['↓ DL (Lifetime)', fmtBytes(connection?.lifetimeDL ?? 0), '#f0883e'],
      ['Uptime', fmtUptime(connection?.uptime ?? 0), (connection?.uptime ?? 0) / 1_000 > 90 ? '#3fb950' : (connection?.uptime ?? 0) / 1_000 > 60 ? '#d29922' : '#f85149'],
    ] as [string, string, string][]).map(([l, v, c]) => <div key={l} style={{ background: '#0d1117', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ color: MUTED, fontSize: 9, letterSpacing: '.1em', marginBottom: 4, textTransform: 'uppercase' }}>{l}</div>
      <div style={{ color: c, fontSize: 15, fontWeight: 700 }}>{v}</div>
    </div>)}
  </div>
)
