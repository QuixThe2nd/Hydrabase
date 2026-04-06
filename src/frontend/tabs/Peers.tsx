/* eslint-disable max-lines */
import { useState } from 'react'

import type { ApiPeer, FilterState, PeerConnectionAttempt, PeerWithCountry } from '../../types/hydrabase'

import ConnectPeerDialog from '../components/ConnectPeerDialog'
import { Identicon } from '../components/Identicon'
import { StatusDot } from '../components/StatusDot'
import { ACCENT, BORD, confColor, latColor, MUTED, panel } from '../theme'
import { fmtBytes, fmtUptime, shortAddr, toEmoji } from '../utils'

interface Props {
  connectionAttempts: PeerConnectionAttempt[];
  filter: FilterState;
  onRequestConnect?: (hostname: `${string}:${number}`) => void;
  peers: PeerWithCountry[];
  sel: ApiPeer | null;
  setFilter: (f: FilterState) => void;
  setSel: (p: null | PeerWithCountry) => void;
  sorted: PeerWithCountry[];
}

const FILTERS = ['all', 'connected', 'disconnected'] as const
const CONN_TYPE_ORDER = ['CLIENT', 'SERVER', 'UTP'] as const
type ConnType = typeof CONN_TYPE_ORDER[number]

const CONN_TYPE_COLORS: Record<ConnType, string> = {
  CLIENT: '#79c0ff',
  SERVER: '#3fb950',
  UTP: '#a371f7',
}

const CONN_TYPE_LABELS: Record<ConnType, string> = {
  CLIENT: 'Client (ws://)',
  SERVER: 'Server (wsc://)',
  UTP: 'UTP',
}

const isConnType = (type: string | undefined): type is ConnType =>
  type === 'CLIENT' || type === 'SERVER' || type === 'UTP'

const countPeerConnTypes = (sorted: PeerWithCountry[]) => {
  const counts: Record<ConnType, number> = { CLIENT: 0, SERVER: 0, UTP: 0 }
  sorted.forEach((peer) => {
    const type = peer.connection?.type
    if (isConnType(type)) counts[type] += 1
  })
  return counts
}

const buildPieBackground = (counts: Record<ConnType, number>) => {
  const typedConnected = CONN_TYPE_ORDER.reduce((sum, type) => sum + counts[type], 0)
  if (typedConnected === 0) return '#21262d'

  const sections = CONN_TYPE_ORDER
    .filter((type) => counts[type] > 0)
    .reduce<{ parts: string[]; startPct: number }>((acc, type) => {
      const endPct = acc.startPct + (counts[type] / typedConnected) * 100
      const part = `${CONN_TYPE_COLORS[type]} ${acc.startPct}% ${endPct}%`
      return { parts: [...acc.parts, part], startPct: endPct }
    }, { parts: [], startPct: 0 })

  return `conic-gradient(${sections.parts.join(', ')})`
}

const ConnectionTypePie = ({ counts }: { counts: Record<ConnType, number> }) => {
  const typedConnected = CONN_TYPE_ORDER.reduce((sum, type) => sum + counts[type], 0)

  return <div
    aria-label='Connection type distribution pie chart'
    style={{
      background: buildPieBackground(counts),
      border: `1px solid ${BORD}`,
      borderRadius: '50%',
      height: 88,
      position: 'relative',
      width: 88,
    }}
    title='Connection type distribution'
  >
    <div style={{
      alignItems: 'center',
      background: '#0d1117',
      border: `1px solid ${BORD}`,
      borderRadius: '50%',
      color: '#c9d1d9',
      display: 'flex',
      fontSize: 10,
      fontWeight: 700,
      height: 48,
      inset: '50% auto auto 50%',
      justifyContent: 'center',
      position: 'absolute',
      transform: 'translate(-50%, -50%)',
      width: 48,
    }}>
      {typedConnected}
    </div>
  </div>
}

const getConnectionPrefix = (type?: 'CLIENT' | 'SERVER' | 'UTP') => {
  if (!type) return undefined
  if (type === 'UTP') return 'utp://'
  if (type === 'CLIENT') return 'ws://'
  if (type === 'SERVER') return 'wsc://'
  return undefined
}

const PeersOverview = ({ sorted }: { sorted: PeerWithCountry[] }) => {
  const totalPeers = sorted.length
  const connectedPeers = sorted.filter((peer) => peer.connection !== undefined).length
  const disconnectedPeers = totalPeers - connectedPeers
  const connTypeCounts = countPeerConnTypes(sorted)

  return <div style={{ ...panel(), padding: 14 }}>
    <div style={{ color: MUTED, fontSize: 10, letterSpacing: '.1em', marginBottom: 10, textTransform: 'uppercase' }}>Peer Stats</div>
    <div style={{ alignItems: 'center', display: 'grid', gap: 14, gridTemplateColumns: 'auto 1fr' }}>
      <ConnectionTypePie counts={connTypeCounts} />

      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ background: '#0d1117', border: `1px solid ${BORD}`, borderRadius: 999, color: '#79c0ff', fontSize: 10, padding: '3px 8px' }}>Total: {totalPeers}</span>
          <span style={{ background: '#0d1117', border: `1px solid ${BORD}`, borderRadius: 999, color: '#3fb950', fontSize: 10, padding: '3px 8px' }}>Connected: {connectedPeers}</span>
          <span style={{ background: '#0d1117', border: `1px solid ${BORD}`, borderRadius: 999, color: '#f85149', fontSize: 10, padding: '3px 8px' }}>Disconnected: {disconnectedPeers}</span>
        </div>

        <div style={{ display: 'grid', gap: 4 }}>
          {CONN_TYPE_ORDER.map((type) => <div key={type} style={{ alignItems: 'center', display: 'flex', fontSize: 10, gap: 6 }}>
            <span style={{ background: CONN_TYPE_COLORS[type], borderRadius: 2, height: 8, width: 8 }} />
            <span style={{ color: MUTED }}>{CONN_TYPE_LABELS[type]}</span>
            <span style={{ color: '#c9d1d9', marginLeft: 'auto' }}>{connTypeCounts[type]}</span>
          </div>)}
        </div>
      </div>
    </div>
  </div>
}

