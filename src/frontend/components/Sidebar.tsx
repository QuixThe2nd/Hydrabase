import type { LucideIcon } from 'lucide-react'

import { BarChart3, GitBranch, MessageSquare, Search, ShieldCheck, Users } from 'lucide-react'

import type { NodeStats, PeerWithCountry } from '../../types/hydrabase'

import { ACCENT, BORD, MUTED, TEXT } from '../theme'
import { fmtBytes, fmtClock, shortAddr, toEmoji } from '../utils'
import { Identicon } from './Identicon'

export type Tab = 'dht' | 'messages' | 'overview' | 'peers' | 'search' | 'votes'

type ActiveTab = null | Tab

const NAV_ITEMS: { icon: LucideIcon; label: string; tab: Tab; }[] = [
  { icon: BarChart3, label: 'Overview', tab: 'overview' },
  { icon: Search, label: 'Search', tab: 'search' },
  { icon: MessageSquare, label: 'Messages', tab: 'messages' },
  { icon: Users, label: 'Peers', tab: 'peers' },
  { icon: GitBranch, label: 'DHT', tab: 'dht' },
  { icon: ShieldCheck, label: 'Votes', tab: 'votes' },
]

const getPeerLabel = (peer: PeerWithCountry): string => peer.connection?.username || peer.auth?.username || shortAddr(peer.address)

const hasKnownCountry = (peer: PeerWithCountry): boolean => peer.country !== 'N/A' && peer.country !== '-'

const getAuthFieldCount = (peer: PeerWithCountry): number => [peer.auth?.bio, peer.auth?.hostname, peer.auth?.username].filter(Boolean).length

const getLiveFieldCount = (peer: PeerWithCountry): number => [peer.connection?.bio, peer.connection?.hostname, peer.connection?.username].filter(Boolean).length

const getTelemetryFieldCount = (peer: PeerWithCountry): number => [
  peer.connection?.confidence ?? 0,
  peer.connection?.latency ?? 0,
  peer.connection?.lookupTime ?? 0,
  peer.connection?.totalDL ?? 0,
  peer.connection?.totalUL ?? 0,
  peer.connection?.uptime ?? 0,
].filter(value => value > 0).length

const getInfoDensity = (peer: PeerWithCountry): number => getAuthFieldCount(peer)
  + getLiveFieldCount(peer)
  + getTelemetryFieldCount(peer)
  + (peer.connection?.plugins.length ?? 0)
  + (peer.knownPlugins?.length ?? 0)

const compareSidebarPeers = (left: PeerWithCountry, right: PeerWithCountry): number => {
  const comparisons = [
    Number(right.connection !== undefined) - Number(left.connection !== undefined),
    Number(hasKnownCountry(right)) - Number(hasKnownCountry(left)),
    Number(getAuthFieldCount(right) > 0) - Number(getAuthFieldCount(left) > 0),
    getAuthFieldCount(right) - getAuthFieldCount(left),
    Number(getLiveFieldCount(right) > 0) - Number(getLiveFieldCount(left) > 0),
    getInfoDensity(right) - getInfoDensity(left),
    (right.connection?.confidence ?? 0) - (left.connection?.confidence ?? 0),
  ]

  for (const comparison of comparisons) {
    if (comparison !== 0) return comparison
  }

  return left.address.localeCompare(right.address)
}

const sortSidebarPeers = (peers: PeerWithCountry[]): PeerWithCountry[] => [...peers].sort(compareSidebarPeers)

const SidebarNav = ({ setTab, tab, unreadMessages }: { setTab: React.Dispatch<React.SetStateAction<Tab>>; tab: ActiveTab; unreadMessages: number }) => <nav style={{ padding: '8px 6px 6px' }}>
  {NAV_ITEMS.map(({ icon: Icon, label, tab: t }) => <button key={t} onClick={() => setTab(t)} style={{ alignItems: 'center', background: tab === t ? 'rgba(88,166,255,.1)' : 'none', border: 'none', borderLeft: `2px solid ${tab === t ? ACCENT : 'transparent'}`, borderRadius: '0 6px 6px 0', color: tab === t ? TEXT : MUTED, cursor: 'pointer', display: 'flex', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === t ? 600 : 400, gap: 9, marginBottom: 2, padding: '7px 12px', transition: 'all .15s', width: '100%' }}>
    <Icon size={20} strokeWidth={tab === t ? 2.2 : 1.8} style={{ flexShrink: 0, opacity: tab === t ? 1 : .8 }} />
    {label}
    {t === 'messages' && unreadMessages > 0 && <span style={{ background: '#ff4a5e', borderRadius: 99, color: '#fff', fontSize: 9, fontWeight: 700, marginLeft: 'auto', padding: '1px 5px' }}>{unreadMessages}</span>}
  </button>)}
