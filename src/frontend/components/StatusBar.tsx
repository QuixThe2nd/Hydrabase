import type { PeerWithCountry, WsState } from '../../types/hydrabase'

import { ACCENT, BORD, MUTED, TEXT } from '../theme'
import { fmtBytes, fmtUptime } from '../utils'
import { SocketStatus } from './SocketStatus'

declare const VERSION: string

interface Props {
  dhtNodes: { country: string; host: string }[]
  peers: PeerWithCountry[]
  uptime: number
  wsState: WsState
}

const Sep = () => <span style={{ color: BORD, userSelect: 'none' }}>│</span>

const Item = ({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) => <span style={{ alignItems: 'center', display: 'flex', gap: 5 }}>
  <span style={{ color: MUTED, fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</span>
  <span style={{ color: valueColor ?? TEXT, fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>{value}</span>
</span>

export const StatusBar = ({ dhtNodes, peers, uptime, wsState }: Props) => {
  const connectedPeers = peers.filter(p => p.connection !== undefined && p.address !== '0x0')
  const knownPeers = peers.filter(p => p.address !== '0x0')
  const connCount = connectedPeers.length
  const peerCount = `${connCount}/${knownPeers.length}`
  const totalUL = connectedPeers.reduce((a, p) => a + (p.connection?.totalUL ?? 0), 0)
  const totalDL = connectedPeers.reduce((a, p) => a + (p.connection?.totalDL ?? 0), 0)
  const hasGithubNode = peers.some((p) => p.connection?.address?.toLowerCase() === '0x26cc08d7f906b2e55a06af561f870ec427d0caf7')
  const hasConnectedNonApiPeer = peers.some((p) => p.connection !== undefined && p.address !== '0x0')
  const connectability = hasGithubNode ? 'Connectable' : hasConnectedNonApiPeer ? 'Limited Connectivity' : 'Not Connectable'
  const connectabilityColor = hasGithubNode ? '#3fb950' : hasConnectedNonApiPeer ? '#d29922' : '#f85149'
  return <div style={{ alignItems: 'center', background: '#010409', borderTop: `1px solid ${BORD}`, bottom: 0, display: 'flex', gap: 12, height: 28, left: 0, padding: '0 14px', position: 'fixed', right: 0, zIndex: 48 }}>
    <SocketStatus state={wsState} />
    <Sep />
    <Item label="" value={connectability} valueColor={connectabilityColor} />
    <Sep />
    <Item label="peers" value={peerCount} valueColor="#3fb950" />
    <Sep />
    <Item label="DHT" value={String(dhtNodes.length)} valueColor={ACCENT} />
    <Sep />
    <Item label="↑" value={fmtBytes(totalUL)} valueColor="#58a6ff" />
    <Sep />
    <Item label="↓" value={fmtBytes(totalDL)} valueColor="#f0883e" />
    <Sep />
    <Item label="uptime" value={fmtUptime(uptime * 1_000)} />
    <span style={{ background: '#21262d', border: `1px solid ${BORD}`, borderRadius: 3, color: MUTED, fontSize: 9, letterSpacing: '.05em', marginLeft: 'auto', padding: '1px 5px' }}>v{VERSION}</span>
  </div>
}
