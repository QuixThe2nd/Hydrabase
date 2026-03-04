import { useRef, useState } from "react";

interface Series {
  color: string
  data: number[]
  label: string
}

const PAD = { b: 22, l: 36, r: 8, t: 8 }

const Line = ({ series }: { series: Series[] }) => <defs>
  {series.map(s => {
    const id = `ag${s.color.replace('#', '')}`;
    return <linearGradient id={id} key={id} x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%"   stopColor={s.color} stopOpacity="0.28" />
      <stop offset="100%" stopColor={s.color} stopOpacity="0.02" />
    </linearGradient>
  })}
</defs>

const Axis = ({ H, iH, labels, px, py, series }: { H: number; iH: number; labels: string[] | undefined; px: (num: number) => number, py: (num: number) => number, series: Series[], }) => {
  const pathD  = (d: number[]) => d.map((v, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(v)}`).join(" ");
  return <>
    {labels && labels.filter((_, i) => i % 12 === 0).map((l, ii) => <text fill="rgba(255,255,255,0.22)" fontFamily="monospace" fontSize="8.5" key={ii} textAnchor="middle" x={px(ii * 12)} y={H - 4}>{l}</text>)}
    {series.map((s) => <path d={`${pathD(s.data)} L${px(s.data.length - 1)},${PAD.t + iH} L${PAD.l},${PAD.t + iH} Z`} fill={`url(#ag${s.color.replace("#", "")})`} key={`${s.label  }a`} />)}
    {series.map((s) => <path d={pathD(s.data)} fill="none" key={`${s.label  }l`} stroke={s.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />)}
  </>
}

export const AreaChart = ({ height = 110, labels, series, width=600 }: { height?: number; labels?: string[]; series: Series[]; width?: number }) => {
  const svgRef = useRef<null | SVGSVGElement>(null);
  const [tip, setTip] = useState<null | { i: number; x: number }>(null);
  const H = height, W = width;
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;
  const maxV = Math.max(...series.flatMap((s) => s.data), 1);
  const dataLen = series[0]?.data.length ?? 0;
  const px = (i: number) => PAD.l + (i / (dataLen - 1)) * iW;
  const py = (v: number) => PAD.t + iH - (v / maxV) * iH;
  return <svg
    height={H}
    onMouseLeave={() => setTip(null)}
    onMouseMove={(e) => {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) {return;}
      const mx = ((e.clientX - r.left) / r.width) * W;
      const i = Math.round(((mx - PAD.l) / iW) * (dataLen - 1));
      if (i >= 0 && i < dataLen) {setTip({ i, x: px(i) });}
    }}
    ref={svgRef}
    style={{ overflow: "visible", userSelect: "none" }}
    viewBox={`0 0 ${W} ${H}`}
    width="100%"
  >
    <Line series={series} />
    {Array.from({ length: 5 }, (_, i) => maxV * (i / 4)).map((v, i) => <g key={i}>
      <line stroke="rgba(255,255,255,0.05)" strokeWidth="1" x1={PAD.l} x2={PAD.l + iW} y1={py(v)} y2={py(v)} />
      <text fill="rgba(255,255,255,0.28)" fontFamily="monospace" fontSize="8.5" textAnchor="end" x={PAD.l - 4} y={py(v) + 3}>{v > 999 ? `${(v / 1024).toFixed(0)}k` : Math.round(v)}</text>
    </g>)}
    <Axis H={H} iH={iH} labels={labels} px={px} py={py} series={series} />
    {tip && <>
      <line stroke="rgba(255,255,255,0.18)" strokeDasharray="3,3" strokeWidth="1" x1={tip.x} x2={tip.x} y1={PAD.t} y2={PAD.t + iH} />
      {series.map((s) => <circle cx={tip.x} cy={py(s.data[tip.i] ?? 0)} fill={s.color} key={s.label} r="3" stroke="#161b22" strokeWidth="1.5" />)}
      <g transform={`translate(${Math.min(tip.x + 8, W - 80)},${PAD.t + 4})`}>
        <rect fill="#0d1117" height={series.length * 14 + 12} rx="3" stroke="rgba(255,255,255,0.18)" strokeWidth="1" width="75" />
        {series.map((s, si) => <text fill={s.color} fontFamily="monospace" fontSize="9" key={s.label} x="6" y={16 + si * 14}>{s.label}: {Math.round(s.data[tip.i] ?? 0)}</text>)}
      </g>
    </>}
  </svg>
}
