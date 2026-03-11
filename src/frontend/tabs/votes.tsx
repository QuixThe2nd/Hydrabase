import type { Connection, NodeStats, PeerWithCountry, Votes } from "../../types/hydrabase";

import { PanelHeader } from "../components/PanelHeader";
import { ACCENT, BORD, MUTED, panel } from "../theme";

interface Props {
  peers: PeerWithCountry[]
  stats: NodeStats | null
}

const Header = ({ peerVotes, selfVotes }: { peerVotes: Votes, selfVotes: Votes }) => {
  const rows = [
    ["Tracks", selfVotes.tracks, selfVotes.tracks+peerVotes.tracks, "#bc8cff"],
    ["Albums", selfVotes.albums, selfVotes.albums+peerVotes.albums, "#56d364"],
    ["Artists", selfVotes.artists, selfVotes.artists+peerVotes.artists, "#ff9bce"],
  ] as const;

  return <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
    {rows.map(([l, local, total, color]) => <div key={l} style={panel()}>
      <div style={{ padding: "12px 14px" }}>
        <div style={{ color: MUTED, fontSize: 9, letterSpacing: ".12em", marginBottom: 6, textTransform: "uppercase" }}>{l}</div>
        <div style={{ alignItems: "flex-end", display: "flex", gap: 4, marginBottom: 10 }}>
          <span style={{ color, fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{local}</span>
          <span style={{ color: MUTED, fontSize: 13, marginBottom: 2 }}>/ {total}</span>
          <span style={{ color: MUTED, fontSize: 11, marginBottom: 2, marginLeft: "auto" }}>{total > 0 ? ((local / total) * 100).toFixed(0) : 0}%</span>
        </div>
        <div style={{ background: "#21262d", borderRadius: 3, height: 5, overflow: "hidden" }}>
          <div style={{ background: color, borderRadius: 3, height: "100%", width: `${total > 0 ? (local / total) * 100 : 0}%` }} />
        </div>
        <div style={{ color: MUTED, display: "flex", fontSize: 9, justifyContent: "space-between", marginTop: 4 }}>
          <span>your votes</span><span>peer votes</span>
        </div>
      </div>
    </div>)}
  </div>
}

export const VotesTab = ({ peers, stats }: Props) => {
  const onlinePeerCount = peers.filter(peer => peer.connection?.uptime !== 0).length
  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    <Header peerVotes={(peers.map(({connection}) => connection).filter(Boolean) as Connection[]).map(conn => conn.votes).reduce((acc, votes) => ({ albums: acc.albums + votes.albums, artists: acc.artists + votes.artists, tracks: acc.tracks + votes.tracks }), { albums: 0, artists: 0, tracks: 0 })} selfVotes={stats?.self.votes ?? { albums: 0, artists: 0, tracks: 0 }} />
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
      <div style={panel()}>
        <PanelHeader label="Plugins" />
        <div style={{ padding: "10px 0" }}>
          {stats?.peers.plugins.map(pl => {
            const on = stats.self.plugins.includes(pl);
            return <div key={pl} style={{ alignItems: "center", borderBottom: `1px solid ${BORD}`, display: "flex", justifyContent: "space-between", padding: "10px 16px" }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>{pl}</div>
                <div style={{ color: MUTED, fontSize: 10 }}>{on ? "Installed" : "Not installed"}</div>
              </div>
              <span style={{ background: on ? "rgba(63,185,80,.1)" : "rgba(248,81,73,.1)", border: `1px solid ${on ? "#3fb95044" : "#f8514944"}`, borderRadius: 4, color: on ? "#3fb950" : "#f85149", fontSize: 10, padding: "3px 10px" }}>{on ? "ACTIVE" : "INACTIVE"}</span>
            </div>
          })}
        </div>
      </div>
      <div style={panel()}>
        <PanelHeader label="Plugin Coverage" />
        <div style={{ padding: "12px 16px" }}>
          {stats?.peers.plugins.map(pl => {
            const n = peers.filter(p => p.connection?.plugins.includes(pl)).length;
            return <div key={pl} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 12 }}>{pl}</span>
                <span style={{ color: MUTED, fontSize: 11 }}>{n}/{onlinePeerCount} peers</span>
              </div>
              <div style={{ background: "#21262d", borderRadius: 3, height: 5, overflow: "hidden" }}>
                <div style={{ background: ACCENT, borderRadius: 3, height: "100%", width: `${onlinePeerCount > 0 ? (n / onlinePeerCount) * 100 : 0}%` }} />
              </div>
            </div>
          })}
        </div>
      </div>
    </div>
  </div>
}
