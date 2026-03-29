import type { ApiPeer, FilterState, PeerWithCountry } from '../../types/hydrabase'

import { Identicon } from '../components/Identicon'
import { StatusDot } from '../components/StatusDot'
import { ACCENT, BORD, confColor, latColor, MUTED, panel } from '../theme'
import { fmtBytes, fmtUptime, toEmoji } from '../utils'

interface Props {
  filter: FilterState;
  sel: ApiPeer | null;
  setFilter: (f: FilterState) => void;
  setSel: (p: null | PeerWithCountry) => void;
  sorted: PeerWithCountry[];
}

const FILTERS = ['all', 'connected', 'disconnected'] as const

const MetaChips = ({ peer }: { peer: PeerWithCountry }) => {
  const meta = [
    (peer.connection?.username || peer.auth?.username) ? peer.address : undefined,
    (peer.connection?.hostname || peer.auth?.hostname)
      ? `ws://${peer.connection?.hostname || peer.auth?.hostname}`
      : undefined,
    peer.connection?.userAgent || peer.auth?.userAgent,
  ].filter(Boolean)

  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginLeft: 12, marginTop: 6 }}>
    {meta.map((item) => <span key={item} style={{ background: '#161b22', border: `1px solid ${BORD}`, borderRadius: 999, color: MUTED, fontSize: 10, lineHeight: 1.3, padding: '2px 8px' }}>{item}</span>)}
  </div>
}

const PluginChips = ({ peer }: { peer: PeerWithCountry }) => <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
  {peer.connection?.plugins.map((plugin) => <span key={plugin} style={{ background: '#21262d', border: `1px solid ${BORD}`, borderRadius: 4, color: ACCENT, fontSize: 10, padding: '2px 8px' }}>{plugin}</span>)}
  {peer.connection?.plugins.length === 0 && <span style={{ color: MUTED, fontSize: 10 }}>no plugins</span>}
</div>

const PeerStats = ({ peer }: { peer: PeerWithCountry }) => {
  const uptime = peer.connection?.uptime ?? 0
  const uptimeColor = uptime / 1_000 > 90 ? '#3fb950' : uptime / 1_000 > 60 ? '#d29922' : '#f85149'
  const stats = [
    ['Latency', peer.connection?.latency ? `${Math.round(peer.connection?.latency * 10) / 10}ms` : '—', peer.connection?.latency ? latColor(peer.connection?.latency) : MUTED],
    ['↑ UL (Session)', fmtBytes(peer.connection?.totalUL ?? 0), ACCENT],
    ['↓ DL (Session)', fmtBytes(peer.connection?.totalDL ?? 0), '#f0883e'],
    ['↑ UL (Lifetime)', fmtBytes(peer.connection?.lifetimeUL ?? 0), ACCENT],
    ['↓ DL (Lifetime)', fmtBytes(peer.connection?.lifetimeDL ?? 0), '#f0883e'],
    ['Uptime', fmtUptime(uptime), uptimeColor],
  ] as [string, string, string][]

  return <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(100px,1fr))', marginBottom: 10 }}>
    {stats.map(([label, value, color]) => <div key={label} style={{ background: '#0d1117', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ color: MUTED, fontSize: 9, letterSpacing: '.1em', marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color, fontSize: 15, fontWeight: 700 }}>{value}</div>
    </div>)}
  </div>
}

const ConfidenceBar = ({ peer }: { peer: PeerWithCountry }) => {
  const confidence = peer.connection?.confidence ?? 0
  const confidenceColor = confColor(confidence)

  return <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ color: MUTED, fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase' }}>Historic Confidence</span>
      <span style={{ color: confidenceColor, fontSize: 10, fontWeight: 700 }}>{(confidence * 100).toFixed(1)}%</span>
    </div>
    <div style={{ background: '#21262d', borderRadius: 2, height: 4, overflow: 'hidden' }}>
      <div style={{ background: confidenceColor, borderRadius: 2, height: '100%', transition: 'width .3s', width: `${confidence * 100}%` }} />
    </div>
  </div>
}

const PeerCard = ({ peer, selected, setSel }: { peer: PeerWithCountry; selected: boolean; setSel: (p: null | PeerWithCountry) => void }) => {
  const displayName = peer.connection?.username || peer.auth?.username || peer.address
  const bio = peer.connection?.bio || peer.auth?.bio

  return <div onClick={() => setSel(selected ? null : peer)} style={{ ...panel(), borderColor: selected ? '#58a6ff55' : BORD, cursor: 'pointer', transition: 'border-color .15s' }}>
    <div style={{ padding: '12px 16px' }}>
      <div style={{ alignItems: 'flex-start', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ alignItems: 'center', display: 'flex', gap: 8, marginBottom: 3 }}>
            <Identicon address={peer.address} size={24} />
            <StatusDot status={peer.connection !== undefined} />
            <span style={{ fontSize: 12, fontWeight: 700 }}>{displayName}</span>
            <span style={{ fontSize: 12 }}>{toEmoji(peer.country)}</span>
          </div>
          <MetaChips peer={peer} />
          {bio && <div style={{ color: '#a5d6ff', fontSize: 11, marginLeft: 12, marginTop: 4 }}>{bio}</div>}
        </div>
        <PluginChips peer={peer} />
      </div>
      <PeerStats peer={peer} />
      <ConfidenceBar peer={peer} />
    </div>
  </div>
}

export const PeersTab = ({ filter, sel, setFilter, setSel, sorted }: Props) => <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
  <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
    <span style={{ color: MUTED, fontSize: 11 }}>Filter:</span>
    {FILTERS.map((status) => <button className={`fbtn${filter === status ? ' on' : ''}`} key={status} onClick={() => setFilter(status)}>{status}</button>)}
    <span style={{ color: MUTED, fontSize: 11, marginLeft: 'auto' }}>{sorted.length} peers</span>
  </div>
  {sorted.map((peer) => <PeerCard key={peer.address} peer={peer} selected={sel?.address === peer.address} setSel={setSel} />)}
</div>
