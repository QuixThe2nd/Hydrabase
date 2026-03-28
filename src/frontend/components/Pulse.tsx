/* eslint-disable max-lines, max-lines-per-function */

import { useEffect, useMemo, useRef, useState } from 'react'

import type { BwPoint } from '../App'

import { ACCENT, BG2, BORD, GREEN, MUTED, ORANGE, TEXT } from '../theme'

const MAX_WINDOW_SECONDS = 6 * 60 * 60
const MAX_WINDOW_MS = MAX_WINDOW_SECONDS * 1000
const EMPTY_BUCKET_DECAY = 0.92
const RENDER_ANIMATION_MS = 220

type PulseFocusMode = 'both' | 'dl' | 'ul'

interface SeriesData {
  dl: number[]
  ul: number[]
}

const buildLegendButtonStyle = (active: boolean, color: string): React.CSSProperties => ({
  alignItems: 'center',
  background: active ? `${color}14` : 'transparent',
  border: `1px solid ${active ? `${color}55` : BORD}`,
  borderRadius: 999,
  color,
  cursor: 'pointer',
  display: 'flex',
  fontFamily: 'inherit',
  fontSize: 10,
  gap: 6,
  opacity: active ? 1 : 0.72,
  padding: '4px 9px',
  transition: 'background .15s, border-color .15s, opacity .15s',
})

const Pulse = ({ canvasRef, focusMode, setFocusMode, windowLabel }: { canvasRef: React.RefObject<HTMLCanvasElement | null>; focusMode: PulseFocusMode; setFocusMode: React.Dispatch<React.SetStateAction<PulseFocusMode>>; windowLabel: string }) => <div style={{ background: BG2, border: `1px solid ${BORD}`, borderRadius: 8, overflow: 'hidden' }}>
  <div style={{ alignItems: 'center', borderBottom: `1px solid ${BORD}`, display: 'flex', gap: 8, padding: '9px 14px' }}>
    <div style={{ animation: 'pulse-dot 1.4s ease infinite', background: GREEN, borderRadius: '50%', height: 6, width: 6 }} />
    <span style={{ color: TEXT, fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>Network Pulse</span>
    <span style={{ color: MUTED, fontSize: 10, marginLeft: 'auto' }}>{windowLabel}</span>
    <div style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
      <button
        aria-label="Toggle download focus"
        aria-pressed={focusMode === 'dl'}
        onClick={() => setFocusMode((current) => current === 'dl' ? 'both' : 'dl')}
        style={buildLegendButtonStyle(focusMode !== 'ul', ORANGE)}
        type="button"
      >
        <span style={{ background: ORANGE, borderRadius: 2, display: 'inline-block', height: 2, width: 12 }} />
        DL
      </button>
      <button
        aria-label="Toggle upload focus"
        aria-pressed={focusMode === 'ul'}
        onClick={() => setFocusMode((current) => current === 'ul' ? 'both' : 'ul')}
        style={buildLegendButtonStyle(focusMode !== 'dl', ACCENT)}
        type="button"
      >
        <span style={{ background: ACCENT, borderRadius: 2, display: 'inline-block', height: 2, width: 12 }} />
        UL
      </button>
    </div>
  </div>
  <div style={{ height: 120, position: 'relative' }}>
    <canvas ref={canvasRef} style={{ display: 'block', height: '100%', width: '100%' }} />
  </div>
</div>

const getWindowSeconds = (bwHistory: BwPoint[]): number => {
  if (bwHistory.length < 2) return 60
  const [first] = bwHistory
  const last = bwHistory[bwHistory.length - 1]
  if (!first || !last) return 60
  const spanSeconds = Math.floor((last.t - first.t) / 1000)
  return Math.max(1, Math.min(spanSeconds, MAX_WINDOW_SECONDS))
}

const formatWindowLabel = (windowSeconds: number): string => {
  if (windowSeconds < 60) return `live · ${windowSeconds}s window`
  if (windowSeconds < 3600) return `live · ${Math.floor(windowSeconds / 60)}m window`
  return `live · ${(windowSeconds / 3600).toFixed(1)}h window (max 6h)`
}

const smoothSeries = (values: number[]): number[] => {
  if (values.length < 2) return values
  const smoothed: number[] = [values[0] ?? 0]
  for (let i = 1; i < values.length; i += 1) {
    const current = values[i] ?? 0
    const previous = smoothed[i - 1] ?? current
    smoothed.push((previous * 0.6) + (current * 0.4))
  }
  return smoothed
}

const toDisplaySeries = (bwHistory: BwPoint[], bucketCount: number): null | SeriesData => {
  if (bucketCount < 2) return null
  if (bwHistory.length === 0) return null

  const latestPoint = bwHistory[bwHistory.length - 1]
  if (!latestPoint) return null

  const now = latestPoint.t
  const oldestTimestamp = bwHistory[0]?.t ?? now
  const windowMs = Math.max(1000, Math.min(MAX_WINDOW_MS, now - oldestTimestamp))
  const start = now - windowMs
  const points = bwHistory.filter((point) => point.t >= start)
  if (points.length === 0) return null

  const bucketMs = windowMs / bucketCount
  const dlSeries: number[] = []
  const ulSeries: number[] = []
  let pointIndex = 0
  let carryDl = 0
  let carryUl = 0

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const bucketStart = start + (bucket * bucketMs)
    const bucketEnd = bucketStart + bucketMs
    let dlSum = 0
    let ulSum = 0
    let count = 0

    while (pointIndex < points.length) {
      const point = points[pointIndex]
      if (!point || point.t >= bucketEnd) break
      dlSum += point.dl
      ulSum += point.ul
      count += 1
      pointIndex += 1
    }

    if (count > 0) {
      carryDl = dlSum / count
      carryUl = ulSum / count
    } else {
      carryDl *= EMPTY_BUCKET_DECAY
      carryUl *= EMPTY_BUCKET_DECAY
    }

    dlSeries.push(carryDl)
    ulSeries.push(carryUl)
  }

  return {
    dl: smoothSeries(dlSeries),
    ul: smoothSeries(ulSeries),
  }
}


const drawCurvedPath = (ctx: CanvasRenderingContext2D, points: { x: number; y: number }[]) => {
  const [first] = points
  if (!first) return
  ctx.moveTo(first.x, first.y)
  if (points.length < 3) {
    points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y))
    return
  }

  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i]
    const next = points[i + 1]
    if (!current || !next) continue
    const midX = (current.x + next.x) / 2
    const midY = (current.y + next.y) / 2
    ctx.quadraticCurveTo(current.x, current.y, midX, midY)
  }

  const last = points[points.length - 1]
  if (last) ctx.lineTo(last.x, last.y)
}


