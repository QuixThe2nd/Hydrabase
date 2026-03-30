import { useEffect, useState } from 'react'

const LAST_READ_KEY = 'hydrabase:lastReadMessages'


const loadLastRead = (): Record<string, number> => {
  try {
    const raw = localStorage.getItem(LAST_READ_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}


const saveLastRead = (map: Record<string, number>) => {
  try {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}


export const useLastRead = (
  selectedAddress: null | string,
  conversations: Map<string, unknown[]>
) => {
  const [lastRead, setLastRead] = useState<Record<string, number>>(() => loadLastRead())

  useEffect(() => {
    if (!selectedAddress) return
    const msgs = conversations.get(selectedAddress)
    if (!msgs || msgs.length === 0) return
    const lastMsg = msgs[msgs.length - 1]
    if (!lastMsg || typeof lastMsg !== 'object' || lastMsg === null || !('timestamp' in lastMsg) || typeof (lastMsg as { timestamp: unknown }).timestamp !== 'number') return
    const lastTimestamp = (lastMsg as { timestamp: number }).timestamp
    if (lastRead[selectedAddress] !== lastTimestamp) {
      setTimeout(() => {
        setLastRead(prev => {
          if (prev[selectedAddress] === lastTimestamp) return prev
          const updated = { ...prev, [selectedAddress]: lastTimestamp }
          saveLastRead(updated)
          return updated
        })
      }, 0)
    }
  }, [selectedAddress, conversations, lastRead])

  return [lastRead] as const
}
