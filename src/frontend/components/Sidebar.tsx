import type { LucideIcon } from 'lucide-react'

import { BarChart3, GitBranch, MessageSquare, Search, ShieldCheck, Users } from 'lucide-react'

import type { NodeStats, PeerWithCountry } from '../../types/hydrabase'

import { ACCENT, BORD, MUTED, TEXT } from '../theme'
import { fmtBytes, fmtClock, shortAddr } from '../utils'

export type Tab = 'dht' | 'messages' | 'overview' | 'peers' | 'search' | 'votes'

const NAV_ITEMS: { icon: LucideIcon; label: string; tab: Tab; }[] = [
  { icon: BarChart3, label: 'Overview', tab: 'overview' },
  { icon: Search, label: 'Search', tab: 'search' },
  { icon: Users, label: 'Peers', tab: 'peers' },
  { icon: MessageSquare, label: 'Messages', tab: 'messages' },
  { icon: GitBranch, label: 'DHT', tab: 'dht' },
  { icon: ShieldCheck, label: 'Votes', tab: 'votes' },
]

export const Sidebar = ({ peers, setTab, stats, tab, unreadMessages, uptime }: { peers: PeerWithCountry[]; setTab: React.Dispatch<React.SetStateAction<Tab>>; stats: NodeStats | null; tab: Tab; unreadMessages: number; uptime: number }) => {
  const totalRx = peers.reduce((a, p) => a + (p.connection?.totalDL ?? 0), 0)
  const totalTx = peers.reduce((a, p) => a + (p.connection?.totalUL ?? 0), 0)
  const connCount = peers.filter(p => p.connection !== undefined).length
  return <div style={{ background: '#010409', borderRight: `1px solid ${BORD}`, display: 'flex', flexDirection: 'column', flexShrink: 0, height: 'calc(100vh - 48px)', position: 'sticky', top: 0, width: 196 }}>
    <div style={{ borderBottom: `1px solid ${BORD}`, padding: '16px 16px 14px' }}>
      <img src="./logo-white.svg" style={{ marginRight: '4px', width: '16px' }} />
      <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '.06em', marginBottom: 4 }}>HYDRABASE</span>
    </div>
    <nav style={{ flex: 1, padding: '8px 6px' }}>
      {NAV_ITEMS.map(({ icon: Icon, label, tab: t }) => <button key={t} onClick={() => setTab(t)} style={{ alignItems: 'center', background: tab === t ? 'rgba(88,166,255,.1)' : 'none', border: 'none', borderLeft: `2px solid ${tab === t ? ACCENT : 'transparent'}`, borderRadius: '0 6px 6px 0', color: tab === t ? TEXT : MUTED, cursor: 'pointer', display: 'flex', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === t ? 600 : 400, gap: 9, marginBottom: 2, padding: '7px 12px', transition: 'all .15s', width: '100%' }}>
        <Icon size={20} strokeWidth={tab === t ? 2.2 : 1.8} style={{ flexShrink: 0, opacity: tab === t ? 1 : .8 }} />
        {label}
        {t === 'peers' && connCount > 0 && <span style={{ background: ACCENT, borderRadius: 99, color: '#000', fontSize: 9, fontWeight: 700, marginLeft: 'auto', padding: '1px 5px' }}>{connCount}</span>}
        {t === 'messages' && unreadMessages > 0 && <span style={{ background: '#ff4a5e', borderRadius: 99, color: '#fff', fontSize: 9, fontWeight: 700, marginLeft: 'auto', padding: '1px 5px' }}>{unreadMessages}</span>}
      </button>)}
    </nav>
    <div style={{ borderTop: `1px solid ${BORD}`, padding: '12px 16px' }}>
      {([
        ['↑ UL', fmtBytes(totalTx), '#f0883e'],
        ['↓ DL', fmtBytes(totalRx), ACCENT],
        ['uptime', fmtClock(uptime), MUTED],
      ] as [string, string, string][]).map(([l, v, c]) => (
        <div key={l} style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ color: MUTED, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase' }}>{l}</span>
          <span style={{ color: c, fontFamily: 'monospace', fontSize: 10, fontWeight: 600 }}>{v}</span>
        </div>
      ))}
      <div style={{ borderTop: `1px solid ${BORD}`, color: MUTED, fontFamily: 'monospace', fontSize: 9, marginTop: 8, paddingTop: 8, wordBreak: 'break-all' }}>{shortAddr(stats?.self.address)}</div>
    </div>
  </div>
}
