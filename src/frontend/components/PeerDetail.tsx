import { useEffect, useRef, useState } from "react";

import type { PeerStats, PeerWithCountry } from "../../types/hydrabase";

import { ACCENT, BG, BORD, confColor, latColor, MUTED, SURF } from "../theme";
import { fmtBytes, fmtUptime, shortAddr, toEmoji } from "../utils";
import { Identicon } from "./Identicon";
import { StatusDot } from "./StatusDot";

interface Props {
  // callback: (callback: ({ nonce, peer_stats }: { nonce: number; peer_stats: PeerStats, }) => void) => void
  onClose: () => void
  peer: null | PeerWithCountry
  wsRef: React.RefObject<undefined | WebSocket>
}

const nonceRoot = Math.random()

const Row = ({ color, label, value }: { color?: string; label: string; value: string; }) => <div style={{ alignItems: "center", borderBottom: `1px solid ${BORD}`, display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
  <span style={{ color: MUTED, fontSize: 11 }}>{label}</span>
  <span style={{ color: color ?? "#e6edf3", fontSize: 11, fontWeight: 600 }}>{value}</span>
</div>

const Tag = ({ active, label }: { active: boolean; label: string; }) => <span style={{ background: active ? "rgba(88,166,255,.12)" : "rgba(255,255,255,.04)", border: `1px solid ${active ? "#58a6ff55" : BORD}`, borderRadius: 4, color: active ? ACCENT : MUTED, fontSize: 10, padding: "3px 9px" }}>{label}</span>

const ConfBar = ({ label, value }: { label: string; value: number; }) => <div style={{ marginBottom: 10 }}>
  <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
    <span style={{ color: MUTED, fontSize: 10 }}>{label}</span>
    <span style={{ color: confColor(value), fontSize: 11, fontWeight: 700 }}>{(value * 100).toFixed(1)}%</span>
  </div>
  <div style={{ background: "#21262d", borderRadius: 3, height: 5, overflow: "hidden" }}>
    <div style={{ background: confColor(value), borderRadius: 3, height: "100%", transition: "width .4s", width: `${value * 100}%` }} />
  </div>
</div>

const Header = ({ onClose, peer }: { onClose: () => void; peer: PeerWithCountry }) => {
  const [copied, setCopied] = useState(false)
  const copyAddr = () => {
    navigator.clipboard.writeText(peer.address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return <div style={{ background: BG, borderBottom: `1px solid ${BORD}`, padding: "16px 20px" }}>
    <div style={{ alignItems: "flex-start", display: "flex", gap: 12, justifyContent: "space-between", marginBottom: 12 }}>
      <Identicon address={peer.address} size={40} style={{ borderRadius: 6, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ alignItems: "center", display: "flex", gap: 8, marginBottom: 4 }}>
          <StatusDot status={peer.connection !== undefined} />
          <span style={{ color: peer.connection === undefined ? "#f85149" : "#3fb950", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>{peer.connection !== undefined}</span>
          <span style={{ fontSize: 14 }}>{toEmoji(peer.country)}</span>
        </div>
        <div onClick={copyAddr} style={{ color: ACCENT, cursor: "pointer", fontFamily: "monospace", fontSize: 12, overflowWrap: "break-word", wordBreak: "break-all" }} title="Click to copy">
          {peer.address}
          <span style={{ color: MUTED, fontSize: 10, marginLeft: 8 }}>{copied ? "✓ copied" : "⎘"}</span>
        </div>
        <div style={{ color: MUTED, fontSize: 11, marginTop: 3 }}>ws://{peer.connection?.hostname}</div>
      </div>
      <button onClick={onClose} style={{ background: "none", border: `1px solid ${BORD}`, borderRadius: 6, color: MUTED, cursor: "pointer", flexShrink: 0, fontSize: 16, height: 32, lineHeight: 1, width: 32 }}>✕</button>
    </div>
    <ConfBar label="Historic Confidence" value={peer.connection?.confidence ?? 0} />
  </div>
}

const Section = ({ children, label }: { children: React.ReactNode; label: string; }) => <div style={{ marginBottom: 20 }}>
  <div style={{ borderBottom: `1px solid ${BORD}`, color: MUTED, fontSize: 9, fontWeight: 700, letterSpacing: ".12em", marginBottom: 10, paddingBottom: 6, textTransform: "uppercase" }}>{label}</div>
  {children}
</div>

const Statistics = ({ peer }: { peer: PeerWithCountry }) => <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr", marginBottom: 20 }}>
  {([
    ["Latency", peer.connection?.latency ? `${(peer.connection?.latency ?? 0).toFixed(1)}ms` : "—", peer.connection?.latency ? latColor(peer.connection?.latency) : MUTED],
    ["Uptime", fmtUptime(peer.connection?.uptime ?? 0), "#a5d6ff"],
    ["↑ UL", fmtBytes(peer.connection?.totalUL ?? 0), "#f0883e"],
    ["↓ DL", fmtBytes(peer.connection?.totalDL ?? 0), ACCENT],
  ] as [string, string, string][]).map(([l, v, c]) => <div key={l} style={{ background: BG, borderRadius: 7, padding: "10px 12px" }}>
    <div style={{ color: MUTED, fontSize: 9, letterSpacing: ".1em", marginBottom: 5, textTransform: "uppercase" }}>{l}</div>
    <div style={{ color: c, fontSize: 18, fontWeight: 700 }}>{v}</div>
  </div>)}
</div>

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

const Peer = ({ data, loading, onClose, peer, wsError }: { data: null | PeerStats; loading: boolean, onClose: () => void, peer: null | PeerWithCountry, wsError: null | string }) => <>
  <div onClick={onClose} style={{ background: "rgba(0,0,0,.55)", bottom: 0, left: 0, opacity: peer ? 1 : 0, pointerEvents: peer ? "all" : "none", position: "fixed", right: 0, top: 0, transition: "opacity .2s", zIndex: 50 }} />
  {peer && <div style={{ background: SURF, borderLeft: `1px solid ${BORD}`, bottom: 0, display: "flex", flexDirection: "column", overflowY: "auto", position: "fixed", right: 0, top: 0, transform: peer ? "translateX(0)" : "translateX(100%)", transition: "transform .25s cubic-bezier(.4,0,.2,1)", width: "min(460px, 100vw)", zIndex: 50 }}>
    <Header onClose={onClose} peer={peer} />
    <div style={{ flex: 1, padding: "16px 20px" }}>
      <Statistics peer={peer} />
      <Section label="Plugins"><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{(peer.connection?.plugins.length ?? 0) > 0 ? peer.connection?.plugins.map((pl) => <Tag active key={pl} label={pl} />) : <span style={{ color: MUTED, fontSize: 11 }}>No plugins reported</span>}</div></Section>
      {loading && <div style={{ color: MUTED, fontSize: 11, padding: "20px 0", textAlign: "center" }}>Loading peer stats…</div>}
      {wsError && !loading && <div style={{ color: "#f85149", fontSize: 11, padding: "20px 0", textAlign: "center" }}>{wsError}</div>}
      {data && !loading && <>
        <Reputation data={data} peer={peer} />
        {data.sharedPlugins.length > 0 && <Section label="Shared Plugins"><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{data.sharedPlugins.map((pl) => <Tag active key={pl} label={pl} />)}</div></Section>}
        {data.peerPlugins.length > 0 && <Section label="Peer Plugins"><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{data.peerPlugins.map((pl) => <Tag active key={pl} label={pl} />)}</div></Section>}
      </>}
      <Section label="Identity">
        <Row color={MUTED} label="Full Address" value={shortAddr(peer.address)} />
        <Row label="Country" value={`${toEmoji(peer.country)} ${peer.country}`} />
      </Section>
    </div>
  </div>}
</>

const requestPeerStats = (peer: PeerWithCountry, ws: WebSocket, pending: React.RefObject<Map<number, (d: PeerStats) => void>>, nonceRef: React.RefObject<number>, setData: (d: null | PeerStats) => void, setLoading: (v: boolean) => void, setWsError: (e: null | string) => void) => {
  setLoading(true)
  setData(null)
  setWsError(null)

  const nonce = nonceRef.current++
  const timeout = setTimeout(() => {
    if (!pending.current.has(nonce)) return
    pending.current.delete(nonce)
    setLoading(false)
    setWsError("Timed out waiting for peer stats")
  }, 10_000)

  pending.current.set(nonce, d => {
    clearTimeout(timeout)
    setData(d)
    setLoading(false)
  })

  ws.send(JSON.stringify({ nonce, peer_stats: { address: peer.address } }))
}

export const PeerDetail = ({ onClose, peer, wsRef }: Props) => {
  const [data, setData] = useState<null | PeerStats>(null)
  const [loading, setLoading] = useState(false)
  const [wsError, setWsError] = useState<null | string>(null)
  const nonceRef = useRef(Math.floor(nonceRoot * 90_000) + 10_000)
  const pending = useRef(new Map<number, (d: PeerStats) => void>())

  // const onPeerStats = ({ nonce, peer_stats }: { nonce: number; peer_stats: PeerStats }) => {
  //   const resolve = pending.current.get(nonce)
  //   if (!resolve) return
  //   pending.current.delete(nonce)
  //   resolve(peer_stats as PeerStats)
  // }
  // callback(onPeerStats)

  useEffect(() => {
    if (!peer || !wsRef.current) return
    requestPeerStats(peer, wsRef.current, pending, nonceRef, setData, setLoading, setWsError)
  }, [peer, peer?.address, wsRef])

  return <Peer data={data} loading={loading} onClose={onClose} peer={peer} wsError={wsError}/>
}
