import { useState } from 'react'

import { ConnectionIdenticon } from './ConnectionIdenticon'

const fingerprint = (value: string): string => {
  const normalized = value.trim()
  if (!normalized) return 'NO KEY'
  if (normalized.length <= 8) return normalized.toUpperCase()
  return `${normalized.slice(0, 4).toUpperCase()}-${normalized.slice(-4).toUpperCase()}`
}

const inputStyle = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 6,
  color: '#e6edf3',
  fontFamily: 'inherit',
  fontSize: 13,
  letterSpacing: '.05em',
  outline: 'none',
  padding: '10px 14px',
  width: '100%',
}

export const ApiKeyGate = ({ onSubmit }: { onSubmit: (socket: string, key: string) => void }) => {
  const [socket, setSocket] = useState(() => localStorage.getItem('socket') ?? `ws${window.location.protocol === 'https:' ? 's' : ''}://${window.location.host}`)
  const [key, setKey] = useState(() => localStorage.getItem('api_key') ?? '')
  const [shake, setShake] = useState(false)

  const submit = () => {
    if (!key.trim() || !socket.trim()) {
      setShake(true)
      setTimeout(() => setShake(false), 500)
      return
    }
    localStorage.setItem('socket', socket.trim())
    localStorage.setItem('api_key', key.trim())
    onSubmit(socket.trim(), key.trim())
  }

  return <div style={{ alignItems: 'center', background: '#0d1117', display: 'flex', fontFamily: "'JetBrains Mono','Courier New',monospace", justifyContent: 'center', minHeight: '100vh' }}>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}
      @keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}
      @keyframes fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      @keyframes halo{0%,100%{box-shadow:0 0 0 rgba(0,200,255,0),0 0 28px rgba(0,200,255,.18)}50%{box-shadow:0 0 0 rgba(0,200,255,0),0 0 38px rgba(0,232,122,.14)}}
    `}</style>
    <div style={{ alignItems: 'center', animation: 'fadein .4s ease', display: 'flex', flexDirection: 'column', gap: 20, width: 360 }}>
      <div style={{ alignItems: 'center', background: 'linear-gradient(180deg, rgba(17,24,32,.92), rgba(11,16,24,.96))', border: '1px solid #1a2535', borderRadius: 18, display: 'flex', flexDirection: 'column', gap: 18, padding: '20px 20px 18px', width: '100%' }}>
        <div style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ color: '#7d8590', fontSize: 11, letterSpacing: '.3em', textTransform: 'uppercase' }}>Node Dashboard</span>
          <span style={{ color: '#e6edf3', fontSize: 22, fontWeight: 700, letterSpacing: '.06em' }}>HYDRABASE</span>
        </div>
        <div style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
          <div style={{ animation: 'halo 2.8s ease-in-out infinite', borderRadius: 18 }}>
            <ConnectionIdenticon apiKey={key} socket={socket} />
          </div>
          <div style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ color: '#00c8ff', fontSize: 10, fontWeight: 700, letterSpacing: '.26em', paddingLeft: '.26em', textTransform: 'uppercase' }}>API Signature</span>
            <span style={{ color: '#e6edf3', fontSize: 12, fontWeight: 600 }}>{fingerprint(key)}</span>
            <span style={{ color: '#4a6070', fontSize: 10, maxWidth: 280, overflow: 'hidden', textAlign: 'center', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{socket || 'Awaiting socket route'}</span>
          </div>
        </div>
      </div>
      <div style={{ animation: shake ? 'shake .4s ease' : 'none', display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
        <input autoFocus onChange={(e) => setSocket(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="Enter Socket URL…" style={inputStyle} type="url" value={socket} />
        <input onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="Enter API key…" style={inputStyle} type="password" value={key} />
        <button onClick={submit} style={{ background: '#238636', border: '1px solid #2ea043', borderRadius: 6, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, letterSpacing: '.08em', padding: '10px', width: '100%' }}>CONNECT →</button>
      </div>
      <span style={{ color: '#484f58', fontSize: 10 }}>{socket}</span>
    </div>
  </div>
}
