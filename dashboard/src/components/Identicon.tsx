import { useEffect, useRef } from "react"

interface Props {
  address: string
  size?: number
  style?: React.CSSProperties
}

export const Identicon = ({ address, size = 24, style }: Props) => {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const hue = parseInt(address.slice(2,6),16) % 360
    const sat = 60 + parseInt(address.slice(6,8),16) % 30
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
  }, [address, size])

  return <canvas ref={ref} width={size} height={size} style={{ borderRadius: 4, flexShrink: 0, imageRendering: "pixelated", ...style }} />
}
