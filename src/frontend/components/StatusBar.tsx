import type { PeerWithCountry, WsState } from "../../types/hydrabase"

import { ACCENT, BORD, MUTED, TEXT } from "../theme"
import { fmtBytes, fmtClock } from "../utils"
import { SocketStatus } from "./SocketStatus"

declare const VERSION: string

interface Props {
  dhtNodes: { country: string; host: string }[]
  peers: PeerWithCountry[]
  uptime: number
  wsState: WsState
}

const Sep = () => <span style={{ color: BORD, userSelect: "none" }}>│</span>

const Item = ({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) => <span style={{ alignItems: "center", display: "flex", gap: 5 }}>
  <span style={{ color: MUTED, fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase" }}>{label}</span>
  <span style={{ color: valueColor ?? TEXT, fontFamily: "monospace", fontSize: 11, fontWeight: 600 }}>{value}</span>
</span>

export const StatusBar = ({ dhtNodes, peers, uptime, wsState }: Props) => {
  const connCount = peers.filter(p => p.connection !== undefined).length
  const totalUL = peers.reduce((a, p) => a + (p.connection?.totalUL ?? 0), 0)
  const totalDL = peers.reduce((a, p) => a + (p.connection?.totalDL ?? 0), 0)
  return <div style={{ alignItems: "center", background: "#010409", borderTop: `1px solid ${BORD}`, bottom: 0, display: "flex", gap: 12, height: 28, left: 0, padding: "0 14px", position: "fixed", right: 0, zIndex: 48 }}>
    <SocketStatus state={wsState} />
    <Sep />
    <Item label="peers" value={String(connCount)} valueColor="#3fb950" />
    <Sep />
    <Item label="DHT" value={String(dhtNodes.length)} valueColor={ACCENT} />
    <Sep />
    <Item label="↑" value={fmtBytes(totalUL)} valueColor="#f0883e" />
    <Sep />
    <Item label="↓" value={fmtBytes(totalDL)} valueColor="#3fb950" />
    <Sep />
    <Item label="uptime" value={fmtClock(uptime)} />
    <span style={{ background: "#21262d", border: `1px solid ${BORD}`, borderRadius: 3, color: MUTED, fontSize: 9, letterSpacing: ".05em", marginLeft: "auto", padding: "1px 5px" }}>v{VERSION}</span>
  </div>
}
