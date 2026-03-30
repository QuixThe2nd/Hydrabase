import { useEffect, useRef, useState } from 'react'

import type { PeerWithCountry } from '../../types/hydrabase'
import type { MessageEnvelope } from '../../types/hydrabase-schemas'

import { Identicon } from '../components/Identicon'
import { ACCENT, BG, BG3, BORD, MUTED, panel, SURF, TEXT } from '../theme'
import { shortAddr } from '../utils'

interface Props {
  messages: MessageEnvelope[]
  ownAddress: `0x${string}` | undefined
  peers: PeerWithCountry[]
  sendMessage: (to: `0x${string}`, payload: string) => void
}

const getConversations = (messages: MessageEnvelope[], ownAddress: string | undefined): Map<string, MessageEnvelope[]> => {
  const convMap = new Map<string, MessageEnvelope[]>()
  for (const msg of messages) {
    const partner = msg.from === ownAddress ? msg.to : msg.from
    const existing = convMap.get(partner) ?? []
    existing.push(msg)
    convMap.set(partner, existing)
  }
  return convMap
}

const fmtTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const FAILED_CONNECT_PREFIX = 'system:connection_attempt_failed|'

interface ParsedFailedConnectNotice {
  at?: string
  hostname?: string
  reason?: string
  transport?: 'TCP' | 'UDP'
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
  if (at) parsed.at = at
  if (hostname) parsed.hostname = hostname
  if (reason) parsed.reason = reason
  if (transport === 'TCP' || transport === 'UDP') parsed.transport = transport
  return parsed
}

const getMessagePreview = (payload: string): string => {
  const failedConnect = parseFailedConnectNotice(payload)
  if (!failedConnect) return payload
  return getFailedConnectMessageText(failedConnect)
}

// eslint-disable-next-line max-lines-per-function
export const MessagesTab = ({ messages, ownAddress, peers, sendMessage }: Props) => {
  const [selectedAddress, setSelectedAddress] = useState<`0x${string}` | null>(null)
  const [composeText, setComposeText] = useState('')
  const [newRecipient, setNewRecipient] = useState('')
  const [showNewConv, setShowNewConv] = useState(false)
  const threadEndRef = useRef<HTMLDivElement>(null)

  const conversations = getConversations(messages, ownAddress)
  const peerMap = new Map(peers.map(p => [p.address, p]))
  const thread = selectedAddress ? (conversations.get(selectedAddress) ?? []) : []

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
    if (!addr.startsWith('0x')) return
    setSelectedAddress(addr)
    setShowNewConv(false)
    setNewRecipient('')
  }

  const getPeerName = (address: string) => peerMap.get(address as `0x${string}`)?.connection?.username ?? shortAddr(address)

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
        {conversations.size === 0 && <div style={{ color: MUTED, fontSize: 11, padding: '20px 14px', textAlign: 'center' }}>No messages yet.<br />Press + to start one.</div>}
        {[...conversations.entries()].map(([addr, msgs]) => {
          const lastMsg = msgs[msgs.length - 1]
          const isSelected = selectedAddress === addr
          const hasUnread = lastMsg && lastMsg.from !== ownAddress
          return <button key={addr} onClick={() => setSelectedAddress(addr as `0x${string}`)} style={{ alignItems: 'center', background: isSelected ? 'rgba(0,200,255,.08)' : 'none', border: 'none', borderBottom: `1px solid ${BORD}`, borderLeft: `2px solid ${isSelected ? ACCENT : 'transparent'}`, color: TEXT, cursor: 'pointer', display: 'flex', fontFamily: 'inherit', gap: 10, padding: '10px 12px', textAlign: 'left', width: '100%' }}>
            <Identicon address={addr as `0x${string}`} size={28} style={{ borderRadius: 4, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: hasUnread ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getPeerName(addr)}</div>
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
            <Identicon address={selectedAddress} size={30} style={{ borderRadius: 5, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getPeerName(selectedAddress)}</div>
              <div style={{ color: MUTED, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedAddress}</div>
            </div>
            <button className="fbtn" onClick={() => setSelectedAddress(null)} style={{ flexShrink: 0, marginLeft: 'auto' }}>✕</button>
          </div>

          {/* Messages */}
          <div style={{ background: SURF, border: `1px solid ${BORD}`, borderBottom: 'none', borderTop: 'none', flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            {thread.length === 0
              ? <div style={{ color: MUTED, fontSize: 11, paddingTop: 20, textAlign: 'center' }}>No messages yet. Say hello!</div>
              : thread.map((msg, i) => {
                  const isMine = msg.from === ownAddress
                  const failedConnect = parseFailedConnectNotice(msg.payload)
                  return <div key={i} style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                    <div style={{ background: isMine ? 'rgba(0,200,255,.12)' : BG3, border: `1px solid ${isMine ? 'rgba(0,200,255,.25)' : BORD}`, borderRadius: isMine ? '12px 12px 2px 12px' : '12px 12px 12px 2px', maxWidth: '70%', padding: '8px 12px' }}>
                      {failedConnect
                        ? <>
                            <div style={{ fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {getFailedConnectMessageText(failedConnect)}
                            </div>
                            {failedConnect.reason && <div style={{ color: MUTED, fontSize: 10, lineHeight: 1.4, marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>I got: {failedConnect.reason}</div>}
                          </>
                        : <div style={{ fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.payload}</div>}
                      <div style={{ color: MUTED, fontSize: 9, marginTop: 4, textAlign: 'right' }}>{fmtTime(msg.timestamp)}</div>
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
