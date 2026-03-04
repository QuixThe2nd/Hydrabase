import type { JSX } from "react";

import type { ApiPeer } from "../../../../../src/StatsReporter";
import type { PeerWithCountry, VoteCounts } from "../../../types";

import { toEmoji } from "../../../geo";
import { ACCENT, BORD, confColor, latColor, MUTED, panel } from "../../../theme";
import { fmtBytes, shortAddr } from "../../../utils";
import { PanelHeader } from "../../PanelHeader";
import { StatCard } from "../../StatCard";
import { StatusDot } from "../../StatusDot";

type Props = TableProps & {
  dhtNodes: { country: string; host: string; }[]
  votes: VoteCounts
}

interface TableProps {
  peers: PeerWithCountry[]
  sel: ApiPeer | null
  setSel: (p: PeerWithCountry | null) => void
  SI: ({ k }: { k: keyof ApiPeer }) => JSX.Element
  toggleSort: (k: keyof ApiPeer) => void
}

const PEER_HEADER: [keyof ApiPeer, string][] = [
  ["status",     "Status"],
  ["username",    "Username"],
  ["address",    "Address"],
  ["hostname",   "Host"],
  ["latency",    "Latency"],
  ["rxTotal",    "↓ RX"],
  ["txTotal",    "↑ TX"],
  ["confidence", "Conf"],
]

const Table = ({ peers, sel, setSel, SI, toggleSort }: TableProps) => <table style={{ borderCollapse: "collapse", width: "100%" }}>
  <thead>
    <tr style={{ background: "#0d1117", color: MUTED, fontSize: 10, textTransform: "uppercase" }}>
      {PEER_HEADER.map(([k, l]) => <th key={String(k)} onClick={() => toggleSort(k)} style={{ cursor: "pointer", fontWeight: 700, letterSpacing: ".07em", padding: "7px 12px", textAlign: "left", whiteSpace: "nowrap" }}>{l} <SI k={k} /></th>)}
    </tr>
  </thead>
  <tbody>
    {peers.map((p) => <tr className="rh" key={p.address} onClick={() => setSel(sel?.address === p.address ? null : p)}
      style={{ background: sel?.address === p.address ? "rgba(88,166,255,.05)" : "transparent", borderTop: `1px solid ${BORD}`, cursor: "pointer" }}>
      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
        <StatusDot status={p.status} />
        <span style={{ color: p.status === "connected" ? "#3fb950" : "#f85149", fontSize: 10 }}>{p.status}</span>
      </td>
      <td style={{ color: MUTED, fontSize: 10, padding: "8px 12px" }}>{p.username}</td>
      <td style={{ color: MUTED, fontSize: 10, padding: "8px 12px" }}>{shortAddr(p.address)}</td>
      <td style={{ color: MUTED, fontSize: 11, padding: "8px 12px" }}>{toEmoji(p.country)} {p.hostname}</td>
      <td style={{ color: p.latency ? latColor(p.latency) : MUTED, padding: "8px 12px" }}>{p.latency ? `${Math.round(p.latency * 10) / 10}ms` : "—"}</td>
      <td style={{ color: ACCENT, padding: "8px 12px" }}>{fmtBytes(p.rxTotal)}</td>
      <td style={{ color: "#f0883e", padding: "8px 12px" }}>{fmtBytes(p.txTotal)}</td>
      <td style={{ padding: "8px 12px" }}>
        <div style={{ alignItems: "center", display: "flex", gap: 6 }}>
          <div style={{ background: "#21262d", borderRadius: 2, height: 3, overflow: "hidden", width: 40 }}>
            <div style={{ background: confColor(p.confidence), borderRadius: 2, height: "100%", width: `${p.confidence * 100}%` }} />
          </div>
          <span style={{ color: MUTED, fontSize: 10 }}>{(p.confidence * 100).toFixed(0)}%</span>
        </div>
      </td>
    </tr>)}
  </tbody>
</table>

export const OverviewTab = ({ dhtNodes, peers, sel, setSel, SI, toggleSort, votes }: Props) => {
  const connCount = peers.filter((p) => p.status === "connected").length
  const avgLat = peers.length ? peers.reduce((a, p) => a + p.latency, 0) / (peers.filter((p) => p.latency).length || 1) : 0
  const totalRx = peers.reduce((a, p) => a + p.rxTotal, 0)
  const totalTx = peers.reduce((a, p) => a + p.txTotal, 0)

  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
      <StatCard color="#3fb950" label="Connected Peers" sub={`${peers.length} known`} value={connCount} />
      <StatCard color={ACCENT} label="↓ RX" sub={`total ${fmtBytes(totalRx)}`} value={fmtBytes(totalRx)} />
      <StatCard color="#f0883e" label="↑ TX" sub={`total ${fmtBytes(totalTx)}`} value={fmtBytes(totalTx)} />
      <StatCard color={latColor(avgLat)} label="Avg Latency" sub={`${connCount} peers measured`} value={avgLat ? `${Math.round(avgLat)}ms` : "N/A"} />
      <StatCard color="#a5d6ff" label="DHT Nodes" sub="routing table entries" value={dhtNodes.length} />
      <StatCard color="#bc8cff" label="Your Votes" sub={`${votes.tracks} tracks / ${votes.artists} artists / ${votes.albums} albums`} value={votes.tracks + votes.artists + votes.albums} />
    </div>
    <div style={panel()}>
      <PanelHeader label="Peers" right={`${connCount}/${peers.length}`} />
      <div style={{ overflowX: "auto" }}>
        <Table peers={peers} sel={sel} setSel={setSel} SI={SI} toggleSort={toggleSort} />
      </div>
    </div>
  </div>
}