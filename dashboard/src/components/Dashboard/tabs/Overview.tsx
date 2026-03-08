import type { ApiPeer, NodeStats } from "../../../../../src/StatsReporter"
import type { PeerWithCountry } from "../../../types"

import { toEmoji } from "../../../geo"
import { ACCENT, ACCENT2, BG2, BORD, confColor, DIM, GREEN, MUTED, ORANGE, PURPLE, TEXT, YELLOW } from "../../../theme"
import { shortAddr } from "../../../utils"
import { Identicon } from "../../Identicon"
import { NetworkPulseCanvas } from "../../Pulse"
import { StatCard } from "../../StatCard"

interface BwPoint { dl: number; ul: number }

interface Props {
  bwHistory: BwPoint[]
  peers: PeerWithCountry[]
  sel: ApiPeer | null
  setSel: (p: null | PeerWithCountry) => void
  stats: NodeStats | null
}

const ActivityBar = ({ data }: { data: number[] }) => <div style={{ alignItems: "flex-end", display: "flex", gap: 1.5, height: 14 }}>
  {data.map((v, i) => <div key={i} style={{ background: ACCENT2, borderRadius: 1, height: Math.max(2, (v / 100) * 14), opacity: 0.3 + (v / 140), transition: "height .3s ease", width: 3 }} />)}
</div>
const StatusDotPulse = ({ status }: { status: boolean }) => <div style={{ animation: status ? "pulse-dot 1.4s ease infinite" : undefined, background: status ? GREEN : "#ff4a5e66", borderRadius: "50%", flexShrink: 0, height: 7, width: 7 }} />

const CONF_BAR_W = 38

