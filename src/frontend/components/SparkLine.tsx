export const Sparkline = ({ color = "#3fb950", data, height = 26, width = 80 }: { color?: string; data?: number[]; height?: number; width?: number }) => {
  if (!data?.length) return <svg height={height} width={width} />
  const max = Math.max(...data, 1)
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - (v / max) * (height - 2) - 1}`).join(' ')
  const id = `sg${color.replace("#", "")}`
  return <svg height={height} style={{ overflow: "visible" }} width={width}>
    <defs>
      <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%"   stopColor={color} stopOpacity="0.25" />
        <stop offset="100%" stopColor={color} stopOpacity="0" />
      </linearGradient>
    </defs>
    <polygon fill={`url(#${id})`} points={`0,${height} ${pts} ${width},${height}`} />
    <polyline fill="none" points={pts} stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
  </svg>
}