const MetaChips = ({ peer }: { peer: PeerWithCountry }) => {
  const meta = [
    (peer.connection?.username || peer.auth?.username) ? peer.address : undefined,
    (peer.connection?.hostname || peer.auth?.hostname)
      ? `${getConnectionPrefix(peer.connection?.type) ?? ''}${peer.connection?.hostname || peer.auth?.hostname}`
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

interface AnnouncementEntry {
  key: string
  label: string
  secondary: string
  unresolved: boolean
}

const getPeerDisplayName = (address: `0x${string}`, peers: PeerWithCountry[]): string => {
  const peer = peers.find(candidate => candidate.address === address)
  if (!peer) return shortAddr(address)
  return peer.connection?.username || peer.auth?.username || shortAddr(address)
}

const AnnouncementCard = ({ entries, label }: { entries: AnnouncementEntry[]; label: string }) => <div style={{ background: '#0d1117', border: `1px solid ${BORD}`, borderRadius: 6, padding: '8px 10px' }}>
  <div style={{ color: MUTED, fontSize: 9, letterSpacing: '.1em', marginBottom: 6, textTransform: 'uppercase' }}>{label}</div>
  {entries.length === 0
    ? <div style={{ color: MUTED, fontSize: 10 }}>none</div>
    : <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {entries.map((entry) => <div key={entry.key} style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
        {!entry.unresolved && <Identicon address={entry.key.slice(5) as `0x${string}`} size={14} />}
        {entry.unresolved && <span style={{ color: '#f0883e', fontSize: 11, lineHeight: 1 }}>◌</span>}
        <span style={{ color: '#c9d1d9', fontSize: 10 }}>{entry.label}</span>
        <span style={{ color: entry.unresolved ? '#f0883e' : MUTED, fontFamily: 'monospace', fontSize: 9, marginLeft: 'auto' }}>{entry.secondary}</span>
      </div>)}
    </div>}
</div>

const AnnouncementOverview = ({ peer, peers }: { peer: PeerWithCountry; peers: PeerWithCountry[] }) => {
  const announcedByEntries: AnnouncementEntry[] = (peer.announcedBy ?? peer.connection?.connections ?? []).map((address) => ({
    key: `addr:${address}`,
    label: getPeerDisplayName(address, peers),
    secondary: shortAddr(address),
    unresolved: false,
  }))
  const announcedEntries: AnnouncementEntry[] = peers
    .filter((candidate) => (candidate.announcedBy ?? []).includes(peer.address))
    .map((candidate) => ({
      key: `addr:${candidate.address}`,
      label: getPeerDisplayName(candidate.address, peers),
      secondary: shortAddr(candidate.address),
      unresolved: false,
    }))
  return <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', marginBottom: 10 }}>
    <AnnouncementCard entries={announcedByEntries} label='Announced By' />
    <AnnouncementCard entries={announcedEntries} label='Announced' />
  </div>
}

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
  if (peer.address === '0x0') return null
  const confidence = peer.connection?.confidence ?? 0
  const confidenceColor = confColor(confidence)

  return <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ color: MUTED, fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase' }}>Historic Confidence</span>
      <span style={{ color: confidenceColor, fontSize: 10, fontWeight: 700 }}>{(confidence * 100).toFixed(1)}</span>
    </div>
    <div style={{ background: '#21262d', borderRadius: 2, height: 4, overflow: 'hidden' }}>
      <div style={{ background: confidenceColor, borderRadius: 2, height: '100%', transition: 'width .3s', width: `${confidence * 100}%` }} />
    </div>
  </div>
}

const PeerCard = ({ peer, peers, selected, setSel }: { peer: PeerWithCountry; peers: PeerWithCountry[]; selected: boolean; setSel: (p: null | PeerWithCountry) => void }) => {
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
      <AnnouncementOverview peer={peer} peers={peers} />
      <ConfidenceBar peer={peer} />
    </div>
  </div>
}

export const PeersTab = ({ connectionAttempts, filter, onRequestConnect, peers, sel, setFilter, setSel, sorted }: Props) => {
  const [showConnectDialog, setShowConnectDialog] = useState(false)

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <PeersOverview sorted={sorted} />
    <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <span style={{ color: MUTED, fontSize: 11 }}>Filter:</span>
      {FILTERS.map((status) => <button className={`fbtn${filter === status ? ' on' : ''}`} key={status} onClick={() => setFilter(status)}>{status}</button>)}
      <span style={{ color: MUTED, fontSize: 11, marginLeft: 'auto' }}>{sorted.length} peers</span>
      <button
        onClick={() => setShowConnectDialog(true)}
        style={{
          background: ACCENT,
          border: 'none',
          borderRadius: 4,
          color: '#0d1117',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 700,
          padding: '4px 12px',
        }}
      >
        + Connect
      </button>
    </div>
    {sorted.map((peer) => <PeerCard key={peer.address} peer={peer} peers={peers} selected={sel?.address === peer.address} setSel={setSel} />)}
    {showConnectDialog && (
      <ConnectPeerDialog
        connectionAttempts={connectionAttempts}
        onClose={() => setShowConnectDialog(false)}
        onConnect={(hostname) => {
          onRequestConnect?.(hostname)
        }}
      />
    )}
  </div>
}

