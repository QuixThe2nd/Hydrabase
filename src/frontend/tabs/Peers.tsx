import type { ApiPeer, FilterState, PeerWithCountry } from "../../types/hydrabase";

import { Identicon } from "../components/Identicon";
import { StatusDot } from "../components/StatusDot";
import { ACCENT, BORD, confColor, latColor, MUTED, panel } from "../theme";
import { fmtBytes, fmtUptime, toEmoji } from "../utils";

interface Props {
  filter: FilterState;
  sel: ApiPeer | null;
  setFilter: (f: FilterState) => void;
  setSel: (p: null | PeerWithCountry) => void;
  sorted: PeerWithCountry[];
}

export const PeersTab = ({ filter, sel, setFilter, setSel, sorted }: Props) => <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
  <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
    <span style={{ color: MUTED, fontSize: 11 }}>Filter:</span>
    {(["all", "connected", "disconnected"] as const).map((s) => <button className={`fbtn${filter === s ? " on" : ""}`} key={s} onClick={() => setFilter(s)}>{s}</button>)}
    <span style={{ color: MUTED, fontSize: 11, marginLeft: "auto" }}>{sorted.length} peers</span>
  </div>

  {sorted.map(p => <div key={p.address} onClick={() => setSel(sel?.address === p.address ? null : p)} style={{ ...panel(), borderColor: sel?.address === p.address ? "#58a6ff55" : BORD, cursor: "pointer", transition: "border-color .15s" }}>
    <div style={{ padding: "12px 16px" }}>
      <div style={{ alignItems: "flex-start", display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ alignItems: "center", display: "flex", gap: 8, marginBottom: 3 }}>
            <Identicon address={p.address} size={24} />
            <StatusDot status={p.connection !== undefined} />
            <span style={{ fontSize: 12, fontWeight: 700 }}>{p.address}</span>
            <span style={{ fontSize: 12 }}>{toEmoji(p.country)}</span>
          </div>
          <div style={{ color: MUTED, fontSize: 11, marginLeft: 12 }}>ws://{p.connection?.hostname}</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {p.connection?.plugins.map((pl) => <span key={pl} style={{ background: "#21262d", border: `1px solid ${BORD}`, borderRadius: 4, color: ACCENT, fontSize: 10, padding: "2px 8px" }}>{pl}</span>)}
          {p.connection?.plugins.length === 0 && <span style={{ color: MUTED, fontSize: 10 }}>no plugins</span>}
        </div>
      </div>

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))", marginBottom: 10 }}>
        {([
          ["Latency", p.connection?.latency ? `${Math.round(p.connection?.latency * 10) / 10}ms` : "—", p.connection?.latency ? latColor(p.connection?.latency) : MUTED],
          ["↑ UL",   fmtBytes(p.connection?.totalUL ?? 0), "#f0883e"],
          ["↓ DL",   fmtBytes(p.connection?.totalDL ?? 0), ACCENT],
          ["Uptime",  fmtUptime(p.connection?.uptime ?? 0), (p.connection?.uptime ?? 0) / 1_000 > 90 ? "#3fb950" : (p.connection?.uptime ?? 0) / 1_000 > 60 ? "#d29922" : "#f85149"],
        ] as [string, string, string][]).map(([l, v, c]) => <div key={l} style={{ background: "#0d1117", borderRadius: 6, padding: "8px 10px" }}>
          <div style={{ color: MUTED, fontSize: 9, letterSpacing: ".1em", marginBottom: 4, textTransform: "uppercase" }}>{l}</div>
          <div style={{ color: c, fontSize: 15, fontWeight: 700 }}>{v}</div>
        </div>)}
      </div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ color: MUTED, fontSize: 9, letterSpacing: ".1em", textTransform: "uppercase" }}>Historic Confidence</span>
          <span style={{ color: confColor(p.connection?.confidence ?? 0), fontSize: 10, fontWeight: 700 }}>{((p.connection?.confidence ?? 0) * 100).toFixed(1)}%</span>
        </div>
        <div style={{ background: "#21262d", borderRadius: 2, height: 4, overflow: "hidden" }}>
          <div style={{ background: confColor(p.connection?.confidence ?? 0), borderRadius: 2, height: "100%", transition: "width .3s", width: `${(p.connection?.confidence ?? 0) * 100}%` }} />
        </div>
      </div>
    </div>
  </div>)}
</div>
