import { useEffect, useRef } from 'react'

interface Props {
  address: `0x${string}`
  size?: number
  style?: React.CSSProperties
}

// Special identicon for the local API connection (address 0x0)
const drawApiIdenticon = (ctx: CanvasRenderingContext2D, size: number): void => {
  ctx.fillStyle = '#060e18'
  ctx.fillRect(0, 0, size, size)

  ctx.strokeStyle = 'rgba(0,200,255,0.45)'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1)

  const cell = size / 5
  const inset = Math.max(0.5, cell * 0.12)
  const cs = cell - inset * 2

  // Diamond pattern (row, col): outer ring
  const outer: [number, number][] = [[0,2],[1,1],[1,3],[2,0],[2,4],[3,1],[3,3],[4,2]]
  ctx.fillStyle = 'rgba(0,200,255,0.9)'
  for (const [r, c] of outer) ctx.fillRect(c * cell + inset, r * cell + inset, cs, cs)

  // Center dot — slightly dimmer
  ctx.fillStyle = 'rgba(0,200,255,0.35)'
  ctx.fillRect(2 * cell + inset, 2 * cell + inset, cs, cs)
}

const populateCanvas = (ctx: CanvasRenderingContext2D, hue: number, sat: number, size: number, address: `0x${string}`) => {
  ctx.fillStyle = `hsl(${hue},${sat}%,16%)`
  ctx.fillRect(0,0,size,size)
  ctx.fillStyle = `hsl(${hue},${sat}%,65%)`
  const cell = size/5
  for(let x=0;x<3;x++) {
    for(let y=0;y<5;y++) {
      const bit = parseInt(address.slice(2+y*3+x,3+y*3+x),16) > 7
      if(bit) {
        ctx.fillRect(x*cell+1, y*cell+1, cell-2, cell-2)
        if(x<2) ctx.fillRect((4-x)*cell+1, y*cell+1, cell-2, cell-2)
      }
    }
  }
}

export const Identicon = ({ address, size = 24, style }: Props) => {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (address === '0x0') { drawApiIdenticon(ctx, size); return }
    const hue = parseInt(address.slice(2,6),16) % 360
    const sat = 60 + parseInt(address.slice(6,8),16) % 30
    populateCanvas(ctx, hue, sat, size, address)

  }, [address, size])

  return <canvas height={size} ref={ref} style={{ borderRadius: 4, flexShrink: 0, imageRendering: 'pixelated', ...style }} width={size} />
}