const drawSeries = (data: number[], color: string, glowColor: string, maxVal: number, W: number, H: number, ctx: CanvasRenderingContext2D, xOffset = 0) => {
  if (data.length < 2) return

  const pts = data.map((v, i) => ({
    x: ((i / (data.length - 1)) * W) + xOffset,
    y: H - (v / maxVal) * (H * 0.82),
  }))

  // Fill
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, `${color}33`)
  grad.addColorStop(1, `${color}04`)
  ctx.fillStyle = grad
  ctx.beginPath()
  const [first] = pts
  if (!first) return
  ctx.moveTo(first.x, H)
  ctx.lineTo(first.x, first.y)
  drawCurvedPath(ctx, pts)
  ctx.lineTo(W, H)
  ctx.closePath()
  ctx.fill()

  // Line
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  ctx.shadowBlur = 7
  ctx.shadowColor = glowColor
  ctx.beginPath()
  drawCurvedPath(ctx, pts)
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

const drawGrid = (ctx: CanvasRenderingContext2D, W: number, H: number) => {
  ctx.clearRect(0, 0, W, H)

  // Subtle grid
  ctx.strokeStyle = 'rgba(26,37,53,.55)'
  ctx.lineWidth   = 1
  for (let x = 0; x < W; x += W / 12) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
  }
  for (let y = 0; y < H; y += H / 4) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
  }
}

const getSeriesMax = (series: SeriesData, focusMode: PulseFocusMode): number => {
  const visibleData = focusMode === 'dl' ? series.dl : focusMode === 'ul' ? series.ul : [...series.ul, ...series.dl]
  return Math.max(...visibleData, 1)
}

