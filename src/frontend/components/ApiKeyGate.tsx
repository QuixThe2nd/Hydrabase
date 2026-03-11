import { useState } from "react";

const inputStyle = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 6,
  color: "#e6edf3",
  fontFamily: "inherit",
  fontSize: 13,
  letterSpacing: ".05em",
  outline: "none",
  padding: "10px 14px",
  width: "100%",
}

export const ApiKeyGate = ({ onSubmit }: { onSubmit: (socket: string, key: string) => void }) => {
  const [socket, setSocket] = useState(() => localStorage.getItem("socket") ?? `ws${window.location.protocol === "https:" ? "s" : ""}://${window.location.host}`)
  const [key, setKey] = useState(() => localStorage.getItem("api_key") ?? "")
  const [shake, setShake] = useState(false)

  const submit = () => {
    if (!key.trim() || !socket.trim()) {
      setShake(true)
      setTimeout(() => setShake(false), 500)
      return
    }
    localStorage.setItem("socket", socket.trim())
    localStorage.setItem("api_key", key.trim())
    onSubmit(socket.trim(), key.trim())
  }

  return <div style={{ alignItems: "center", background: "#0d1117", display: "flex", fontFamily: "'JetBrains Mono','Courier New',monospace", justifyContent: "center", minHeight: "100vh" }}>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}
      @keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}
      @keyframes fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    `}</style>
    <div style={{ alignItems: "center", animation: "fadein .4s ease", display: "flex", flexDirection: "column", gap: 24, width: 340 }}>
      <div style={{ alignItems: "center", display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ color: "#7d8590", fontSize: 11, letterSpacing: ".3em", textTransform: "uppercase" }}>Node Dashboard</span>
        <span style={{ color: "#e6edf3", fontSize: 22, fontWeight: 700, letterSpacing: ".06em" }}>HYDRABASE</span>
      </div>
      <div style={{ animation: shake ? "shake .4s ease" : "none", display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
        <input autoFocus onChange={(e) => setSocket(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Enter Socket URL…" style={inputStyle} type="url" value={socket} />
        <input onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Enter API key…" style={inputStyle} type="password" value={key} />
        <button onClick={submit} style={{ background: "#238636", border: "1px solid #2ea043", borderRadius: 6, color: "#fff", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700, letterSpacing: ".08em", padding: "10px", width: "100%" }}>CONNECT →</button>
      </div>
      <span style={{ color: "#484f58", fontSize: 10 }}>{socket}</span>
    </div>
  </div>
}
