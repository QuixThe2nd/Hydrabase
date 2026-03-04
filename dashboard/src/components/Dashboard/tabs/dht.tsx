import type { WsState } from "../../../types"

import { toEmoji } from "../../../geo"
import { ACCENT, BORD, MUTED, panel } from "../../../theme"
import { AreaChart } from "../../AreaChart"
import { PanelHeader } from "../../PanelHeader"
import { StatCard } from "../../StatCard"
import { StatusDot } from "../../StatusDot"

interface Props {
  dhtNodeCounts: number[]
  dhtNodes: { country: string; host: string; }[]
  socket: string
  tLabels: string[]
  wsState: WsState
}

const Header = ({ dhtNodeCounts, dhtNodes, tLabels }: { dhtNodeCounts: number[], dhtNodes: { country: string; host: string; }[], tLabels: string[] }) => {
  const countryMap = dhtNodes.reduce<Record<string, number>>((acc, {country}) => {
    acc[country] = (acc[country] ?? 0) + 1
    return acc
  }, {})
  return <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
    <div style={panel()}>
      <PanelHeader label="DHT Node Count" />
      <div style={{ padding: "10px 14px 8px" }}>
        <AreaChart height={160} labels={tLabels} series={[{ color: "#a5d6ff", data: dhtNodeCounts, label: "Nodes" }]} />
      </div>
    </div>
    <div style={panel()}>
      <PanelHeader label="Geographic Distribution" right="connections" />
      <div style={{ padding: "12px 14px" }}>
        {Object.entries(countryMap)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([country, count]) => <div key={country} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ color: MUTED, fontSize: 11 }}>{`${toEmoji(country)} ${country}`}</span>
              <span style={{ fontSize: 11, fontWeight: 600 }}>{Math.round((1000 * count) / dhtNodes.length) / 10}%</span>
            </div>
            <div style={{ background: "#21262d", borderRadius: 2, height: 4, overflow: "hidden" }}>
              <div style={{ background: ACCENT, borderRadius: 2, height: "100%", opacity: 0.65, width: `${(100 * count) / dhtNodes.length}%` }} />
            </div>
          </div>)}
      </div>
    </div>
  </div>
}

export const DhtTab = ({ dhtNodeCounts, dhtNodes, socket, tLabels, wsState }: Props) => <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
  <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
    <StatCard color={ACCENT} label="Total Nodes" sub="in routing table" value={dhtNodes.length} />
    <StatCard color={wsState === "open" ? "#3fb950" : "#f85149"}   label="WS Status" sub={socket.replace("wss://", "")} value={wsState.toUpperCase()} />
  </div>
  <Header dhtNodeCounts={dhtNodeCounts} dhtNodes={dhtNodes} tLabels={tLabels} />
  <div style={panel()}>
    <PanelHeader label="Routing Table" right={`${dhtNodes.length} nodes`} />
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ background: "#0d1117", color: MUTED, fontSize: 10, textTransform: "uppercase" }}>
            {["#", "Country", "IP Address", "Port", "Status"].map((h) => <th key={h} style={{ fontWeight: 700, letterSpacing: ".07em", padding: "7px 12px", textAlign: "left" }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {dhtNodes.map((node, i) => {
            const [ip, port] = node.host.split(":") as [string, string];
            return <tr className="rh" key={i} style={{ borderTop: `1px solid ${BORD}` }}>
              <td style={{ color: MUTED, fontSize: 10, padding: "7px 12px" }}>{i + 1}</td>
              <td style={{ fontFamily: "monospace", fontSize: 11, padding: "7px 12px" }}>{toEmoji(node.country)}</td>
              <td style={{ fontFamily: "monospace", fontSize: 11, padding: "7px 12px" }}>{ip}</td>
              <td style={{ color: MUTED, padding: "7px 12px" }}>{port}</td>
              <td style={{ padding: "7px 12px" }}>
                <StatusDot status="connected" />
                <span style={{ color: "#3fb950", fontSize: 10 }}>reachable</span>
              </td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
  </div>
</div>