</nav>

const SidebarPeerButton = ({ isActive, onSelectPeer, peer }: { isActive: boolean; onSelectPeer: (peer: PeerWithCountry) => void; peer: PeerWithCountry }) => <button key={peer.address} onClick={() => onSelectPeer(peer)} style={{ alignItems: 'flex-start', background: isActive ? 'rgba(88,166,255,.1)' : 'rgba(255,255,255,.02)', border: `1px solid ${isActive ? '#58a6ff55' : 'transparent'}`, borderRadius: 6, color: isActive ? TEXT : MUTED, cursor: 'pointer', display: 'flex', flexDirection: 'column', fontFamily: 'inherit', gap: 3, padding: '8px 10px', textAlign: 'left', transition: 'all .15s', width: '100%' }}>
  <div style={{ alignItems: 'center', display: 'flex', gap: 8, width: '100%' }}>
    <Identicon address={peer.address} size={18} />
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <div style={{ alignItems: 'center', display: 'flex', gap: 6, width: '100%' }}>
        <span style={{ color: peer.connection ? '#3fb950' : '#ff4a5e', fontSize: 8, lineHeight: 1 }}>●</span>
        <span style={{ color: isActive ? TEXT : '#d6e2ee', fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getPeerLabel(peer)}</span>
        <span style={{ fontSize: 11, marginLeft: 'auto' }}>{toEmoji(peer.country)}</span>
      </div>
      <div style={{ color: MUTED, fontFamily: 'monospace', fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>{shortAddr(peer.address)}</div>
    </div>
  </div>
</button>

const SidebarPeers = ({ onSelectPeer, peers, selectedPeerAddress, setTab, tab }: { onSelectPeer: (peer: PeerWithCountry) => void; peers: PeerWithCountry[]; selectedPeerAddress: null | string; setTab: React.Dispatch<React.SetStateAction<Tab>>; tab: ActiveTab }) => <div style={{ borderTop: `1px solid ${BORD}`, display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, padding: '10px 6px 12px' }}>
  <button onClick={() => setTab('peers')} style={{ alignItems: 'center', background: 'none', border: 'none', color: tab === 'peers' ? TEXT : MUTED, cursor: 'pointer', display: 'flex', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, justifyContent: 'space-between', letterSpacing: '.08em', padding: '0 10px 8px', textTransform: 'uppercase', width: '100%' }}>
    <span>Peers</span>
    <span style={{ color: ACCENT, fontFamily: 'monospace', fontSize: 10 }}>{peers.length}</span>
  </button>

  <div style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 4, minHeight: 0, overflowY: 'auto', padding: '0 4px' }}>
    {peers.length === 0 && <div style={{ color: MUTED, fontSize: 11, padding: '4px 8px' }}>No peers online</div>}
    {peers.map((peer) => <SidebarPeerButton isActive={selectedPeerAddress === peer.address} key={peer.address} onSelectPeer={onSelectPeer} peer={peer} />)}
  </div>
</div>

export const Sidebar = ({ onSelectPeer, peers, selectedPeerAddress, setTab, stats, tab, unreadMessages, uptime }: { onSelectPeer: (peer: PeerWithCountry) => void; peers: PeerWithCountry[]; selectedPeerAddress: null | string; setTab: React.Dispatch<React.SetStateAction<Tab>>; stats: NodeStats | null; tab: ActiveTab; unreadMessages: number; uptime: number }) => {
  const totalRx = peers.reduce((a, p) => a + (p.connection?.totalDL ?? 0), 0)
  const totalTx = peers.reduce((a, p) => a + (p.connection?.totalUL ?? 0), 0)
  const sidebarPeers = sortSidebarPeers(peers.filter(peer => peer.connection !== undefined)).slice(0, 8)

  return <div style={{ background: '#010409', borderRight: `1px solid ${BORD}`, display: 'flex', flexDirection: 'column', flexShrink: 0, height: 'calc(100vh - 48px)', position: 'sticky', top: 0, width: 196 }}>
    <div style={{ borderBottom: `1px solid ${BORD}`, padding: '16px 16px 14px' }}>
      <img src="./logo-white.svg" style={{ marginRight: '4px', width: '16px' }} />
      <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '.06em', marginBottom: 4 }}>HYDRABASE</span>
    </div>
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
      <SidebarNav setTab={setTab} tab={tab} unreadMessages={unreadMessages} />
      <SidebarPeers onSelectPeer={onSelectPeer} peers={sidebarPeers} selectedPeerAddress={selectedPeerAddress} setTab={setTab} tab={tab} />
    </div>
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
