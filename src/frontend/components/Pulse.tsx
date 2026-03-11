import { useEffect, useRef } from "react"

import type { BwPoint } from "../App";

import { ACCENT, BG2, BORD, GREEN, MUTED, ORANGE, TEXT } from "../theme";

const Pulse = ({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement | null> }) => <div style={{ background: BG2, border: `1px solid ${BORD}`, borderRadius: 8, overflow: "hidden" }}>
  <div style={{ alignItems: "center", borderBottom: `1px solid ${BORD}`, display: "flex", gap: 8, padding: "9px 14px" }}>
    <div style={{ animation: "pulse-dot 1.4s ease infinite", background: GREEN, borderRadius: "50%", height: 6, width: 6 }} />
    <span style={{ color: TEXT, fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase" }}>Network Pulse</span>
    <span style={{ color: MUTED, fontSize: 10, marginLeft: "auto" }}>live · 60s window</span>
    <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
      <span style={{ alignItems: "center", color: ACCENT, display: "flex", fontSize: 10, gap: 4 }}>
        <span style={{ background: ACCENT, borderRadius: 2, display: "inline-block", height: 2, width: 12 }} />
        DL
      </span>
      <span style={{ alignItems: "center", color: ORANGE, display: "flex", fontSize: 10, gap: 4 }}>
        <span style={{ background: ORANGE, borderRadius: 2, display: "inline-block", height: 2, width: 12 }} />
        UL
      </span>
    </div>
  </div>
  <div style={{ height: 120, position: "relative" }}>
    <canvas ref={canvasRef} style={{ display: "block", height: "100%", width: "100%" }} />
  </div>
</div>


const drawSeries = (data: number[], color: string, glowColor: string, maxVal: number, W: number, H: number, ctx: CanvasRenderingContext2D) => {
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * W,
    y: H - (v / maxVal) * (H * 0.82),
  }))

  // Fill
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, `${color}33`)
  grad.addColorStop(1, `${color}04`)
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.moveTo(0, H)
  pts.forEach(p => ctx.lineTo(p.x, p.y))
  ctx.lineTo(W, H)
  ctx.closePath()
  ctx.fill()

  // Line
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.lineJoin = "round"
  ctx.shadowBlur = 7
  ctx.shadowColor = glowColor
  ctx.beginPath()
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
  ctx.stroke()
  ctx.shadowBlur = 0

  // Live dot at end
  const last = pts[pts.length - 1]
  if (last) {
    ctx.beginPath()
    ctx.arc(last.x, last.y, 3, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  }
}

const populateCanvas = (ctx: CanvasRenderingContext2D, W: number, H: number, bwHistory: BwPoint[]) => {
  ctx.clearRect(0, 0, W, H)

  // Subtle grid
  ctx.strokeStyle = "rgba(26,37,53,.55)"
  ctx.lineWidth   = 1
  for (let x = 0; x < W; x += W / 12) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
  }
  for (let y = 0; y < H; y += H / 4) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
  }

  if (bwHistory.length < 2) return

  const ulData = bwHistory.map(p => p.ul)
  const dlData = bwHistory.map(p => p.dl)
  const maxVal = Math.max(...ulData, ...dlData, 1)

  drawSeries(dlData, ORANGE,  "rgba(255,140,66,.6)", maxVal, W, H, ctx)
  drawSeries(ulData, ACCENT,  "rgba(0,200,255,.6)", maxVal, W, H, ctx)
}

export const NetworkPulseCanvas = ({ bwHistory }: { bwHistory: BwPoint[] }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const W = canvas.offsetWidth
    const H = canvas.offsetHeight
    if (!W || !H) return
    canvas.width  = W
    canvas.height = H

    populateCanvas(ctx, W, H, bwHistory)
  }, [bwHistory]);

  return <Pulse canvasRef={canvasRef} />
}
