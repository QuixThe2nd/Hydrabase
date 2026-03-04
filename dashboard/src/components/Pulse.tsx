import { useEffect, useRef } from "react"
import { ORANGE, ACCENT, BG2, BORD, GREEN, TEXT, MUTED } from "../theme";
import type { BwPoint } from "./Dashboard";

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

    ctx.clearRect(0, 0, W, H);

    // subtle grid
    ctx.strokeStyle = "rgba(26,37,53,.55)";
    ctx.lineWidth   = 1;
    for (let x = 0; x < W; x += W / 12) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += H / 4) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    if (bwHistory.length < 2) return;

    const rxData = bwHistory.map(p => p.rx);
    const txData = bwHistory.map(p => p.tx);
    const maxVal = Math.max(...rxData, ...txData, 1);

    const drawSeries = (data: number[], color: string, glowColor: string) => {
      const pts = data.map((v, i) => ({
        x: (i / (data.length - 1)) * W,
        y: H - (v / maxVal) * (H * 0.82),
      }));

      // fill
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, `${color}33`);
      grad.addColorStop(1, `${color}04`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, H);
      pts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();

      // line
      ctx.strokeStyle  = color;
      ctx.lineWidth    = 1.5;
      ctx.lineJoin     = "round";
      ctx.shadowBlur   = 7;
      ctx.shadowColor  = glowColor;
      ctx.beginPath();
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();
      ctx.shadowBlur = 0;

      // live dot at end
      const last = pts[pts.length - 1];
      if (last) {
        ctx.beginPath();
        ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    };

    drawSeries(txData, ORANGE,  "rgba(255,140,66,.6)");
    drawSeries(rxData, ACCENT,  "rgba(0,200,255,.6)");
  }, [bwHistory]);

  return (
    <div style={{ background: BG2, border: `1px solid ${BORD}`, borderRadius: 8, overflow: "hidden" }}>
      {/* header */}
      <div style={{ alignItems: "center", borderBottom: `1px solid ${BORD}`, display: "flex", gap: 8, padding: "9px 14px" }}>
        <div style={{
          animation: "pulse-dot 1.4s ease infinite",
          background: GREEN,
          borderRadius: "50%",
          height: 6,
          width: 6,
        }} />
        <span style={{ color: TEXT, fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase" }}>
          Network Pulse
        </span>
        <span style={{ color: MUTED, fontSize: 10, marginLeft: "auto" }}>live · 60s window</span>
        <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
          <span style={{ alignItems: "center", color: ACCENT, display: "flex", fontSize: 10, gap: 4 }}>
            <span style={{ background: ACCENT, borderRadius: 2, display: "inline-block", height: 2, width: 12 }} />
            RX
          </span>
          <span style={{ alignItems: "center", color: ORANGE, display: "flex", fontSize: 10, gap: 4 }}>
            <span style={{ background: ORANGE, borderRadius: 2, display: "inline-block", height: 2, width: 12 }} />
            TX
          </span>
        </div>
      </div>
      {/* canvas */}
      <div style={{ height: 120, position: "relative" }}>
        <canvas ref={canvasRef} style={{ display: "block", height: "100%", width: "100%" }} />
      </div>
    </div>
  );
};