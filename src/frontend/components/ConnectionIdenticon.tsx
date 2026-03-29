import { type CSSProperties, useEffect, useRef } from 'react'

import { ACCENT, BG2, BORD2, GREEN, ORANGE, PURPLE, SURF, YELLOW } from '../theme'

interface Props {
  apiKey: string
  size?: number
  socket: string
  style?: CSSProperties
}

const withAlpha = (hexColor: string, alpha: number): string => `${hexColor}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
const HASH_MODULUS = 4294967291
const PALETTE = [ACCENT, GREEN, ORANGE, PURPLE, YELLOW]

const hashSeed = (seed: string): number[] => {
  const hashes = [2166136261, 2654435769, 2246822507, 3266489909]

  for (let index = 0; index < seed.length; index += 1) {
    const code = seed.charCodeAt(index)
    for (let hashIndex = 0; hashIndex < hashes.length; hashIndex += 1) {
      hashes[hashIndex] = ((hashes[hashIndex] ?? 0) * 16777619 + code + hashIndex * 17 + index) % HASH_MODULUS
    }
  }

  const bytes: number[] = []
  for (const hash of hashes) {
    let value = Math.floor(hash)
    for (let index = 0; index < 4; index += 1) {
      bytes.push(value % 256)
      value = Math.floor(value / 256)
    }
  }

  return bytes
}

const drawBackground = (ctx: CanvasRenderingContext2D, size: number): void => {
  const background = ctx.createLinearGradient(0, 0, size, size)
  background.addColorStop(0, BG2)
  background.addColorStop(1, SURF)
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = background
  ctx.fillRect(0, 0, size, size)

  ctx.strokeStyle = 'rgba(0, 200, 255, 0.15)'
  ctx.lineWidth = Math.max(1, size * 0.02)
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, size - ctx.lineWidth, size - ctx.lineWidth)
}

const drawGrid = (ctx: CanvasRenderingContext2D, bytes: number[], size: number): void => {
  const cell = size / 6

  for (let x = 0; x < 3; x += 1) {
    for (let y = 0; y < 6; y += 1) {
      const byte = bytes[(x * 6 + y) % bytes.length] ?? 0
      if (byte % 2 === 0) continue

      const inset = Math.max(1.25, cell * 0.12)
      const color = PALETTE[byte % PALETTE.length] ?? ACCENT
      const alpha = 0.26 + (Math.floor(byte / 8) % 40) / 100
      const px = x * cell + inset
      const py = y * cell + inset
      const mirroredX = (5 - x) * cell + inset
      const drawSize = cell - inset * 2

      ctx.fillStyle = withAlpha(color, alpha)
      ctx.fillRect(px, py, drawSize, drawSize)
      ctx.fillRect(mirroredX, py, drawSize, drawSize)
    }
  }
}

const drawCore = (ctx: CanvasRenderingContext2D, bytes: number[], size: number): void => {
  const center = size / 2

  ctx.beginPath()
  ctx.arc(center, center, size * 0.24, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(6, 10, 15, 0.92)'
  ctx.fill()

  ctx.beginPath()
  ctx.arc(center, center, size * 0.24, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(0, 200, 255, 0.5)'
  ctx.lineWidth = Math.max(1.5, size * 0.03)
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(center, center, size * 0.11, 0, Math.PI * 2)
  ctx.fillStyle = PALETTE[(bytes[1] ?? 0) % PALETTE.length] ?? ACCENT
  ctx.fill()
}

const drawSatellites = (ctx: CanvasRenderingContext2D, bytes: number[], size: number): void => {
  const center = size / 2

  for (let index = 0; index < 3; index += 1) {
    const byte = bytes[8 + index] ?? 0
    const angle = (Math.PI * 2 * ((byte % 100) / 100)) - Math.PI / 2
    const radius = size * (0.28 + index * 0.08)
    const x = center + Math.cos(angle) * radius
    const y = center + Math.sin(angle) * radius

    ctx.beginPath()
    ctx.arc(x, y, size * 0.035, 0, Math.PI * 2)
  ctx.fillStyle = PALETTE[byte % PALETTE.length] ?? ACCENT
    ctx.fill()

    ctx.beginPath()
    ctx.moveTo(center, center)
    ctx.lineTo(x, y)
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.18)'
    ctx.lineWidth = Math.max(1, size * 0.012)
    ctx.stroke()
  }
}

const drawConnectionIdenticon = (ctx: CanvasRenderingContext2D, seed: string, size: number): void => {
  const bytes = hashSeed(seed || 'hydrabase')
  drawBackground(ctx, size)
  drawGrid(ctx, bytes, size)
  drawCore(ctx, bytes, size)
  drawSatellites(ctx, bytes, size)
}

export const ConnectionIdenticon = ({ apiKey, size = 88, socket, style }: Props) => {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawConnectionIdenticon(ctx, `${socket.trim().toLowerCase()}|${apiKey.trim()}`, size)
  }, [apiKey, size, socket])

  return <canvas height={size} ref={ref} style={{ border: `1px solid ${BORD2}`, borderRadius: 16, boxShadow: '0 0 28px rgba(0, 200, 255, 0.16)', display: 'block', flexShrink: 0, imageRendering: 'pixelated', overflow: 'hidden', ...style }} width={size} />
}