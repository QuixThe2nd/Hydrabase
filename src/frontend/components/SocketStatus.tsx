import type { WsState } from "../../types/hydrabase";

const STATE_MAP: Record<string, [string, string]> = {
  closed: ["#f85149", "DISCONNECTED"],
  connecting: ["#d29922", "CONNECTING"],
  error: ["#f85149", "ERROR"],
  open: ["#3fb950", "LIVE"],
};

export const SocketStatus = ({ state }: { state: WsState }) => {
  const [color, label] = STATE_MAP[state] ?? ["#888", "UNKNOWN"];
  return <span style={{ alignItems: "center", display: "flex", fontSize: 10, gap: 5 }}>
    <span style={{ animation: state === "connecting" ? "blink 1s infinite" : "none", background: color, borderRadius: "50%", boxShadow: `0 0 6px ${color}`, display: "inline-block", height: 6, width: 6 }} />
    <span style={{ color }}>{label}</span>
  </span>
}
