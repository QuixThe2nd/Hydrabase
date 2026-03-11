import type { CSSProperties } from "react"

export const BG = "#060a0f"
export const BG2 = "#0b1018"
export const BG3 = "#111820"
export const SURF = "#0b1018"
export const BORD = "#1a2535"
export const BORD2 = "#243040"
export const TEXT = "#c8d8e8"
export const MUTED = "#4a6070"
export const DIM = "#2a3a4a"
export const ACCENT = "#00c8ff"
export const ACCENT2 = "#0088cc"
export const GREEN = "#00e87a"
export const ORANGE = "#ff8c42"
export const PURPLE = "#a78bff"
export const RED = "#ff4a5e"
export const YELLOW = "#ffd166"

export const STATUS_COLORS = {
  connected: GREEN,
  disconnected: RED,
} as const

export const panel = (overrides: CSSProperties = {}): CSSProperties => ({
  background: SURF,
  border: `1px solid ${BORD}`,
  borderRadius: 8,
  overflow: "hidden",
  ...overrides,
})

export const latColor  = (ms: number): string => ms < 100 ? GREEN : ms < 250 ? YELLOW : ms < 500 ? ORANGE : RED
export const confColor = (c: number):  string => c > 0.8 ? GREEN : c > 0.5 ? YELLOW : RED

export const GLOBAL_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #1a2535; border-radius: 2px; }
  .tab { background: none; border: none; cursor: pointer; font-family: inherit; font-size: 11.5px; padding: 9px 14px; border-bottom: 2px solid transparent; color: #4a6070; transition: all .15s; letter-spacing: .03em; }
  .tab:hover { color: #c8d8e8; }
  .tab.on { color: #c8d8e8; border-bottom-color: #00c8ff; }
  .rh:hover { background: rgba(0,200,255,.04) !important; }
  .fbtn { background: none; border: 1px solid #1a2535; border-radius: 4px; color: #4a6070; font-family: inherit; font-size: 10px; padding: 3px 9px; cursor: pointer; transition: all .15s; }
  .fbtn:hover, .fbtn.on { background: rgba(0,200,255,.1); border-color: rgba(0,200,255,.3); color: #00c8ff; }
  @keyframes blink { 0%,100% { opacity: 1 } 50% { opacity: .3 } }
  @keyframes fadein { from { opacity: 0; transform: translateY(3px) } to { opacity: 1; transform: none } }
  @keyframes spin { to { transform: rotate(360deg) } }
  @keyframes pulse-dot { 0%,100% { opacity: 1; transform: scale(1) } 50% { opacity: .35; transform: scale(.65) } }
  @keyframes row-flash { 0% { background: rgba(0,200,255,.15) } 100% { background: transparent } }
  .peer-row-flash { animation: row-flash .7s ease forwards; }
`
