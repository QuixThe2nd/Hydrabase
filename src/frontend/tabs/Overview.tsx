import type { ApiPeer, NodeStats, PeerWithCountry } from '../../types/hydrabase'

import { Identicon } from '../components/Identicon'
import { NetworkPulseCanvas } from '../components/Pulse'
import { StatCard } from '../components/StatCard'
import { ACCENT, ACCENT2, BG2, BORD, confColor, DIM, GREEN, MUTED, ORANGE, PURPLE, TEXT, YELLOW } from '../theme'
import { parseEndpoint, shortAddr, toEmoji } from '../utils'

interface BwPoint { dl: number; t: number; ul: number }
type ConnectionType = NonNullable<PeerWithCountry['connection']>['type']

interface Props {
  bwHistory: BwPoint[]
  onViewMorePeers: () => void
  peers: PeerWithCountry[]
  sel: ApiPeer | null
  setSel: (p: null | PeerWithCountry) => void
  stats: NodeStats | null
  uptime: number
}

const ActivityBar = ({ data }: { data: number[] }) => <div style={{ alignItems: 'flex-end', display: 'flex', gap: 1.5, height: 14 }}>
  {data.map((v, i) => <div key={i} style={{ background: ACCENT2, borderRadius: 1, height: Math.max(2, (v / 100) * 14), opacity: 0.3 + (v / 140), transition: 'height .3s ease', width: 3 }} />)}
</div>
const StatusDotPulse = ({ status }: { status: boolean }) => <div style={{ animation: status ? 'pulse-dot 1.4s ease infinite' : undefined, background: status ? GREEN : '#ff4a5e66', borderRadius: '50%', flexShrink: 0, height: 7, width: 7 }} />

const CONF_BAR_W = 38

