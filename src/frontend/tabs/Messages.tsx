
 
import { useEffect, useRef, useState } from 'react'

import type { PeerWithCountry } from '../../types/hydrabase'
import type { MessageEnvelope } from '../../types/hydrabase-schemas'

import { Identicon } from '../components/Identicon'
import { ACCENT, BG, BG3, BORD, MUTED, panel, SURF, TEXT } from '../theme'
import { shortAddr } from '../utils'

interface Props {
  messages: MessageEnvelope[]
  onMarkRead: (conversationAddress: `0x${string}`, lastReadTimestamp: number) => void
  onSelectAddress: (address: `0x${string}` | null) => void
  ownAddress: `0x${string}` | undefined
  peers: PeerWithCountry[]
  readState: Record<string, number>
  selectedAddress: `0x${string}` | null
  sendMessage: (to: `0x${string}`, payload: string) => void
}

const GLOBAL_CHAT_ADDRESS = '0x0' as `0x${string}`

const getConversations = (messages: MessageEnvelope[], ownAddress: string | undefined): Map<string, MessageEnvelope[]> => {
  const convMap = new Map<string, MessageEnvelope[]>()
  for (const msg of messages) {
    const partner = msg.to === GLOBAL_CHAT_ADDRESS ? GLOBAL_CHAT_ADDRESS : (msg.from === ownAddress ? msg.to : msg.from)
    const existing = convMap.get(partner) ?? []
    existing.push(msg)
    convMap.set(partner, existing)
  }
  return convMap
}

const fmtTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const fmtConversationTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp)
  const now = new Date()
  const isSameDay = date.toDateString() === now.toDateString()
  if (isSameDay) return fmtTime(timestamp)

  return date.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

const FAILED_CONNECT_PREFIX = 'system:connection_attempt_failed|'

interface ParsedFailedConnectNotice {
  at?: string
  hostname?: string
  reason?: string
  stack?: string
  transport?: 'TCP' | 'UTP'
}

const getFailedConnectMessageText = (notice: ParsedFailedConnectNotice): string => {
  const target = notice.hostname ?? 'your node'
  const via = notice.transport ? ` over ${notice.transport}` : ''
  return `Hey, I couldn't connect to your node at ${target}${via}.`
}

const parseFailedConnectNotice = (payload: string): null | ParsedFailedConnectNotice => {
  if (!payload.startsWith(FAILED_CONNECT_PREFIX)) return null
  const raw = payload.slice(FAILED_CONNECT_PREFIX.length)
  const fields = new URLSearchParams(raw.split('|').join('&'))
  const transport = fields.get('transport')
  const parsed: ParsedFailedConnectNotice = {}
  const at = fields.get('at')
  const hostname = fields.get('hostname')
  const reason = fields.get('reason')
  const stack = fields.get('stack')
  if (at) parsed.at = at
  if (hostname) parsed.hostname = hostname
  if (reason) parsed.reason = reason
  if (stack) parsed.stack = stack
  if (transport === 'TCP' || transport === 'UTP') parsed.transport = transport
  return parsed
}

const getMessagePreview = (payload: string): string => {
  const failedConnect = parseFailedConnectNotice(payload)
  if (!failedConnect) return payload
  return getFailedConnectMessageText(failedConnect)
}

