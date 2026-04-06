import { useEffect, useRef, useState } from 'react'

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
  const previousSelectedAddressRef = useRef<null | string>(null)

  useEffect(() => {
    const getConversationLastTimestamp = (address: string): null | number => {
      const msgs = conversations.get(address)
      if (!msgs || msgs.length === 0) return null
      const lastMsg = msgs[msgs.length - 1]
      if (!lastMsg || typeof lastMsg !== 'object' || lastMsg === null || !('timestamp' in lastMsg) || typeof (lastMsg as { timestamp: unknown }).timestamp !== 'number') return null
      return (lastMsg as { timestamp: number }).timestamp
    }

    const previousSelectedAddress = previousSelectedAddressRef.current
    if (previousSelectedAddress && previousSelectedAddress !== selectedAddress) {
      const lastTimestamp = getConversationLastTimestamp(previousSelectedAddress)
      if (lastTimestamp !== null) {
        setLastRead(prev => {
          if (prev[previousSelectedAddress] === lastTimestamp) return prev
          const updated = { ...prev, [previousSelectedAddress]: lastTimestamp }
          saveLastRead(updated)
          return updated
        })
      }
    }

    if (selectedAddress) {
      const lastTimestamp = getConversationLastTimestamp(selectedAddress)
      if (lastTimestamp !== null) {
        setLastRead(prev => {
          if (prev[selectedAddress] === lastTimestamp) return prev
          const updated = { ...prev, [selectedAddress]: lastTimestamp }
          saveLastRead(updated)
          return updated
        })
      }
    }

    previousSelectedAddressRef.current = selectedAddress
  }, [selectedAddress, conversations])

  return [lastRead] as const
}
