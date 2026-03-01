
import { useEffect, useState } from "react";

import type { PeerWithCountry } from "../types";

import { toEmoji } from "../geo";
import { ACCENT, BG, BORD, confColor, latColor, MUTED, SURF } from "../theme";
import { fmtBytes, fmtUptime, shortAddr } from "../utils";
import { StatusDot } from "./StatusDot";

interface PeerDetailData {
  recentActivity: { confidence: number; plugin: string; time: string; type: string; }[]
  sharedPlugins: string[]
  totalMatches: number
  totalMismatches: number
  votes: PeerVotes
}

interface PeerVotes {
  albums: number
  artists: number
  tracks: number
}

interface Props {
  apiBase?: string
  apiKey: string
  onClose: () => void
  peer: null | PeerWithCountry
}

const Row = ({ color, label, value }: { color?: string; label: string; value: string; }) => <div style={{ alignItems: "center", borderBottom: `1px solid ${BORD}`, display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
  <span style={{ color: MUTED, fontSize: 11 }}>{label}</span>
  <span style={{ color: color ?? "#e6edf3", fontSize: 11, fontWeight: 600 }}>{value}</span>
</div>

const Tag = ({ active, label }: { active: boolean; label: string; }) => <span style={{
  background: active ? "rgba(88,166,255,.12)" : "rgba(255,255,255,.04)",
  border: `1px solid ${active ? "#58a6ff55" : BORD}`,
  borderRadius: 4,
  color: active ? ACCENT : MUTED,
  fontSize: 10,
  padding: "3px 9px",
}}>{label}</span>

const ConfBar = ({ label, value }: { label: string; value: number; }) => <div style={{ marginBottom: 10 }}>
  <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
    <span style={{ color: MUTED, fontSize: 10 }}>{label}</span>
    <span style={{ color: confColor(value), fontSize: 11, fontWeight: 700 }}>{(value * 100).toFixed(1)}%</span>
  </div>
  <div style={{ background: "#21262d", borderRadius: 3, height: 5, overflow: "hidden" }}>
    <div style={{ background: confColor(value), borderRadius: 3, height: "100%", transition: "width .4s", width: `${value * 100}%` }} />
  </div>
</div>

const Header = ({ onClose, peer }: { onClose: () => void, peer: PeerWithCountry }) => {
  const [copied, setCopied] = useState(false)
  const copyAddr = () => {
    if (!peer) return
    navigator.clipboard.writeText(peer.address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return <div style={{ background: BG, borderBottom: `1px solid ${BORD}`, padding: "16px 20px" }}>
    <div style={{ alignItems: "flex-start", display: "flex", gap: 12, justifyContent: "space-between", marginBottom: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ alignItems: "center", display: "flex", gap: 8, marginBottom: 4 }}>
          <StatusDot status={peer.status} />
          <span style={{ color: peer.status === "connected" ? "#3fb950" : "#f85149", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>{peer.status}</span>
          <span style={{ fontSize: 14 }}>{toEmoji(peer.country)}</span>
        </div>
        <div onClick={copyAddr} style={{ color: ACCENT, cursor: "pointer", fontFamily: "monospace", fontSize: 12, overflowWrap: "break-word", wordBreak: "break-all" }} title="Click to copy">
          {peer.address}
          <span style={{ color: MUTED, fontSize: 10, marginLeft: 8 }}>{copied ? "✓ copied" : "⎘"}</span>
        </div>
        <div style={{ color: MUTED, fontSize: 11, marginTop: 3 }}>ws://{peer.hostname}</div>
      </div>
      <button onClick={onClose} style={{ background: "none", border: `1px solid ${BORD}`, borderRadius: 6, color: MUTED, cursor: "pointer", flexShrink: 0, fontSize: 16, height: 32, lineHeight: 1, width: 32 }}>✕</button>
    </div>
    <ConfBar label="Historic Confidence" value={peer.confidence} />
  </div>
}

const Section = ({ children, label }: { children: React.ReactNode; label: string; }) => <div style={{ marginBottom: 20 }}>
  <div style={{ borderBottom: `1px solid ${BORD}`, color: MUTED, fontSize: 9, fontWeight: 700, letterSpacing: ".12em", marginBottom: 10, paddingBottom: 6, textTransform: "uppercase" }}>{label}</div>
  {children}
</div>

const RecentActivity = ({ data }: { data: PeerDetailData }) => data.recentActivity.length > 0 && <Section label="Recent Activity">
  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
    {data.recentActivity.map((a, i) => (
      <div key={i} style={{ alignItems: "center", borderBottom: `1px solid ${BORD}`, display: "flex", gap: 10, padding: "7px 0" }}>
        <span style={{ color: MUTED, flexShrink: 0, fontFamily: "monospace", fontSize: 9, minWidth: 60 }}>{a.time}</span>
        <span style={{ background: "#21262d", borderRadius: 3, color: ACCENT, flexShrink: 0, fontSize: 9, padding: "1px 6px" }}>{a.type}</span>
        <span style={{ color: MUTED, flex: 1, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.plugin}</span>
        <span style={{ color: confColor(a.confidence), flexShrink: 0, fontSize: 10, fontWeight: 700 }}>{(a.confidence * 100).toFixed(0)}%</span>
      </div>
    ))}
  </div>
</Section>

const SharedPlugins = ({ data }: { data: PeerDetailData }) => data.sharedPlugins.length > 0 && <Section label="Shared Plugins (used for confidence)">
  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
    {data.sharedPlugins.map((pl) => <Tag active key={pl} label={pl} />)}
  </div>
</Section>

const Reputation = ({ data, peer }: { data: PeerDetailData, peer: PeerWithCountry }) => {
  const totalVotes = data ? data.votes.tracks + data.votes.artists + data.votes.albums : 0;
  const accuracy = data && (data.totalMatches + data.totalMismatches) > 0 ? data.totalMatches / (data.totalMatches + data.totalMismatches) : peer?.confidence ?? 0

  return <Section label="Reputation">
    <Row label="Total Votes Observed" value={String(totalVotes)} />
    <Row color={MUTED} label="Tracks" value={String(data.votes.tracks)} />
    <Row color={MUTED} label="Artists" value={String(data.votes.artists)} />
    <Row color={MUTED} label="Albums" value={String(data.votes.albums)} />
    <Row color="#3fb950" label="Matches" value={String(data.totalMatches)} />
    <Row color="#f85149" label="Mismatches" value={String(data.totalMismatches)} />
    <Row color={confColor(accuracy)} label="Accuracy (shared plugins)" value={`${(accuracy * 100).toFixed(1)}%`} />
  </Section>
}

const Statistics = ({ peer }: { peer: PeerWithCountry }) => <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr", marginBottom: 20 }}>
  {([
    ["Latency", peer.latency ? `${(peer.latency).toFixed(1)}ms` : "—",  peer.latency ? latColor(peer.latency) : MUTED],
    ["Uptime", fmtUptime(peer.uptime), "#a5d6ff"],
    ["↓ RX", fmtBytes(peer.rxTotal), ACCENT],
    ["↑ TX", fmtBytes(peer.txTotal), "#f0883e"],
  ] as [string, string, string][]).map(([l, v, c]) => <div key={l} style={{ background: BG, borderRadius: 7, padding: "10px 12px" }}>
    <div style={{ color: MUTED, fontSize: 9, letterSpacing: ".1em", marginBottom: 5, textTransform: "uppercase" }}>{l}</div>
    <div style={{ color: c, fontSize: 18, fontWeight: 700 }}>{v}</div>
  </div>)}
</div>

export const PeerDetail = ({ apiBase = "/api", apiKey, onClose, peer }: Props) => {
  const [data, setData] = useState<null | PeerDetailData>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!peer) return setData(null)
    setLoading(true)
    setData(null)

    fetch(`${apiBase}/peer/${peer.address}`, { headers: { "X-Api-Key": apiKey } })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: PeerDetailData) => setData(d))
      .catch(() => {
        // TODO: API not yet implemented — synthesise sensible placeholders from what we have
        setData({ recentActivity: [], sharedPlugins: [], totalMatches: 0, totalMismatches: 0, votes: { albums: 0, artists: 0, tracks: 0 } })
      })
      .finally(() => setLoading(false))
  }, [apiBase, apiKey, peer, peer?.address])

  const visible = Boolean(peer)

  return <>
    <div onClick={onClose} style={{ background: "rgba(0,0,0,.55)", bottom: 0, left: 0, opacity: visible ? 1 : 0, pointerEvents: visible ? "all" : "none", position: "fixed", right: 0, top: 0, transition: "opacity .2s", zIndex: 50 }} />
    <div style={{ background: SURF, borderLeft: `1px solid ${BORD}`, bottom: 0, display: "flex", flexDirection: "column", overflowY: "auto", position: "fixed", right: 0, top: 0, transform: visible ? "translateX(0)" : "translateX(100%)", transition: "transform .25s cubic-bezier(.4,0,.2,1)", width: "min(460px, 100vw)", zIndex: 50 }}>
      {peer && <>
        <Header onClose={onClose} peer={peer} />
        <div style={{ flex: 1, padding: "16px 20px" }}>
          <Statistics peer={peer} />
          <Section label="Plugins">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{peer.plugins.length > 0 ? peer.plugins.map((pl) => <Tag active key={pl} label={pl} />) : <span style={{ color: MUTED, fontSize: 11 }}>No plugins reported</span>}</div>
          </Section>
          {loading ? <div style={{ color: MUTED, fontSize: 11, padding: "20px 0", textAlign: "center" }}>Loading peer details…</div> : data ? <>
            <Reputation data={data} peer={peer} />
            <SharedPlugins data={data} />
            <RecentActivity data={data} />
          </> : null}
          <Section label="Identity">
            <Row color={MUTED} label="Full Address" value={shortAddr(peer.address)} />
            <Row label="Country" value={`${toEmoji(peer.country)} ${peer.country}`} />
          </Section>
        </div>
      </>}
    </div>
  </>
}