const formatUptime = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / (k ** i)).toFixed(1)} ${sizes[i]}`
}

const formatConnectionType = (type: ConnectionType | undefined): string => {
  if (type === 'CLIENT') return 'Client'
  if (type === 'SERVER') return 'Server'
  if (type === 'UTP') return 'UTP'
  return 'Unknown'
}

const getConnectionTypeColor = (type: ConnectionType | undefined): string => {
  if (type === 'SERVER') return GREEN
  if (type === 'CLIENT') return ACCENT
  if (type === 'UTP') return PURPLE
  return MUTED
}

const ConnectionTypeLabel = ({ type }: { type: ConnectionType | undefined }) => <span style={{ color: getConnectionTypeColor(type), fontSize: 10, fontWeight: 600 }}>{formatConnectionType(type)}</span>

const PeerRow = ({ isSelected, onSelect, peer }: { isSelected: boolean; onSelect: () => void; peer: PeerWithCountry }) => {
  const confColor_ = confColor(peer.connection?.confidence ?? 0)
  const parsedPeerEndpoint = peer.connection?.hostname ? parseEndpoint(peer.connection.hostname) : null
  const peerIp = parsedPeerEndpoint?.hostname ?? 'unknown'
  const peerPort = parsedPeerEndpoint?.port ?? 'N/A'
  const peerUserAgent = peer.connection?.userAgent ?? peer.auth?.userAgent
  return <div className={isSelected ? 'peer-overview-row selected' : 'peer-overview-row'} data-addr={peer.address} onClick={onSelect} style={{ alignItems: 'center', background: isSelected ? 'rgba(0,200,255,.06)' : 'transparent', borderBottom: `1px solid ${BORD}`, cursor: 'pointer', display: 'grid', gap: 0, gridTemplateColumns: '36px 1fr 100px 70px 60px 60px 60px 80px 50px', transition: 'background .1s' }}>
    <div style={{ padding: '8px 6px 8px 10px' }}>
      <Identicon address={peer.address} size={22} />
    </div>
    <div style={{ minWidth: 0, padding: '8px 10px' }}>
      <div style={{ alignItems: 'center', display: 'flex', gap: 6, marginBottom: 2 }}>
        <StatusDotPulse status={peer.connection !== undefined} />
        <span style={{ color: TEXT, fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{peer.connection?.username}</span>
        <span style={{ fontSize: 11 }}>{toEmoji(peer.country)}</span>
      </div>
      <div style={{ color: MUTED, fontSize: 9, overflow: 'hidden', paddingLeft: 13, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span title={`${peerIp}:${peerPort}`}>{shortAddr(peer.address)} · {peerIp}:{peerPort}</span>
      </div>
      {peerUserAgent && <div style={{ color: DIM, fontSize: 9, overflow: 'hidden', paddingLeft: 13, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ color: MUTED, fontWeight: 600, letterSpacing: '.04em', marginRight: 4, textTransform: 'uppercase' }}>Client</span>
        <span title={peerUserAgent}>{peerUserAgent}</span>
      </div>}
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, padding: '8px 6px' }}>
      {peer.connection?.plugins.slice(0, 2).map(pl => <span key={pl} style={{ background: 'rgba(0,200,255,.08)', border: '1px solid rgba(0,200,255,.18)', borderRadius: 3, color: ACCENT, fontSize: 8, letterSpacing: '.03em', padding: '1px 5px' }}>{pl}</span>)}
      {(peer.connection?.plugins.length ?? 0) > 2 && <span style={{ background: 'rgba(0,200,255,.08)', border: '1px solid rgba(0,200,255,.18)', borderRadius: 3, color: MUTED, fontSize: 8, padding: '1px 5px' }}>+{(peer.connection?.plugins.length ?? 0) - 2}</span>}
    </div>
    <div style={{ padding: '8px 6px' }}><ConnectionTypeLabel type={peer.connection?.type} /></div>
    <div style={{ padding: '8px 6px' }}>{peer.connection === undefined ? <span style={{ color: DIM, fontSize: 9 }}>offline</span> : <ActivityBar data={peer.activity} />}</div>
    <div style={{ padding: '8px 6px' }}><span style={{ color: peer.connection !== undefined && peer.connection?.latency ? (peer.connection?.latency < 100 ? GREEN : peer.connection?.latency < 250 ? YELLOW : ORANGE) : MUTED, fontSize: 10, fontWeight: 600 }}>{peer.connection !== undefined && peer.connection?.latency ? `${Math.round(peer.connection?.latency)}ms` : '—'}</span></div>
    <div style={{ padding: '8px 6px' }}><span style={{ color: peer.connection !== undefined && peer.connection?.lookupTime ? (peer.connection?.lookupTime < 100 ? GREEN : peer.connection?.lookupTime < 250 ? YELLOW : ORANGE) : MUTED, fontSize: 10, fontWeight: 600 }}>{peer.connection !== undefined && peer.connection?.lookupTime ? `${Math.round(peer.connection?.lookupTime)}ms` : '—'}</span></div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 6px' }}>
      <span style={{ color: ACCENT, fontSize: 10, fontWeight: 600 }}>{formatBytes(peer.connection?.totalUL ?? 0)}</span>
      <span style={{ color: ORANGE, fontSize: 10, fontWeight: 600 }}>{formatBytes(peer.connection?.totalDL ?? 0)}</span>
    </div>
    <div style={{ padding: '8px 8px 8px 4px' }}>
      <div style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {peer.address === '0x0'
          ? <span style={{ color: MUTED, fontSize: 10 }}>—</span>
          : <>
            <span style={{ color: confColor_, fontSize: 10, fontWeight: 600 }}>{((peer.connection?.confidence ?? 0) * 100).toFixed(1)}</span>
            <div style={{ background: '#111820', borderRadius: 2, height: 3, overflow: 'hidden', width: CONF_BAR_W }}>
              <div style={{ background: confColor_, borderRadius: 2, height: '100%', transition: 'width .5s ease', width: `${(peer.connection?.confidence ?? 0) * 100}%` }} />
            </div>
          </>}
      </div>
    </div>
  </div>
}

const PeerList = ({ onViewMorePeers, peers, sel, setSel }: { onViewMorePeers: () => void; peers: PeerWithCountry[]; sel: ApiPeer | null; setSel: (p: null | PeerWithCountry) => void }) => <div style={{ background: BG2, border: `1px solid ${BORD}`, borderRadius: 8, overflow: 'hidden' }}>
  <div style={{ alignItems: 'center', borderBottom: `1px solid ${BORD}`, color: MUTED, display: 'grid', fontSize: 9, fontWeight: 700, gap: 0, gridTemplateColumns: '36px 1fr 100px 70px 60px 60px 60px 80px 50px', letterSpacing: '.08em', padding: '6px 0', textTransform: 'uppercase' }}>
    <div />
    <div style={{ padding: '0 10px' }}>Peer</div>
    <div style={{ padding: '0 6px' }}>Plugins</div>
    <div style={{ padding: '0 6px' }}>Type</div>
    <div style={{ padding: '0 6px' }}>Activity</div>
    <div style={{ padding: '0 6px' }}>Latency</div>
    <div style={{ padding: '0 6px' }}>Lookup Time</div>
    <div style={{ padding: '0 6px' }}>UL / DL</div>
    <div style={{ padding: '0 8px 0 4px' }}>Conf</div>
  </div>
  {peers.length === 0 && <div style={{ color: MUTED, fontSize: 11, padding: '20px 14px', textAlign: 'center' }}>No peers yet…</div>}
  {peers.map(p => <PeerRow isSelected={sel?.address === p.address} key={p.address} onSelect={() => setSel(sel?.address === p.address ? null : p)} peer={p} />)}
  <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 12px' }}>
    <button onClick={onViewMorePeers} style={{ background: 'rgba(0,200,255,.08)', border: '1px solid rgba(0,200,255,.2)', borderRadius: 6, color: ACCENT, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', padding: '6px 12px', textTransform: 'uppercase' }}>
      View More
    </button>
  </div>
</div>

export const OverviewTab = ({ bwHistory, onViewMorePeers, peers: knownPeers, sel, setSel, stats, uptime }: Props) => {
  const connections = knownPeers.filter(p => p.connection !== undefined)
  const peers = connections.filter(p => p.address !== '0x0')
  const peerCount = peers.length
  const connCount = connections.length
  const avgConf = peerCount ? peers.reduce((a, p) => a + (p.connection?.confidence ?? 0), 0) / peerCount : 0
  const avgLat = (() => {
    const measured = connections.filter(p => p.connection?.latency)
    return measured.length ? measured.reduce((a, p) => a + (p.connection?.latency ?? 0), 0) / measured.length : 0
  })()
  const avgLookup = (() => {
    const measured = connections.filter(p => p.connection?.lookupTime)
    return measured.length ? measured.reduce((a, p) => a + (p.connection?.lookupTime ?? 0), 0) / measured.length : 0
  })()
  const totalDL = connections.reduce((a, p) => a + (p.connection?.totalDL ?? 0), 0)
  const totalUL = connections.reduce((a, p) => a + (p.connection?.totalUL ?? 0), 0)
  const lifetimeDL = connections.reduce((a, p) => a + (p.connection?.lifetimeDL ?? 0), 0)
  const lifetimeUL = connections.reduce((a, p) => a + (p.connection?.lifetimeUL ?? 0), 0)

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(4, 1fr)' }}>
      <StatCard color={ACCENT2} label="DHT Nodes" sub="bootstrap nodes" value={stats?.dhtNodes.length ?? 0} />
      <StatCard color={ACCENT} label="Connected Peers" sub={`of ${knownPeers.length} known · ${connCount} total connections`} value={peerCount} />
      <StatCard color={confColor(avgConf)} label="Avg Confidence" sub="network-wide" value={peerCount ? `${(avgConf * 100).toFixed(1)}` : 'N/A'} />
      <StatCard color={PURPLE} label="Your Votes" sub={`${stats?.self.votes.tracks} tracks · ${stats?.self.votes.artists} artists · ${stats?.self.votes.albums} albums`} value={(stats?.self.votes.tracks ?? 0) + (stats?.self.votes.artists ?? 0) + (stats?.self.votes.albums ?? 0)} />

      <StatCard color={avgLat ? (avgLat < 100 ? GREEN : avgLat < 250 ? YELLOW : ORANGE) : MUTED} label="Avg Latency" sub={`${connections.filter(p => p.connection?.latency).length} peers measured`} value={avgLat ? `${Math.round(avgLat)}ms` : '—'} />
      <StatCard color={avgLookup ? (avgLookup < 100 ? GREEN : avgLookup < 250 ? YELLOW : ORANGE) : MUTED} label="Avg Lookup Time" sub={`${connections.filter(p => p.connection?.lookupTime).length} peers measured`} value={avgLookup ? `${Math.round(avgLookup)}ms` : '—'} />
      <StatCard color="#58a6ff" label="Session Uploaded" sub={`across ${connCount} connections`} value={formatBytes(totalUL)} />
      <StatCard color="#58a6ff" label="Lifetime Uploaded" sub="across all connections" value={formatBytes(lifetimeUL)} />
      
      <StatCard color={YELLOW} label="Node Uptime" sub="how long running" value={formatUptime(uptime)} />
      <StatCard color={ORANGE} label="Session Transfer" sub={`${formatBytes(totalDL)} down · ${formatBytes(totalUL)} up`} value={formatBytes(totalDL + totalUL)} />
      <StatCard color={ORANGE} label="Session Downloaded" sub={`across ${connCount} connections`} value={formatBytes(totalDL)} />
      <StatCard color={ORANGE} label="Lifetime Downloaded" sub="across all connections" value={formatBytes(lifetimeDL)} />
    </div>
    <NetworkPulseCanvas bwHistory={bwHistory} />
    <PeerList onViewMorePeers={onViewMorePeers} peers={connections} sel={sel} setSel={setSel} />
  </div>
}
