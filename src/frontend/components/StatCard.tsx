import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react'

import { MUTED, panel, TEXT } from '../theme'
import { Sparkline } from './SparkLine'

interface NumberParts {
  decimals: number
  prefix: string
  suffix: string
  value: number
}

type TickDirection = -1 | 0 | 1

const getNumberParts = (value: number | string): null | NumberParts => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { decimals: Number.isInteger(value) ? 0 : 2, prefix: '', suffix: '', value }
  }

  if (typeof value !== 'string') return null

  const match = value.match(/^(?<prefix>[^\d-]*)(?<numeric>-?\d+(?:\.\d+)?)(?<suffix>.*)$/u)
  if (!match) return null
  const { numeric, prefix = '', suffix = '' } = match.groups ?? {}
  if (!numeric || /\d/u.test(suffix)) return null

  const parsed = Number(numeric)
  if (!Number.isFinite(parsed)) return null

  const [, fractional] = numeric.split('.')
  return { decimals: fractional?.length ?? 0, prefix, suffix, value: parsed }
}

const canAnimate = (next: null | NumberParts, prev: null | NumberParts): prev is NumberParts => Boolean(next && prev && prev.prefix === next.prefix && prev.suffix === next.suffix && prev.value !== next.value)

const formatAnimated = ({ decimals, prefix, suffix, value }: { decimals: number; prefix: string; suffix: string; value: number }): string => {
  const numeric = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString()
  return `${prefix}${numeric}${suffix}`
}

const getChangedMask = (previousText: string, currentText: string): boolean[] => {
  const changed = Array.from({ length: currentText.length }, () => false)
  const maxLen = Math.max(previousText.length, currentText.length)

  for (let offset = 0; offset < maxLen; offset += 1) {
    const previousChar = previousText[previousText.length - 1 - offset] ?? ''
    const currentIndex = currentText.length - 1 - offset
    if (currentIndex < 0) continue
    const currentChar = currentText[currentIndex] ?? ''
    if (previousChar !== currentChar) changed[currentIndex] = true
  }

  return changed
}

const startTickerAnimation = ({
  current,
  previous,
  setAffixes,
  setAnimatedValue,
  setDecimals,
  setDirection,
}: {
  current: NumberParts
  previous: NumberParts
  setAffixes: Dispatch<SetStateAction<{ prefix: string; suffix: string }>>
  setAnimatedValue: Dispatch<SetStateAction<null | number>>
  setDecimals: Dispatch<SetStateAction<number>>
  setDirection: Dispatch<SetStateAction<TickDirection>>
}): { flashReset: ReturnType<typeof setTimeout>; interval: ReturnType<typeof setInterval>; setupTimer: ReturnType<typeof setTimeout> } => {
  const durationMs = 440
  const startedAt = Date.now()
  const nextDirection: TickDirection = current.value > previous.value ? 1 : -1

  const setupTimer = setTimeout(() => {
    setAffixes({ prefix: current.prefix, suffix: current.suffix })
    setDecimals(Math.max(previous.decimals, current.decimals))
    setDirection(nextDirection)
  }, 0)

  const interval = setInterval(() => {
    const elapsed = Math.min(1, (Date.now() - startedAt) / durationMs)
    const eased = 1 - ((1 - elapsed) ** 3)
    setAnimatedValue(previous.value + ((current.value - previous.value) * eased))
    if (elapsed >= 1) clearInterval(interval)
  }, 16)

  const flashReset = setTimeout(() => setDirection(0), 290)
  return { flashReset, interval, setupTimer }
}

const scheduleTickerReset = ({
  parsed,
  setAffixes,
  setAnimatedValue,
  setDecimals,
  setDirection,
}: {
  parsed: null | NumberParts
  setAffixes: Dispatch<SetStateAction<{ prefix: string; suffix: string }>>
  setAnimatedValue: Dispatch<SetStateAction<null | number>>
  setDecimals: Dispatch<SetStateAction<number>>
  setDirection: Dispatch<SetStateAction<TickDirection>>
}): ReturnType<typeof setTimeout> => setTimeout(() => {
  setAnimatedValue(null)
  setDirection(0)
  setDecimals(parsed?.decimals ?? 0)
  setAffixes({ prefix: parsed?.prefix ?? '', suffix: parsed?.suffix ?? '' })
}, 0)