// eslint-disable-next-line max-lines-per-function
export const MessagesTab = ({ messages, onMarkRead, onSelectAddress, ownAddress, peers, readState, selectedAddress, sendMessage }: Props) => {
  const conversations = getConversations(messages, ownAddress)
  const [composeText, setComposeText] = useState('')
  const [newRecipient, setNewRecipient] = useState('')
  const [showNewConv, setShowNewConv] = useState(false)
  const threadEndRef = useRef<HTMLDivElement>(null)

  // conversations already declared above
  const peerMap = new Map(peers.map(p => [p.address, p]))
  const thread = selectedAddress ? (conversations.get(selectedAddress) ?? []) : []
  const lastReadTime = selectedAddress ? (readState[selectedAddress] || 0) : 0
  const latestThreadTimestamp = thread[thread.length - 1]?.timestamp ?? 0
  const firstUnreadIncomingIndex = thread.findIndex(msg => msg.from !== ownAddress && msg.timestamp > lastReadTime)

  useEffect(() => {
    if (!selectedAddress) return
    if (!latestThreadTimestamp || latestThreadTimestamp <= lastReadTime) return
    onMarkRead(selectedAddress, latestThreadTimestamp)
  }, [lastReadTime, latestThreadTimestamp, onMarkRead, selectedAddress])

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread.length])

  const handleSend = () => {
    if (!selectedAddress || !composeText.trim()) return
    sendMessage(selectedAddress, composeText.trim())
    setComposeText('')
  }

  const handleStartConversation = () => {
    const addr = newRecipient.trim() as `0x${string}`
    if (addr !== GLOBAL_CHAT_ADDRESS && !addr.startsWith('0x')) return
    onSelectAddress(addr)
    setShowNewConv(false)
    setNewRecipient('')
  }

  const getPeerName = (address: string) => {
    if (address === GLOBAL_CHAT_ADDRESS) return 'Global Chat'
    return peerMap.get(address as `0x${string}`)?.connection?.username ?? shortAddr(address)
  }

  const globalChatMsgs = conversations.get(GLOBAL_CHAT_ADDRESS)
  const dmConversations = [...conversations.entries()]
    .filter(([addr]) => addr !== GLOBAL_CHAT_ADDRESS)
    .sort(([addressA, messagesA], [addressB, messagesB]) => {
      const lastTimestampA = messagesA[messagesA.length - 1]?.timestamp ?? 0
      const lastTimestampB = messagesB[messagesB.length - 1]?.timestamp ?? 0
      if (lastTimestampB !== lastTimestampA) return lastTimestampB - lastTimestampA
      return addressA.localeCompare(addressB)
    })

  return <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 120px)' }}>

    {/* Left: conversation list */}
    <div style={{ ...panel(), display: 'flex', flexDirection: 'column', flexShrink: 0, width: 240 }}>
      <div style={{ alignItems: 'center', borderBottom: `1px solid ${BORD}`, display: 'flex', justifyContent: 'space-between', padding: '10px 14px' }}>
        <span style={{ color: MUTED, fontSize: 9, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>Conversations</span>
        <button className="fbtn" onClick={() => setShowNewConv(v => !v)} style={{ fontSize: 14, lineHeight: 1, padding: '1px 7px' }}>+</button>
      </div>

      {showNewConv && <div style={{ borderBottom: `1px solid ${BORD}`, display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px' }}>
        <input
          list="dm-peer-list"
          onChange={e => setNewRecipient(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleStartConversation()}
          placeholder="Address or peer name…"
          style={{ background: BG, border: `1px solid ${BORD}`, borderRadius: 4, color: TEXT, fontFamily: 'inherit', fontSize: 11, padding: '5px 8px' }}
          value={newRecipient}
        />
        <datalist id="dm-peer-list">
          {peers.map(p => <option key={p.address} value={p.address}>{p.connection?.username}</option>)}
        </datalist>
        <button className="fbtn" onClick={handleStartConversation} style={{ textAlign: 'center' }}>Open</button>
      </div>}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Global Chat pinned entry */}
        {(() => {
          const isSelected = selectedAddress === GLOBAL_CHAT_ADDRESS
          const lastMsg = globalChatMsgs?.[globalChatMsgs.length - 1]
          return <button onClick={() => onSelectAddress(GLOBAL_CHAT_ADDRESS)} style={{ alignItems: 'center', background: isSelected ? 'rgba(0,200,255,.08)' : 'rgba(0,200,255,.03)', border: 'none', borderBottom: `1px solid ${BORD}`, borderLeft: `2px solid ${isSelected ? ACCENT : 'rgba(0,200,255,.3)'}`, color: TEXT, cursor: 'pointer', display: 'flex', fontFamily: 'inherit', gap: 10, padding: '10px 12px', textAlign: 'left', width: '100%' }}>
            <div style={{ alignItems: 'center', background: 'rgba(0,200,255,.15)', border: '1px solid rgba(0,200,255,.3)', borderRadius: 4, color: ACCENT, display: 'flex', flexShrink: 0, fontSize: 14, height: 28, justifyContent: 'center', width: 28 }}>#</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ alignItems: 'center', display: 'flex', gap: 8, minWidth: 0 }}>
                <div style={{ flex: 1, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Global Chat</div>
                {lastMsg && <span style={{ color: MUTED, flexShrink: 0, fontSize: 9, marginLeft: 'auto' }}>{fmtConversationTimestamp(lastMsg.timestamp)}</span>}
              </div>
              <div style={{ color: MUTED, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lastMsg ? getMessagePreview(lastMsg.payload) : 'Broadcast to all peers'}</div>
            </div>
          </button>
        })()}

        {dmConversations.length === 0 && !globalChatMsgs && <div style={{ color: MUTED, fontSize: 11, padding: '20px 14px', textAlign: 'center' }}>No messages yet.<br />Press + to start one.</div>}
        {dmConversations.map(([addr, msgs]) => {
          const lastMsg = msgs[msgs.length - 1]
          const isSelected = selectedAddress === addr
          // Show unread badge if there are messages newer than lastRead
          const lastReadTime = readState[addr] || 0
          const unreadCount = msgs.filter(m => m.from !== ownAddress && m.timestamp > lastReadTime).length
          return <button key={addr} onClick={() => onSelectAddress(addr as `0x${string}`)} style={{ alignItems: 'center', background: isSelected ? 'rgba(0,200,255,.08)' : 'none', border: 'none', borderBottom: `1px solid ${BORD}`, borderLeft: `2px solid ${isSelected ? ACCENT : 'transparent'}`, color: TEXT, cursor: 'pointer', display: 'flex', fontFamily: 'inherit', gap: 10, padding: '10px 12px', textAlign: 'left', width: '100%' }}>
            <Identicon address={addr as `0x${string}`} size={28} style={{ borderRadius: 4, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ alignItems: 'center', display: 'flex', gap: 8, minWidth: 0 }}>
                <div style={{ flex: 1, fontSize: 12, fontWeight: unreadCount > 0 ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {getPeerName(addr)}
                </div>
                <div style={{ alignItems: 'center', display: 'flex', flexShrink: 0, gap: 6, marginLeft: 'auto' }}>
                  {unreadCount > 0 && <span style={{ background: '#ff4a5e', borderRadius: 99, color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px' }}>{unreadCount}</span>}
                  {lastMsg && <span style={{ color: MUTED, fontSize: 9 }}>{fmtConversationTimestamp(lastMsg.timestamp)}</span>}
                </div>
              </div>
              <div style={{ color: MUTED, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lastMsg ? getMessagePreview(lastMsg.payload) : ''}</div>
            </div>
          </button>
        })}
      </div>
    </div>

    {/* Right: thread or empty state */}
    {selectedAddress
      ? <div style={{ display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0 }}>

          {/* Thread header */}
          <div style={{ ...panel({ borderRadius: '8px 8px 0 0', overflow: 'visible' }), alignItems: 'center', borderBottom: 'none', display: 'flex', gap: 10, padding: '10px 16px' }}>
            {selectedAddress === GLOBAL_CHAT_ADDRESS
              ? <div style={{ alignItems: 'center', background: 'rgba(0,200,255,.15)', border: '1px solid rgba(0,200,255,.3)', borderRadius: 5, color: ACCENT, display: 'flex', flexShrink: 0, fontSize: 16, height: 30, justifyContent: 'center', width: 30 }}>#</div>
              : <Identicon address={selectedAddress} size={30} style={{ borderRadius: 5, flexShrink: 0 }} />}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getPeerName(selectedAddress)}</div>
              <div style={{ color: MUTED, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedAddress === GLOBAL_CHAT_ADDRESS ? 'Messages broadcast to all connected peers' : selectedAddress}
              </div>
            </div>
            <button className="fbtn" onClick={() => onSelectAddress(null)} style={{ flexShrink: 0, marginLeft: 'auto' }}>✕</button>
          </div>

          {/* Messages */}
          <div style={{ background: SURF, border: `1px solid ${BORD}`, borderBottom: 'none', borderTop: 'none', flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            {thread.length === 0
              ? <div style={{ color: MUTED, fontSize: 11, paddingTop: 20, textAlign: 'center' }}>No messages yet. Say hello!</div>
              : thread.map((msg, i) => {
                  const isMine = msg.from === ownAddress
                  const isGlobal = selectedAddress === GLOBAL_CHAT_ADDRESS
                  const failedConnect = parseFailedConnectNotice(msg.payload)
                  const showUnreadSeparator = i === firstUnreadIncomingIndex
                  // Highlight unread incoming messages in the thread
                  const isNew = !isMine && msg.timestamp > lastReadTime
                  return <div key={i}>
                    {showUnreadSeparator && <div style={{ alignItems: 'center', display: 'flex', gap: 10, margin: '6px 0 10px' }}>
                      <div style={{ background: BORD, flex: 1, height: 1 }} />
                      <span style={{ color: '#ff4a5e', fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>Unread messages</span>
                      <div style={{ background: BORD, flex: 1, height: 1 }} />
                    </div>}
                    <div style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                      <div style={{ maxWidth: '70%' }}>
                        {isGlobal && !isMine && <div style={{ color: MUTED, fontSize: 10, marginBottom: 2, paddingLeft: 4 }}>{getPeerName(msg.from)}</div>}
                        <div style={{
                          background: isMine ? 'rgba(0,200,255,.12)' : (isNew ? 'rgba(255,74,94,0.13)' : BG3),
                          border: `1px solid ${isMine ? 'rgba(0,200,255,.25)' : (isNew ? '#ff4a5e' : BORD)}`,
                          borderRadius: isMine ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                          boxShadow: isNew ? '0 0 0 2px #ff4a5e33' : undefined,
                          padding: '8px 12px',
                          position: 'relative',
                        }}>
                          {failedConnect
                            ? <>
                                <div style={{ fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                  {getFailedConnectMessageText(failedConnect)}
                                </div>
                                {failedConnect.reason && <div style={{ color: MUTED, fontSize: 10, lineHeight: 1.4, marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>I got: {failedConnect.reason}</div>}
                                {failedConnect.stack && <pre style={{ background: BG, border: `1px solid ${BORD}`, borderRadius: 6, color: TEXT, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 10, lineHeight: 1.35, margin: '6px 0 0', maxHeight: 180, overflowX: 'auto', overflowY: 'auto', padding: '8px 9px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{failedConnect.stack}</pre>}
                              </>
                            : <div style={{ fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.payload}</div>}
                          <div style={{ color: MUTED, fontSize: 9, marginTop: 4, textAlign: 'right' }}>{fmtTime(msg.timestamp)}{isNew && <span style={{ color: '#ff4a5e', fontWeight: 700, marginLeft: 6 }}>NEW</span>}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                })}
            <div ref={threadEndRef} />
          </div>

          {/* Compose */}
          <div style={{ ...panel({ borderRadius: '0 0 8px 8px' }), alignItems: 'flex-end', borderTop: 'none', display: 'flex', gap: 8, padding: '10px 16px' }}>
            <textarea
              onChange={e => setComposeText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="Type a message… (Enter to send)"
              rows={2}
              style={{ background: BG, border: `1px solid ${BORD}`, borderRadius: 6, color: TEXT, flex: 1, fontFamily: 'inherit', fontSize: 12, padding: '8px 10px', resize: 'none' }}
              value={composeText}
            />
            <button
              disabled={!composeText.trim()}
              onClick={handleSend}
              style={{ background: composeText.trim() ? ACCENT : 'transparent', border: `1px solid ${composeText.trim() ? ACCENT : BORD}`, borderRadius: 6, color: composeText.trim() ? '#000' : MUTED, cursor: composeText.trim() ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, padding: '10px 18px' }}
            >Send</button>
          </div>

        </div>
      : <div style={{ ...panel(), alignItems: 'center', display: 'flex', flex: 1, justifyContent: 'center' }}>
          <div style={{ color: MUTED, fontSize: 13, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>✉</div>
            Select a conversation or press + to start one
          </div>
        </div>}
  </div>
}