const drawSeriesData = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  series: null | SeriesData,
  focusMode: PulseFocusMode,
  alpha = 1,
  xOffset = 0,
  clipX = 0,
  clipWidth = W,
  maxValOverride?: number,
) => {
  if (!series) return
  if (series.dl.length < 2 || series.ul.length < 2) return
  if (clipWidth <= 0) return

  const ulData = series.ul
  const dlData = series.dl
  const maxVal = maxValOverride ?? getSeriesMax(series, focusMode)

  ctx.save()
  ctx.beginPath()
  ctx.rect(clipX, 0, clipWidth, H)
  ctx.clip()
  ctx.globalAlpha = alpha
  if (focusMode !== 'ul') drawSeries(dlData, ORANGE,  'rgba(255,140,66,.6)', maxVal, W, H, ctx, xOffset)
  if (focusMode !== 'dl') drawSeries(ulData, ACCENT,  'rgba(0,200,255,.6)', maxVal, W, H, ctx, xOffset)
  ctx.restore()
}

const seriesEqual = (left: SeriesData, right: SeriesData): boolean => {
  if (left.dl.length !== right.dl.length || left.ul.length !== right.ul.length) return false
  return left.dl.every((value, index) => value === right.dl[index]) && left.ul.every((value, index) => value === right.ul[index])
}

export const NetworkPulseCanvas = ({ bwHistory }: { bwHistory: BwPoint[] }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<null | number>(null)
  const renderedSeriesRef = useRef<null | SeriesData>(null)
  const [canvasSize, setCanvasSize] = useState({ height: 0, width: 0 })
  const [focusMode, setFocusMode] = useState<PulseFocusMode>('both')
  const windowLabel = useMemo(() => formatWindowLabel(getWindowSeconds(bwHistory)), [bwHistory])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const parent = canvas.parentElement
    if (!parent) return undefined

    const resize = () => {
      const width = Math.floor(parent.clientWidth)
      const height = Math.floor(parent.clientHeight)
      setCanvasSize(prev => prev.width === width && prev.height === height ? prev : { height, width })
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(parent)
    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvasSize.width
    const H = canvasSize.height
    if (!W || !H) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(W * dpr)
    canvas.height = Math.floor(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    const targetBuckets = Math.max(2, Math.floor(W / 3))
    const targetSeries = toDisplaySeries(bwHistory, targetBuckets)
    drawGrid(ctx, W, H)

    const previousSeries = renderedSeriesRef.current
    if (!targetSeries) {
      renderedSeriesRef.current = null
      return
    }

    if (!previousSeries || previousSeries.dl.length !== targetSeries.dl.length || previousSeries.ul.length !== targetSeries.ul.length) {
      drawSeriesData(ctx, W, H, targetSeries, focusMode)
      renderedSeriesRef.current = targetSeries
      return
    }

    if (seriesEqual(previousSeries, targetSeries)) {
      drawSeriesData(ctx, W, H, targetSeries, focusMode)
      renderedSeriesRef.current = targetSeries
      return
    }

    const bucketWidth = W / Math.max(1, targetSeries.dl.length - 1)
    const sharedMaxVal = Math.max(getSeriesMax(previousSeries, focusMode), getSeriesMax(targetSeries, focusMode))
    let startedAt: null | number = null
    const renderFrame = (elapsed: number) => {
      const clampedElapsed = Math.min(1, Math.max(0, elapsed))
      const eased = 1 - ((1 - clampedElapsed) ** 3)
      const outgoingOffset = -bucketWidth * eased
      const incomingOffset = bucketWidth * (1 - eased)
      const seamX = Math.max(0, Math.min(W, incomingOffset))
      drawGrid(ctx, W, H)
      drawSeriesData(ctx, W, H, previousSeries, focusMode, 1, outgoingOffset, 0, seamX, sharedMaxVal)
      drawSeriesData(ctx, W, H, targetSeries, focusMode, 1, incomingOffset, seamX, W - seamX, sharedMaxVal)
    }
    const animate = (now: number) => {
      if (startedAt === null) startedAt = now
      const elapsed = Math.min(1, (now - startedAt) / RENDER_ANIMATION_MS)
      renderFrame(elapsed)

      if (elapsed < 1) {
        animationFrameRef.current = requestAnimationFrame(animate)
        return
      }

      renderedSeriesRef.current = targetSeries
      animationFrameRef.current = null
    }

    renderFrame(0)
    animationFrameRef.current = requestAnimationFrame(animate)
  }, [bwHistory, canvasSize, focusMode])

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
  }, [])

  return <Pulse canvasRef={canvasRef} focusMode={focusMode} setFocusMode={setFocusMode} windowLabel={windowLabel} />
}
