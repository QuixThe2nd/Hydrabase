import type { ApiPeer } from "../../../../../src/StatsReporter"
import type { PeerWithCountry, VoteCounts } from "../../../types"

import { toEmoji } from "../../../geo"
import { ACCENT, ACCENT2, BORD, BG2, confColor, DIM, GREEN, MUTED, ORANGE, PURPLE, TEXT, YELLOW } from "../../../theme"
import { shortAddr } from "../../../utils"
import { Identicon } from "../../Identicon"
import { StatCard } from "../../StatCard"
import { NetworkPulseCanvas } from "../../Pulse"

interface BwPoint { rx: number; tx: number }

interface Props {
  bwHistory: BwPoint[]
  peers: PeerWithCountry[]
  sel: ApiPeer | null
  setSel: (p: PeerWithCountry | null) => void
  votes: VoteCounts
}

const ActivityBar = ({ data }: { data: number[] }) => <div style={{ alignItems: "flex-end", display: "flex", gap: 1.5, height: 14 }}>
  {data.map((v, i) => <div key={i} style={{ background: ACCENT2, borderRadius: 1, height: Math.max(2, (v / 100) * 14), opacity: 0.3 + (v / 140), transition: "height .3s ease", width: 3 }} />)}
</div>
const StatusDotPulse = ({ status }: { status: string }) => <div style={{ animation: status === "connected" ? "pulse-dot 1.4s ease infinite" : undefined, background: status === "connected" ? GREEN : "#ff4a5e66", borderRadius: "50%", flexShrink: 0, height: 7, width: 7 }} />

const CONF_BAR_W = 38

const PeerRow = ({ isSelected, onSelect, peer }: { isSelected: boolean; onSelect: () => void; peer: PeerWithCountry }) => {
  const confColor_ = confColor(peer.confidence)
  const isConn = peer.status === "connected"
  return <div className={isSelected ? "peer-overview-row selected" : "peer-overview-row"} data-addr={peer.address} onClick={onSelect} style={{ alignItems: "center", background: isSelected ? "rgba(0,200,255,.06)" : "transparent", borderBottom: `1px solid ${BORD}`, cursor: "pointer", display: "grid", gap: 0, gridTemplateColumns: "36px 1fr 100px 60px 60px 60px", transition: "background .1s" }}>
    <div style={{ padding: "8px 6px 8px 10px" }}>
      <Identicon address={peer.address} size={22} />
    </div>
    <div style={{ minWidth: 0, padding: "8px 10px" }}>
      <div style={{ alignItems: "center", display: "flex", gap: 6, marginBottom: 2 }}>
        <StatusDotPulse status={peer.status} />
        <span style={{ color: TEXT, fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{peer.username}</span>
        <span style={{ fontSize: 11 }}>{toEmoji(peer.country)}</span>
      </div>
      <div style={{ color: MUTED, fontSize: 9, paddingLeft: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortAddr(peer.address)}</div>
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: "8px 6px" }}>
      {peer.plugins.slice(0, 2).map(pl => <span key={pl} style={{ background: "rgba(0,200,255,.08)", border: "1px solid rgba(0,200,255,.18)", borderRadius: 3, color: ACCENT, fontSize: 8, letterSpacing: ".03em", padding: "1px 5px" }}>{pl}</span>)}
      {peer.plugins.length > 2 && <span style={{ background: "rgba(0,200,255,.08)", border: "1px solid rgba(0,200,255,.18)", borderRadius: 3, color: MUTED, fontSize: 8, padding: "1px 5px" }}>+{peer.plugins.length - 2}</span>}
    </div>
    <div style={{ padding: "8px 6px" }}>{isConn ? <ActivityBar data={peer.activity} /> : <span style={{ color: DIM, fontSize: 9 }}>offline</span>}</div>
    <div style={{ padding: "8px 6px" }}><span style={{ color: isConn && peer.latency ? (peer.latency < 100 ? GREEN : peer.latency < 250 ? YELLOW : ORANGE) : MUTED, fontSize: 10, fontWeight: 600 }}>{isConn && peer.latency ? `${Math.round(peer.latency)}ms` : "—"}</span></div>
    <div style={{ padding: "8px 8px 8px 4px" }}>
      <div style={{ alignItems: "center", display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ color: confColor_, fontSize: 10, fontWeight: 600 }}>{peer.confidence.toFixed(2)}</span>
        <div style={{ background: "#111820", borderRadius: 2, height: 3, overflow: "hidden", width: CONF_BAR_W }}>
          <div style={{ background: confColor_, borderRadius: 2, height: "100%", transition: "width .5s ease", width: `${peer.confidence * 100}%` }} />
        </div>
      </div>
    </div>
  </div>
}

const PeerList = ({ peers, sel, setSel }: { peers: PeerWithCountry[]; sel: ApiPeer | null; setSel: (p: PeerWithCountry | null) => void }) => <div style={{ background: BG2, border: `1px solid ${BORD}`, borderRadius: 8, overflow: "hidden" }}>
  <div style={{ alignItems: "center", borderBottom: `1px solid ${BORD}`, color: MUTED, display: "grid", fontSize: 9, fontWeight: 700, gap: 0, gridTemplateColumns: "36px 1fr 100px 60px 60px 60px", letterSpacing: ".08em", padding: "6px 0", textTransform: "uppercase" }}>
    <div />
    <div style={{ padding: "0 10px" }}>Peer</div>
    <div style={{ padding: "0 6px" }}>Plugins</div>
    <div style={{ padding: "0 6px" }}>Activity</div>
    <div style={{ padding: "0 6px" }}>Latency</div>
    <div style={{ padding: "0 8px 0 4px" }}>Conf</div>
  </div>
  {peers.length === 0 && <div style={{ color: MUTED, fontSize: 11, padding: "20px 14px", textAlign: "center" }}>No peers yet…</div>}
  {peers.map(p => <PeerRow key={p.address} isSelected={sel?.address === p.address} onSelect={() => setSel(sel?.address === p.address ? null : p)} peer={p} />)}
</div>

export const OverviewTab = ({ bwHistory, peers, sel, setSel, votes }: Props) => {
  const connCount = peers.filter(p => p.status === "connected").length
  const avgConf = connCount ? peers.filter(p => p.status === "connected").reduce((a, p) => a + p.confidence, 0) / connCount : 0
  const avgLat = (() => {
    const measured = peers.filter(p => p.latency && p.status === "connected")
    return measured.length ? measured.reduce((a, p) => a + p.latency, 0) / measured.length : 0
  })()
  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(4, 1fr)" }}>
      <StatCard color={ACCENT} label="Connected Peers" sub={`of ${peers.length} known`} value={connCount} />
      <StatCard color={avgLat ? (avgLat < 100 ? GREEN : avgLat < 250 ? YELLOW : ORANGE) : MUTED} label="Avg Latency" sub={`${connCount} peers measured`} value={avgLat ? `${Math.round(avgLat)}ms` : "N/A"} />
      <StatCard color={confColor(avgConf)} label="Avg Confidence" sub="network-wide" value={connCount ? avgConf.toFixed(2) : "N/A"} />
      <StatCard color={PURPLE} label="Your Votes" sub={`${votes.tracks} tracks · ${votes.artists} artists · ${votes.albums} albums`} value={votes.tracks + votes.artists + votes.albums} />
    </div>
    <NetworkPulseCanvas bwHistory={bwHistory} />
    <PeerList peers={peers} sel={sel} setSel={setSel} />
  </div>
}