const PeerRow = ({ isSelected, onSelect, peer }: { isSelected: boolean; onSelect: () => void; peer: PeerWithCountry }) => {
  const confColor_ = confColor(peer.connection?.confidence ?? 0)
  return <div className={isSelected ? "peer-overview-row selected" : "peer-overview-row"} data-addr={peer.address} onClick={onSelect} style={{ alignItems: "center", background: isSelected ? "rgba(0,200,255,.06)" : "transparent", borderBottom: `1px solid ${BORD}`, cursor: "pointer", display: "grid", gap: 0, gridTemplateColumns: "36px 1fr 100px 60px 60px 60px", transition: "background .1s" }}>
    <div style={{ padding: "8px 6px 8px 10px" }}>
      <Identicon address={peer.address} size={22} />
    </div>
    <div style={{ minWidth: 0, padding: "8px 10px" }}>
      <div style={{ alignItems: "center", display: "flex", gap: 6, marginBottom: 2 }}>
        <StatusDotPulse status={peer.connection !== undefined} />
        <span style={{ color: TEXT, fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{peer.connection?.username}</span>
        <span style={{ fontSize: 11 }}>{toEmoji(peer.country)}</span>
      </div>
      <div style={{ color: MUTED, fontSize: 9, overflow: "hidden", paddingLeft: 13, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortAddr(peer.address)}</div>
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: "8px 6px" }}>
      {peer.connection?.plugins.slice(0, 2).map(pl => <span key={pl} style={{ background: "rgba(0,200,255,.08)", border: "1px solid rgba(0,200,255,.18)", borderRadius: 3, color: ACCENT, fontSize: 8, letterSpacing: ".03em", padding: "1px 5px" }}>{pl}</span>)}
      {(peer.connection?.plugins.length ?? 0) > 2 && <span style={{ background: "rgba(0,200,255,.08)", border: "1px solid rgba(0,200,255,.18)", borderRadius: 3, color: MUTED, fontSize: 8, padding: "1px 5px" }}>+{(peer.connection?.plugins.length ?? 0) - 2}</span>}
    </div>
    <div style={{ padding: "8px 6px" }}>{peer.connection === undefined ? <span style={{ color: DIM, fontSize: 9 }}>offline</span> : <ActivityBar data={peer.activity} />}</div>
    <div style={{ padding: "8px 6px" }}><span style={{ color: peer.connection !== undefined && peer.connection?.latency ? (peer.connection?.latency < 100 ? GREEN : peer.connection?.latency < 250 ? YELLOW : ORANGE) : MUTED, fontSize: 10, fontWeight: 600 }}>{peer.connection !== undefined && peer.connection?.latency ? `${Math.round(peer.connection?.latency)}ms` : "—"}</span></div>
    <div style={{ padding: "8px 6px" }}><span style={{ color: peer.connection !== undefined && peer.connection?.lookupTime ? (peer.connection?.lookupTime < 100 ? GREEN : peer.connection?.lookupTime < 250 ? YELLOW : ORANGE) : MUTED, fontSize: 10, fontWeight: 600 }}>{peer.connection !== undefined && peer.connection?.lookupTime ? `${Math.round(peer.connection?.lookupTime)}ms` : "—"}</span></div>
    <div style={{ padding: "8px 8px 8px 4px" }}>
      <div style={{ alignItems: "center", display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ color: confColor_, fontSize: 10, fontWeight: 600 }}>{peer.connection?.confidence.toFixed(2)}</span>
        <div style={{ background: "#111820", borderRadius: 2, height: 3, overflow: "hidden", width: CONF_BAR_W }}>
          <div style={{ background: confColor_, borderRadius: 2, height: "100%", transition: "width .5s ease", width: `${(peer.connection?.confidence ?? 0) * 100}%` }} />
        </div>
      </div>
    </div>
  </div>
}

const PeerList = ({ peers, sel, setSel }: { peers: PeerWithCountry[]; sel: ApiPeer | null; setSel: (p: null | PeerWithCountry) => void }) => <div style={{ background: BG2, border: `1px solid ${BORD}`, borderRadius: 8, overflow: "hidden" }}>
  <div style={{ alignItems: "center", borderBottom: `1px solid ${BORD}`, color: MUTED, display: "grid", fontSize: 9, fontWeight: 700, gap: 0, gridTemplateColumns: "36px 1fr 100px 60px 60px 60px", letterSpacing: ".08em", padding: "6px 0", textTransform: "uppercase" }}>
    <div />
    <div style={{ padding: "0 10px" }}>Peer</div>
    <div style={{ padding: "0 6px" }}>Plugins</div>
    <div style={{ padding: "0 6px" }}>Activity</div>
    <div style={{ padding: "0 6px" }}>Latency</div>
    <div style={{ padding: "0 6px" }}>Lookup Time</div>
    <div style={{ padding: "0 8px 0 4px" }}>Conf</div>
  </div>
  {peers.length === 0 && <div style={{ color: MUTED, fontSize: 11, padding: "20px 14px", textAlign: "center" }}>No peers yet…</div>}
  {peers.map(p => <PeerRow isSelected={sel?.address === p.address} key={p.address} onSelect={() => setSel(sel?.address === p.address ? null : p)} peer={p} />)}
</div>

export const OverviewTab = ({ bwHistory, peers, sel, setSel, stats }: Props) => {
  const connCount = peers.filter(p => p.connection !== undefined).length
  const avgConf = connCount ? peers.filter(p => p.connection !== undefined).reduce((a, p) => a + (p.connection?.confidence ?? 0), 0) / connCount : 0
  const avgLat = (() => {
    const measured = peers.filter(p => p.connection?.latency && p.connection !== undefined)
    return measured.length ? measured.reduce((a, p) => a + (p.connection?.latency ?? 0), 0) / measured.length : 0
  })()
  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(4, 1fr)" }}>
      <StatCard color={ACCENT} label="Connected Peers" sub={`of ${peers.length} known`} value={connCount} />
      <StatCard color={avgLat ? (avgLat < 100 ? GREEN : avgLat < 250 ? YELLOW : ORANGE) : MUTED} label="Avg Latency" sub={`${connCount} peers measured`} value={avgLat ? `${Math.round(avgLat)}ms` : "N/A"} />
      <StatCard color={confColor(avgConf)} label="Avg Confidence" sub="network-wide" value={connCount ? avgConf.toFixed(2) : "N/A"} />
      <StatCard color={PURPLE} label="Your Votes" sub={`${stats?.self.votes.tracks} tracks · ${stats?.self.votes.artists} artists · ${stats?.self.votes.albums} albums`} value={(stats?.self.votes.tracks ?? 0) + (stats?.self.votes.artists ?? 0) + (stats?.self.votes.albums ?? 0)} />
    </div>
    <NetworkPulseCanvas bwHistory={bwHistory} />
    <PeerList peers={peers} sel={sel} setSel={setSel} />
  </div>
}