const useTickerDisplay = (value: number | string): { direction: TickDirection; renderedValue: number | string } => {
  const parsed = useMemo(() => getNumberParts(value), [value])
  const [animatedValue, setAnimatedValue] = useState<null | number>(parsed?.value ?? null)
  const [affixes, setAffixes] = useState<{ prefix: string; suffix: string }>({ prefix: parsed?.prefix ?? '', suffix: parsed?.suffix ?? '' })
  const [decimals, setDecimals] = useState<number>(parsed?.decimals ?? 0)
  const [direction, setDirection] = useState<TickDirection>(0)
  const prevPartsRef = useRef<null | NumberParts>(parsed)

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined
    let flashReset: ReturnType<typeof setTimeout> | undefined
    let resetTimer: ReturnType<typeof setTimeout> | undefined
    let setupTimer: ReturnType<typeof setTimeout> | undefined

    const prev = prevPartsRef.current
    if (canAnimate(parsed, prev)) {
      const { flashReset: nextFlashReset, interval: nextInterval, setupTimer: nextSetupTimer } = startTickerAnimation({ current: parsed as NumberParts, previous: prev, setAffixes, setAnimatedValue, setDecimals, setDirection })
      flashReset = nextFlashReset
      interval = nextInterval
      setupTimer = nextSetupTimer
    } else {
      resetTimer = scheduleTickerReset({ parsed, setAffixes, setAnimatedValue, setDecimals, setDirection })
    }
    prevPartsRef.current = parsed

    return () => {
      if (interval) clearInterval(interval)
      if (flashReset) clearTimeout(flashReset)
      if (resetTimer) clearTimeout(resetTimer)
      if (setupTimer) clearTimeout(setupTimer)
    }
  }, [parsed])

  if (!parsed || animatedValue === null) return { direction, renderedValue: value }
  return { direction, renderedValue: formatAnimated({ decimals, prefix: affixes.prefix, suffix: affixes.suffix, value: animatedValue }) }
}

const TickerText = ({ color, direction, text }: { color: string; direction: TickDirection; text: string }) => {
  const [changedMask, setChangedMask] = useState<boolean[]>([])
  const [previousText, setPreviousText] = useState<string>(text)

  useEffect(() => {
    let setMaskTimer: ReturnType<typeof setTimeout> | undefined
    let clearMaskTimer: ReturnType<typeof setTimeout> | undefined

    if (text !== previousText) {
      setMaskTimer = setTimeout(() => {
        setChangedMask(getChangedMask(previousText, text))
        setPreviousText(text)
      }, 0)
      clearMaskTimer = setTimeout(() => setChangedMask([]), 320)
    }

    return () => {
      if (setMaskTimer) clearTimeout(setMaskTimer)
      if (clearMaskTimer) clearTimeout(clearMaskTimer)
    }
  }, [previousText, text])

  return <div
    style={{
      color,
      fontFamily: 'monospace',
      fontSize: 22,
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 700,
      lineHeight: 1,
      whiteSpace: 'pre',
    }}
  >
    {text.split('').map((char, index) => {
      const shouldAnimate = changedMask[index]
      return <span
        key={`${index}-${char}-${text.length}`}
        style={{
          animation: shouldAnimate ? (direction === 1 ? 'ticker-up .28s steps(6,end)' : direction === -1 ? 'ticker-down .28s steps(6,end)' : undefined) : undefined,
          display: 'inline-block',
          textShadow: shouldAnimate && direction !== 0 ? `0 0 10px ${color}66` : undefined,
        }}
      >{char}</span>
    })}
  </div>
}

export const StatCard = ({ color = TEXT, label, spark, sub, value }: { color?: string; label: string; spark?: number[]; sub: string; value: number | string }) => {
  const { direction, renderedValue } = useTickerDisplay(value)
  const displayText = String(renderedValue)

  return <div style={panel()}>
    <div style={{ padding: '12px 14px' }}>
      <div style={{ color: MUTED, fontSize: 9, letterSpacing: '0.12em', marginBottom: 5, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ alignItems: 'flex-end', display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <TickerText color={color} direction={direction} text={displayText} />
          {sub && <div style={{ color: MUTED, fontSize: 9, marginTop: 3 }}>{sub}</div>}
        </div>
        {spark && <Sparkline color={color} data={spark} />}
      </div>
    </div>
  </div>
}
