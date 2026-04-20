import { useEffect, useRef, useState } from 'react'

import type { MessageReadState } from '../../types/hydrabase'

const LAST_READ_KEY = 'hydrabase:lastReadMessages'


const loadLastRead = (): MessageReadState => {
  try {
    const raw = localStorage.getItem(LAST_READ_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}


const saveLastRead = (map: MessageReadState) => {
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
  const [lastRead, setLastRead] = useState<MessageReadState>(() => loadLastRead())
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
      const latestTimestamp = getConversationLastTimestamp(selectedAddress)
      if (latestTimestamp !== null) {
        setLastRead(prev => {
          if (prev[selectedAddress] === latestTimestamp) return prev
          const updated = { ...prev, [selectedAddress]: latestTimestamp }
          saveLastRead(updated)
          return updated
        })
      }
    }

    previousSelectedAddressRef.current = selectedAddress
  }, [selectedAddress, conversations])

  return [lastRead] as const
}
