import { useCallback, useEffect, useRef, useState } from 'react'

import type { PeerStats, PeerWithCountry } from '../../types/hydrabase'
import type { MessageEnvelope } from '../../types/hydrabase-schemas'

import { ACCENT, BG, BG2, BG3, BORD, confColor, latColor, MUTED, SURF, TEXT } from '../theme'
import { fmtBytes, fmtUptime, shortAddr, toEmoji } from '../utils'
import { Identicon } from './Identicon'
import { StatusDot } from './StatusDot'

interface Props {
  callback: (handler: ({ nonce, peer_stats }: { nonce: number; peer_stats: PeerStats, }) => void) => void
  messages: MessageEnvelope[]
  onClose: () => void
  ownAddress: `0x${string}` | undefined
  peer: PeerWithCountry
  peers: PeerWithCountry[]
  sendMessage: (to: `0x${string}`, payload: string) => void
  wsRef: React.RefObject<undefined | WebSocket>
}

const nonceRoot = Math.random()

const Row = ({ color, label, value }: { color?: string; label: string; value: string; }) => <div style={{ alignItems: 'center', borderBottom: `1px solid ${BORD}`, display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
  <span style={{ color: MUTED, fontSize: 11 }}>{label}</span>
  <span style={{ color: color ?? '#e6edf3', fontSize: 11, fontWeight: 600 }}>{value}</span>
</div>

const Tag = ({ active, label }: { active: boolean; label: string; }) => <span style={{ background: active ? 'rgba(88,166,255,.12)' : 'rgba(255,255,255,.04)', border: `1px solid ${active ? '#58a6ff55' : BORD}`, borderRadius: 4, color: active ? ACCENT : MUTED, fontSize: 10, padding: '3px 9px' }}>{label}</span>

const ConfBar = ({ label, value }: { label: string; value: number; }) => <div style={{ marginBottom: 10 }}>
  <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
    <span style={{ color: MUTED, fontSize: 10 }}>{label}</span>
    <span style={{ color: confColor(value), fontSize: 11, fontWeight: 700 }}>{(value * 100).toFixed(1)}%</span>
  </div>
  <div style={{ background: '#21262d', borderRadius: 3, height: 5, overflow: 'hidden' }}>
    <div style={{ background: confColor(value), borderRadius: 3, height: '100%', transition: 'width .4s', width: `${value * 100}%` }} />
  </div>
</div>

const Header = ({ onClose, peer }: { onClose: () => void; peer: PeerWithCountry }) => {
  const peerIdentity = peer.connection ?? peer.auth
  const [copied, setCopied] = useState(false)
  const copyAddr = () => {
    navigator.clipboard.writeText(peer.address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return <div style={{ background: BG3, borderBottom: `1px solid ${BORD}`, padding: '16px 20px' }}>
    <div style={{ marginBottom: 14 }}>
      <button onClick={onClose} style={{ alignItems: 'center', background: 'none', border: 'none', color: MUTED, cursor: 'pointer', display: 'flex', fontSize: 12, gap: 6, padding: 0 }}>
        <span style={{ fontSize: 16, lineHeight: 1 }}>←</span> Back
      </button>
    </div>
    <div style={{ alignItems: 'flex-start', display: 'flex', gap: 12, marginBottom: 12 }}>
      <Identicon address={peer.address} size={40} style={{ borderRadius: 6, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ alignItems: 'center', display: 'flex', gap: 8, marginBottom: 4 }}>
          <StatusDot status={peer.connection !== undefined} />
          <span style={{ color: peer.connection === undefined ? '#f85149' : '#3fb950', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{peer.connection !== undefined}</span>
          <span style={{ fontSize: 14 }}>{toEmoji(peer.country)}</span>
        </div>
        <div onClick={copyAddr} style={{ color: ACCENT, cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, overflowWrap: 'break-word', wordBreak: 'break-all' }} title="Click to copy">
          {peer.address}
          <span style={{ color: MUTED, fontSize: 10, marginLeft: 8 }}>{copied ? '✓ copied' : '⎘'}</span>
        </div>
        {peerIdentity?.hostname && <div style={{ color: MUTED, fontSize: 11, marginTop: 3 }}>ws://{peerIdentity.hostname}</div>}
      </div>
    </div>
    <ConfBar label="Historic Confidence" value={peer.connection?.confidence ?? 0} />
  </div>
}

const Section = ({ children, label }: { children: React.ReactNode; label: string; }) => <div style={{ marginBottom: 20 }}>
  <div style={{ borderBottom: `1px solid ${BORD}`, color: MUTED, fontSize: 9, fontWeight: 700, letterSpacing: '.12em', marginBottom: 10, paddingBottom: 6, textTransform: 'uppercase' }}>{label}</div>
  {children}
</div>

const Statistics = ({ peer }: { peer: PeerWithCountry }) => {
  const {connection} = peer
  return <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr', marginBottom: 20 }}>
    {([
      ['Connections', String(connection?.connectionCount ?? 0), '#79c0ff'],
      ['Latency', connection?.latency ? `${(connection.latency).toFixed(1)}ms` : '—', connection?.latency ? latColor(connection.latency) : MUTED],
      ['Uptime', fmtUptime(connection?.uptime ?? 0), '#a5d6ff'],
      ['↑ Session UL', fmtBytes(connection?.totalUL ?? 0), ACCENT],
      ['↓ Session DL', fmtBytes(connection?.totalDL ?? 0), '#f0883e'],
      ['↑ Lifetime UL', fmtBytes(connection?.lifetimeUL ?? 0), '#79c0ff'],
      ['↓ Lifetime DL', fmtBytes(connection?.lifetimeDL ?? 0), '#ffa657'],
    ] as [string, string, string][]).map(([l, v, c]) => <div key={l} style={{ background: BG, borderRadius: 7, padding: '10px 12px' }}>
    <div style={{ color: MUTED, fontSize: 9, letterSpacing: '.1em', marginBottom: 5, textTransform: 'uppercase' }}>{l}</div>
    <div style={{ color: c, fontSize: 18, fontWeight: 700 }}>{v}</div>
  </div>)}
  </div>
}

const Reputation = ({ data, peer }: { data: PeerStats; peer: PeerWithCountry }) => {
  const totalVotes = data.votes.tracks + data.votes.artists + data.votes.albums
  const accuracy = (data.totalMatches + data.totalMismatches) > 0 ? data.totalMatches / (data.totalMatches + data.totalMismatches) : peer.connection?.confidence ?? 0
  return <Section label="Reputation">
    <Row label="Total Votes Observed" value={String(totalVotes)} />
    <Row color={MUTED} label="  Tracks" value={String(data.votes.tracks)} />
    <Row color={MUTED} label="  Artists" value={String(data.votes.artists)} />
    <Row color={MUTED} label="  Albums" value={String(data.votes.albums)} />
    <Row color="#3fb950" label="Matches" value={String(data.totalMatches)} />
    <Row color="#f85149" label="Mismatches" value={String(data.totalMismatches)} />
    <Row color={confColor(accuracy)} label="Accuracy (shared plugins)" value={`${(accuracy * 100).toFixed(1)}%`} />
  </Section>
}

const fmtTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const MessagePanel = ({ messages, onSend, ownAddress, peerAddress }: { messages: MessageEnvelope[]; onSend: (payload: string) => void; ownAddress: `0x${string}` | undefined; peerAddress: `0x${string}` }) => {
  const [text, setText] = useState('')
  const threadEndRef = useRef<HTMLDivElement>(null)
  const thread = messages.filter(m => m.from === peerAddress || m.to === peerAddress)

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread.length])

  const handleSend = () => {
    if (!text.trim()) return
    onSend(text.trim())
    setText('')
  }

  return <Section label="Message">
    <div style={{ background: SURF, border: `1px solid ${BORD}`, borderRadius: 6, display: 'flex', flexDirection: 'column', maxHeight: 280, minHeight: 80, overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
        {thread.length === 0
          ? <div style={{ color: MUTED, fontSize: 11, paddingTop: 4, textAlign: 'center' }}>No messages yet. Say hello!</div>
          : thread.map((msg, i) => {
              const isMine = msg.from === ownAddress
              return <div key={i} style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start', marginBottom: 6 }}>
                <div style={{ background: isMine ? '#063a4a' : '#1e2c3a', border: `1px solid ${isMine ? '#0a6080' : '#2a3f52'}`, borderRadius: isMine ? '10px 10px 2px 10px' : '10px 10px 10px 2px', maxWidth: '80%', padding: '6px 10px' }}>
                  <div style={{ fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.payload}</div>
                  <div style={{ color: MUTED, fontSize: 9, marginTop: 3, textAlign: 'right' }}>{fmtTime(msg.timestamp)}</div>
                </div>
              </div>
            })}
        <div ref={threadEndRef} />
      </div>
      <div style={{ alignItems: 'flex-end', borderTop: `1px solid ${BORD}`, display: 'flex', gap: 6, padding: '8px 10px' }}>
        <textarea
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="Type a message… (Enter to send)"
          rows={2}
          style={{ background: BG, border: `1px solid ${BORD}`, borderRadius: 5, color: TEXT, flex: 1, fontFamily: 'inherit', fontSize: 11, padding: '6px 8px', resize: 'none' }}
          value={text}
        />
        <button
          disabled={!text.trim()}
          onClick={handleSend}
          style={{ background: text.trim() ? ACCENT : 'transparent', border: `1px solid ${text.trim() ? ACCENT : BORD}`, borderRadius: 5, color: text.trim() ? '#000' : MUTED, cursor: text.trim() ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, padding: '8px 14px' }}
        >Send</button>
      </div>
    </div>
  </Section>
}

const getAnnouncedAddresses = (address: `0x${string}`, peers: PeerWithCountry[]): `0x${string}`[] => peers
  .filter(peer => peer.address !== address && (peer.connection?.connections ?? []).includes(address))
  .map(peer => peer.address)

const Peer = ({ data, loading, messages, onClose, onSend, ownAddress, peer, peers, wsError }: { data: null | PeerStats; loading: boolean, messages: MessageEnvelope[]; onClose: () => void, onSend: (payload: string) => void; ownAddress: `0x${string}` | undefined; peer: PeerWithCountry, peers: PeerWithCountry[]; wsError: null | string }) => <div style={{ background: BG2, border: `1px solid ${BORD}`, borderRadius: 10, overflow: 'hidden' }}>
  <Header onClose={onClose} peer={peer} />
  <div style={{ padding: '16px 20px' }}>
    <MessagePanel messages={messages} onSend={onSend} ownAddress={ownAddress} peerAddress={peer.address} />
    <Statistics peer={peer} />
    <Section label="Plugins"><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{(peer.connection?.plugins.length ?? 0) > 0 ? peer.connection?.plugins.map((pl) => <Tag active key={pl} label={pl} />) : <span style={{ color: MUTED, fontSize: 11 }}>No plugins reported</span>}</div></Section>
    {(peer.connection?.connections.length ?? 0) > 0 && <Section label="Announced By"><div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{peer.connection?.connections.map((addr) => <div key={addr} style={{ color: ACCENT, fontFamily: 'monospace', fontSize: 11 }}>{addr}</div>)}</div></Section>}
    {getAnnouncedAddresses(peer.address, peers).length > 0 && <Section label="Announced"><div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{getAnnouncedAddresses(peer.address, peers).map((addr) => <div key={addr} style={{ color: ACCENT, fontFamily: 'monospace', fontSize: 11 }}>{addr}</div>)}</div></Section>}
    {loading && <div style={{ color: MUTED, fontSize: 11, padding: '20px 0', textAlign: 'center' }}>Loading peer stats…</div>}
    {wsError && !loading && <div style={{ color: '#f85149', fontSize: 11, padding: '20px 0', textAlign: 'center' }}>{wsError}</div>}
    {data && !loading && <>
      <Reputation data={data} peer={peer} />
      {data.sharedPlugins.length > 0 && <Section label="Shared Plugins"><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{data.sharedPlugins.map((pl) => <Tag active key={pl} label={pl} />)}</div></Section>}
      {data.peerPlugins.length > 0 && <Section label="Peer Plugins"><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{data.peerPlugins.map((pl) => <Tag active key={pl} label={pl} />)}</div></Section>}
    </>}
    <Section label="Identity">
      <Row color={MUTED} label="Full Address" value={shortAddr(peer.address)} />
      <Row label="Username" value={peer.connection?.username ?? peer.auth?.username ?? 'Unknown'} />
      <Row label="User Agent" value={peer.connection?.userAgent ?? peer.auth?.userAgent ?? 'Unknown'} />
      {(peer.connection?.bio ?? peer.auth?.bio) && <Row label="Bio" value={peer.connection?.bio ?? peer.auth?.bio ?? ''} />}
      <Row label="Country" value={`${toEmoji(peer.country)} ${peer.country}`} />
    </Section>
  </div>
</div>

const requestPeerStats = (peer: PeerWithCountry, ws: WebSocket, pending: React.RefObject<Map<number, (d: PeerStats) => void>>, nonceRef: React.RefObject<number>, setData: (d: null | PeerStats) => void, setLoading: (v: boolean) => void, setWsError: (e: null | string) => void) => {
  setLoading(true)
  setData(null)
  setWsError(null)

  const nonce = nonceRef.current++
  const timeout = setTimeout(() => {
    if (!pending.current.has(nonce)) return
    pending.current.delete(nonce)
    setLoading(false)
    setWsError('Timed out waiting for peer stats')
  }, 10_000)

  pending.current.set(nonce, d => {
    clearTimeout(timeout)
    setData(d)
    setLoading(false)
  })

  ws.send(JSON.stringify({ nonce, peer_stats: { address: peer.address } }))
}

export const PeerDetail = ({ callback, messages, onClose, ownAddress, peer, peers, sendMessage, wsRef }: Props) => {
  const [data, setData] = useState<null | PeerStats>(null)
  const [loading, setLoading] = useState(false)
  const [wsError, setWsError] = useState<null | string>(null)
  const nonceRef = useRef(Math.floor(nonceRoot * 90_000) + 10_000)
  const pending = useRef(new Map<number, (d: PeerStats) => void>())

  const onPeerStats = useCallback(({ nonce, peer_stats }: { nonce: number; peer_stats: PeerStats }) => {
    const resolve = pending.current.get(nonce)
    if (!resolve) return
    pending.current.delete(nonce)
    resolve(peer_stats)
  }, [])

  useEffect(() => {
    callback(onPeerStats)
  }, [callback, onPeerStats])

  useEffect(() => {
    if (!wsRef.current) return
    requestPeerStats(peer, wsRef.current, pending, nonceRef, setData, setLoading, setWsError)
  }, [peer, peer.address, wsRef])

  const handleSend = (payload: string) => sendMessage(peer.address, payload)

  return <Peer data={data} loading={loading} messages={messages} onClose={onClose} onSend={handleSend} ownAddress={ownAddress} peer={peer} peers={peers} wsError={wsError}/>
}
