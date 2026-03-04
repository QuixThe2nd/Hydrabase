import { BORD, MUTED, ACCENT, TEXT } from "../theme"
import type { PeerWithCountry } from "../types"
import { fmtBytes, fmtClock, shortAddr } from "../utils"

export type Tab = "dht" | "overview" | "peers" | "search" | "votes"

const NAV_ITEMS: { tab: Tab; label: string; icon: string }[] = [
  { tab: "overview", label: "Overview", icon: "◈" },
  { tab: "search", label: "Search", icon: "⌕" },
  { tab: "peers", label: "Peers", icon: "⬡" },
  { tab: "dht", label: "DHT", icon: "◎" },
  { tab: "votes", label: "Votes", icon: "✦" },
]

export const Sidebar = ({ peers, selfAddr, setTab, tab, uptime }: { peers: PeerWithCountry[]; selfAddr: `0x${string}`; setTab: React.Dispatch<React.SetStateAction<Tab>>; tab: Tab; uptime: number }) => {
  const totalRx = peers.reduce((a, p) => a + p.rxTotal, 0)
  const totalTx = peers.reduce((a, p) => a + p.txTotal, 0)
  const connCount = peers.filter(p => p.status === "connected").length
  return <div style={{ background: "#010409", borderRight: `1px solid ${BORD}`, display: "flex", flexDirection: "column", flexShrink: 0, height: "calc(100vh - 48px)", position: "sticky", top: 0, width: 196 }}>
    <div style={{ borderBottom: `1px solid ${BORD}`, padding: "16px 16px 14px" }}>
      {/* // TODO: Logo */}
      <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".06em", marginBottom: 4 }}>HYDRABASE</span>
    </div>
    <nav style={{ flex: 1, padding: "8px 6px" }}>
      {NAV_ITEMS.map(({ tab: t, label, icon }) => <button key={t} onClick={() => setTab(t)} style={{ alignItems: "center", background: tab === t ? "rgba(88,166,255,.1)" : "none", border: "none", borderLeft: `2px solid ${tab === t ? ACCENT : "transparent"}`, borderRadius: "0 6px 6px 0", color: tab === t ? TEXT : MUTED, cursor: "pointer", display: "flex", fontFamily: "inherit", fontSize: 13, fontWeight: tab === t ? 600 : 400, gap: 9, marginBottom: 2, padding: "7px 12px", transition: "all .15s", width: "100%" }}>
        <span style={{ fontSize: 12, opacity: .8, width: 14 }}>{icon}</span>
        {label}
        {t === "peers" && connCount > 0 && <span style={{ background: ACCENT, borderRadius: 99, color: "#000", fontSize: 9, fontWeight: 700, marginLeft: "auto", padding: "1px 5px" }}>{connCount}</span>}
      </button>)}
    </nav>
    <div style={{ borderTop: `1px solid ${BORD}`, padding: "12px 16px" }}>
      {([
        ["↓ RX", fmtBytes(totalRx), ACCENT],
        ["↑ TX", fmtBytes(totalTx), "#f0883e"],
        ["uptime", fmtClock(uptime), MUTED],
      ] as [string, string, string][]).map(([l, v, c]) => (
        <div key={l} style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
          <span style={{ color: MUTED, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase" }}>{l}</span>
          <span style={{ color: c, fontFamily: "monospace", fontSize: 10, fontWeight: 600 }}>{v}</span>
        </div>
      ))}
      <div style={{ borderTop: `1px solid ${BORD}`, color: MUTED, fontFamily: "monospace", fontSize: 9, marginTop: 8, paddingTop: 8, wordBreak: "break-all" }}>{shortAddr(selfAddr)}</div>
    </div>
  </div>
}
