import { useState, useEffect, useRef, useCallback, type JSX } from "react";
import type { ApiPeer, NodeStats } from "../../src/StatsReporter"
import IpLookup from '@iplookup/country'
import { countryCodeEmoji } from 'country-code-emoji';

declare const VERSION: string;

const toEmoji = (country: string) => country === 'N/A' ? '🌐' : countryCodeEmoji(country)

const ipMap = new Map<string, string>()

const getCountry = async (ip: string): Promise<string> => {
  const knownCountry = ipMap.get(ip)
  if (knownCountry) return knownCountry
  const result = await IpLookup(ip)
  if (!result || !('country' in result) || !result['country']) return 'N/A'
  const country = result['country']
  ipMap.set(ip, country)
  return country
}

// Types
type WsState = "connecting" | "open" | "closed" | "error";

interface VoteCounts { tracks: number; artists: number; albums: number }

interface EventEntry { t: string; lv: string; m: string }

const fmt = (n: number | null | undefined, d = 1): string => n == null ? "—" : Number(n).toFixed(d);
const fmtBytes = (kb: number): string => kb > 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb} KB`;
const shortAddr = (a?: string | null): string => a ? `${a.slice(0, 10)}…${a.slice(-6)}` : "—";
const SC = { connected: "#3fb950", disconnected: "#f85149" } as const

const parseWsHost = (wsUrl: string): { hostname: string; port: number } => {
  const url = new URL(wsUrl)
  return { hostname: url.host, port: Number(url.port) }
};

const enrichPeers = (apiPeers: ApiPeer[] = [], knownPeers: `0x${string}`[] = []): Promise<(ApiPeer & { country: string })[]> => {
  const allAddrs = Array.from(new Set([...apiPeers.map<`0x${string}`>(p => p.address), ...knownPeers]));

  return Promise.all(allAddrs.map(async address => {
    const apiPeer = apiPeers.find(p => p.address === address);
    const { hostname, port } = apiPeer ? parseWsHost(apiPeer.hostname ?? "") : { hostname: "unknown", port: 4544 };
    return {
      address,
      hostname,
      port,
      status: apiPeer ? apiPeer.status : 'disconnected',
      confidence: apiPeer ? apiPeer.confidence : 0,
      latency: apiPeer ? apiPeer.latency : 0,
      uptime: apiPeer ? apiPeer.uptime : 0,
      rxTotal: apiPeer ? apiPeer.rxTotal : 0,
      txTotal: apiPeer ? apiPeer.txTotal : 0,
      plugins: apiPeer ? apiPeer.plugins : [],
      country: apiPeer ? await getCountry(hostname) : 'N/A'
    };
  }))
};

const SDot = ({ status }: { status: ApiPeer['status'] }) => <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: SC[status] ?? "#888", boxShadow: status === "connected" ? `0 0 6px ${SC.connected}` : "none", marginRight: 5, flexShrink: 0 }} />;

function WsStatus({ state }: { state: WsState }) {
  const map: Record<WsState | string, [string, string]> = { connecting: ["#d29922", "CONNECTING"], open: ["#3fb950", "LIVE"], closed: ["#f85149", "DISCONNECTED"], error: ["#f85149", "ERROR"] };
  const [color, label] = map[state] ?? ["#888", "UNKNOWN"];
  return <span style={{ display:"flex", alignItems:"center", gap:5, fontSize:10 }}>
    <span style={{ width:6, height:6, borderRadius:"50%", background:color, boxShadow:`0 0 6px ${color}`, display:"inline-block", animation: state==="connecting"?"blink 1s infinite":"none" }} />
    <span style={{ color }}>{label}</span>
  </span>
}

function Sparkline({ data, color = "#3fb950", width = 80, height = 26 }: { data?: number[]; color?: string; width?: number; height?: number }) {
  if (!data?.length) return <svg width={width} height={height} />;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - (v / max) * (height - 2) - 1}`).join(" ");
  const id = `sg${color.replace("#", "")}`;
  return <svg width={width} height={height} style={{ overflow:"visible" }}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.25"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
    <polygon points={`0,${height} ${pts} ${width},${height}`} fill={`url(#${id})`}/>
    <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
  </svg>
}

function AreaChart({ series, labels, height = 110 }: { series: { label: string; data: number[]; color: string }[]; labels?: string[]; height?: number }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tip, setTip] = useState<{ i: number; x: number } | null>(null);
  const W = 400, H = height, PAD = { t: 8, r: 8, b: 22, l: 36 };
  const iW = W - PAD.l - PAD.r, iH = H - PAD.t - PAD.b;
  const allV = series.flatMap(s => s.data);
  const maxV = Math.max(...allV, 1);
  const px = (i: number) => PAD.l + (i / ((series[0]?.data.length ?? 0) - 1)) * iW;
  const py = (v: number) => PAD.t + iH - ((v / maxV) * iH);
  const path = (d: number[]) => d.map((v, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(v)}`).join(" ");
  const area = (d: number[]) => `${path(d)} L${px(d.length - 1)},${PAD.t + iH} L${PAD.l},${PAD.t + iH} Z`;
  const yTks = Array.from({ length: 5 }, (_, i) => maxV * (i / 4));
  return <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ overflow:"visible", userSelect:"none" }}
    ref={svgRef}
    onMouseMove={e => {
      const r = svgRef.current?.getBoundingClientRect(); if (!r) return;
      const mx = (e.clientX-r.left)/r.width*W;
      const i = Math.round(((mx-PAD.l)/iW)*((series[0]?.data.length ?? 0) -1));
      if (i>=0&&i<(series[0]?.data.length ?? 0)) setTip({i,x:px(i)});
    }}
    onMouseLeave={() => setTip(null)}>
    <defs>{series.map(s => {const id=`ag${s.color.replace("#","")}`;return <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={s.color} stopOpacity="0.28"/><stop offset="100%" stopColor={s.color} stopOpacity="0.02"/></linearGradient>})}</defs>
    {yTks.map((v,i) => <g key={i}>
      <line x1={PAD.l} y1={py(v)} x2={PAD.l+iW} y2={py(v)} stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
      <text x={PAD.l-4} y={py(v)+3} textAnchor="end" fontSize="8.5" fill="rgba(255,255,255,0.28)" fontFamily="monospace">{v>999?`${(v/1024).toFixed(0)}k`:Math.round(v)}</text>
    </g>)}
    {labels && labels.filter((_,i)=>i%12===0).map((l,ii) => <text key={ii} x={px(ii*12)} y={H-4} textAnchor="middle" fontSize="8.5" fill="rgba(255,255,255,0.22)" fontFamily="monospace">{l}</text>)}
    {series.map(s => <path key={s.label+"a"} d={area(s.data)} fill={`url(#ag${s.color.replace("#","")})`}/>)}
    {series.map(s => <path key={s.label+"l"} d={path(s.data)} fill="none" stroke={s.color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/>)}
    {tip && <>
      <line x1={tip.x} y1={PAD.t} x2={tip.x} y2={PAD.t+iH} stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="3,3"/>
      {series.map(s => <circle key={s.label} cx={tip.x} cy={py(s.data[tip.i] ?? 0)} r="3" fill={s.color} stroke="#161b22" strokeWidth="1.5"/>)}
      <g transform={`translate(${Math.min(tip.x+8,W-80)},${PAD.t+4})`}>
        <rect width="75" height={series.length*14+12} rx="3" fill="#0d1117" stroke="rgba(255,255,255,0.18)" strokeWidth="1"/>
        {series.map((s,si) => <text key={s.label} x="6" y={16+si*14} fontSize="9" fill={s.color} fontFamily="monospace">{s.label}: {Math.round(s.data[tip.i] ?? 0)}</text>)}
      </g>
    </>}
  </svg>
}

function ApiKeyGate({ onSubmit }: { onSubmit: (socket: string, key: string) => void }) {
  const [socket, setSocket] = useState(() => localStorage.getItem("socket") ?? `ws${window.location.protocol === 'https:' ? 's' : ''}://${window.location.host}`)
  const [key, setKey] = useState(() => localStorage.getItem("api_key") ?? "")
  const [shake, setShake] = useState(false)

  const submit = () => {
    if (!key.trim() || !socket.trim()) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      return;
    }
    localStorage.setItem("socket", socket.trim());
    localStorage.setItem("api_key", key.trim());
    onSubmit(socket.trim(), key.trim());
  }

  return <div style={{ minHeight: "100vh", background: "#0d1117", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'JetBrains Mono','Courier New',monospace" }}>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}
      @keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}
      @keyframes fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    `}</style>
    <div style={{ animation: "fadein .4s ease", display: "flex", flexDirection: "column", alignItems: "center", gap: 24, width: 340 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, letterSpacing: ".3em", color: "#7d8590", textTransform: "uppercase" }}>Node Dashboard</span>
        <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: ".06em", color: "#e6edf3" }}>HYDRABASE</span>
      </div>
      <div style={{ animation: shake ? "shake .4s ease" : "none", width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
        <input autoFocus type="url" placeholder="Enter Socket URL…" value={socket} onChange={e => setSocket(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} style={{ width: "100%", background: "#161b22", border: "1px solid #30363d", borderRadius: 6, color: "#e6edf3", fontFamily: "inherit", fontSize: 13, padding: "10px 14px", outline: "none", letterSpacing: ".05em" }} />
        <input autoFocus type="password" placeholder="Enter API key…" value={key} onChange={e => setKey(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} style={{ width: "100%", background: "#161b22", border: "1px solid #30363d", borderRadius: 6, color: "#e6edf3", fontFamily: "inherit", fontSize: 13, padding: "10px 14px", outline: "none", letterSpacing: ".05em" }} />
        <button onClick={submit} style={{ width: "100%", background: "#238636", border: "1px solid #2ea043", borderRadius: 6, color: "#fff", fontFamily: "inherit", fontSize: 12, fontWeight: 700, letterSpacing: ".08em", padding: "10px", cursor: "pointer" }}>CONNECT →</button>
      </div>
      <span style={{ fontSize: 10, color: "#484f58" }}>{socket}</span>
    </div>
  </div>
}

function Dashboard({ socket, apiKey }: { socket: string, apiKey: string }) {
  const [wsState, setWsState] = useState<WsState>("connecting");
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const [peers, setPeers] = useState<(ApiPeer & { country: string })[]>([]);
  const [selfAddr, setSelfAddr] = useState<string>("—");
  const [votes, setVotes] = useState<VoteCounts>({ tracks: 0, artists: 0, albums: 0 });
  const [peerData, setPeerData] = useState<VoteCounts>({ tracks: 0, artists: 0, albums: 0 });
  const [dhtNodes, setDhtNodes] = useState<{ host: string; country: string }[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<string[]>([]);
  const [knownPlugins, setKnownPlugins] = useState<string[]>([]);
  const [eventLog, setEventLog] = useState<EventEntry[]>([]);
  const [dhtNodeCounts, setDhtNodeCounts] = useState<number[]>([])
  const [tab, setTab] = useState<"overview" | "peers" | "dht" | "votes" | "logs">("overview");
  const [sel, setSel] = useState<ApiPeer | null>(null);
  const [sortK, setSortK] = useState<keyof ApiPeer>("status");
  const [sortD, setSortD] = useState<number>(1);
  const [filter, setFilter] = useState<"all" | "connected" | "disconnected" | "connecting">("all");
  const [uptime, setUptime] = useState<number>(0);
  const wsRef = useRef<WebSocket | undefined>(undefined)
  const addLog = useCallback((lv: string, m: string) => { setEventLog(prev => [...prev.slice(-199), { t: new Date().toISOString().slice(11,19), lv, m }]) }, []);

  const applyStats = useCallback((stats: NodeStats) => {
    setLastPoll(new Date());
    setSelfAddr(stats.address);
    setVotes(stats.votes);
    setPeerData(stats.peerData);
    Promise.all(stats.dhtNodes.map(async host => ({ host, country: await getCountry(host.split(':')[0]!)}))).then(nodes => setDhtNodes(nodes))
    setInstalledPlugins(stats.installedPlugins);
    setKnownPlugins(stats.knownPlugins);
    setDhtNodeCounts(prev => [...prev, stats.dhtNodes?.length ?? 0])

    enrichPeers(stats.peers ?? [], stats.knownPeers).then(peers => setPeers(peers));

    addLog("INFO", `Stats received — ${stats.connectedPeers} connected, ${(stats.dhtNodes??[]).length} DHT nodes`);
  }, [addLog]);

  useEffect(() => {
    let destroyed = false;

    const connect = () => {
      if (destroyed) return;
      addLog("INFO", `Connecting to ${socket}…`);
      setWsState("connecting");

      const ws = new WebSocket(socket, [`x-api-key-${apiKey}`]);
      wsRef.current = ws;

      ws.onopen = () => {
        if (destroyed) { ws.close(); return; }
        setWsState("open");
        addLog("INFO", "WebSocket connected");
      };

      ws.onmessage = (e: MessageEvent) => {
        if (destroyed) return;
        try {
          const data = JSON.parse(e.data) as { stats: NodeStats }
          const stats = data.stats ?? data;
          if (stats.address) applyStats(stats)
          else addLog("DEBUG", `WS msg: ${e.data.slice(0,80)}`)
        } catch {
          addLog("WARN", `Unparseable message: ${e.data.slice(0,60)}`);
        }
      };

      ws.onerror = () => {
        if (destroyed) return;
        setWsState("error");
        addLog("ERROR", "WebSocket error");
      };

      ws.onclose = (ev: CloseEvent) => {
        if (destroyed) return;
        setWsState("closed");
        addLog("WARN", `WebSocket closed (${ev.code}). Reconnecting in 5s…`);
        setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      destroyed = true;
      wsRef.current?.close();
    };
  }, [applyStats, addLog]);

  useEffect(() => {
    const id = setInterval(() => {setUptime(u => u+1)}, 1000);
    return () => clearInterval(id);
  }, []);

  const tLabels = Array.from({length:60},(_,i)=>`${60-i}s`).toReversed();
  const connCount = peers.filter(p=>p.status==="connected").length;
  const avgLat = peers.length ? peers.reduce((a,p)=>a+p.latency, 0) / peers.filter(peer => peer.latency).length : 0;
  const totalRx = peers.reduce((a,p)=>a+p.rxTotal, 0)
  const totalTx = peers.reduce((a,p)=>a+p.txTotal, 0)

  const sorted = [...peers]
    .filter(p => filter==="all" || p.status===filter)
    .sort((a,b) => {
      const av = a[sortK];
      const bv = b[sortK];
      const avn = av as unknown as string | number | undefined;
      const bvn = bv as unknown as string | number | undefined;
      if (typeof avn === 'string' || typeof bvn === 'string') {
        const s1 = String(avn ?? "");
        const s2 = String(bvn ?? "");
        return s1.localeCompare(s2) * sortD;
      }
      const n1 = (avn as number) ?? -Infinity;
      const n2 = (bvn as number) ?? -Infinity;
      return (n1 - n2) * sortD;
    });

  const toggleSort = (k: keyof ApiPeer) => { if (sortK===k) setSortD(d=>-d); else { setSortK(k); setSortD(-1); } };
  const SI = ({k}:{k: keyof ApiPeer}) : JSX.Element => sortK!==k ? <span style={{opacity:.2}}>⇅</span> : sortD===1 ? <span style={{color:ACCENT}}>↑</span> : <span style={{color:ACCENT}}>↓</span>;

  const PEER_HEADER: [keyof ApiPeer, string][] = [["status","Status"], ["address","Address"], ["hostname","Host"], ["latency","Latency"], ["rxTotal","↓ RX"], ["txTotal","↑ TX"], ["confidence","Conf"]]

  const BG="#0d1117", SURF="#161b22", BORD="#30363d", TEXT="#e6edf3", MUTED="#7d8590", ACCENT="#58a6ff";
  const P  = (s={}) => ({ background:SURF, border:`1px solid ${BORD}`, borderRadius:8, overflow:"hidden", ...s });
  interface PanelHeaderProps {
    label: string;
    right?: string;
  }

  const PH = ({ label, right }: PanelHeaderProps) => <div style={{ padding:"8px 14px", borderBottom:`1px solid ${BORD}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
    <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:MUTED }}>{label}</span>
    {right && <span style={{ fontSize:10, color:MUTED }}>{right}</span>}
  </div>
  const SC2 = (l:string,v:string|number,sub:string,color=TEXT,spark=null) => <div style={P()}>
    <div style={{ padding:"12px 14px" }}>
      <div style={{ fontSize:9, color:MUTED, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:5 }}>{l}</div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
        <div>
          <div style={{ fontSize:22, fontWeight:700, color, fontFamily:"monospace", lineHeight:1 }}>{v}</div>
          {sub && <div style={{ fontSize:9, color:MUTED, marginTop:3 }}>{sub}</div>}
        </div>
        {spark && <Sparkline data={spark} color={color} />}
      </div>
    </div>
  </div>
  const latColor  = (ms: number) => ms<50?"#3fb950":ms<120?"#d29922":"#f85149"
  const confColor = (c: number)  => c>.8?"#3fb950":c>.5?"#d29922":"#f85149"

  return <div style={{ minHeight:"100vh", background:BG, color:TEXT, fontFamily:"'JetBrains Mono','Courier New',monospace", fontSize:13 }}>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}
      ::-webkit-scrollbar{width:5px;height:5px;}
      ::-webkit-scrollbar-track{background:#0d1117;}
      ::-webkit-scrollbar-thumb{background:#30363d;border-radius:3px;}
      .tab{background:none;border:none;cursor:pointer;font-family:inherit;font-size:11.5px;padding:9px 14px;border-bottom:2px solid transparent;color:#7d8590;transition:all .15s;letter-spacing:.03em;}
      .tab:hover{color:#e6edf3;}
      .tab.on{color:#e6edf3;border-bottom-color:#58a6ff;}
      .rh:hover{background:rgba(88,166,255,.04)!important;}
      .fbtn{background:none;border:1px solid #30363d;border-radius:4px;color:#7d8590;font-family:inherit;font-size:10px;padding:3px 9px;cursor:pointer;transition:all .15s;}
      .fbtn:hover,.fbtn.on{background:rgba(88,166,255,.1);border-color:#58a6ff55;color:#58a6ff;}
      @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
      @keyframes fadein{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
      @keyframes spin{to{transform:rotate(360deg)}}
    `}</style>

    {/* ── Nav */}
    <div style={{ background:"#010409", borderBottom:`1px solid ${BORD}`, padding:"0 16px", display:"flex", alignItems:"center", justifyContent:"space-between", height:46, position:"sticky", top:0, zIndex:100 }}>
      <div style={{ display:"flex", alignItems:"center", gap:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginRight:20 }}>
          <WsStatus state={wsState} />
          <span style={{ fontWeight:700, fontSize:13, letterSpacing:".06em" }}>HYDRABASE</span>
          <span style={{ fontSize:9, color:MUTED, background:"#21262d", border:`1px solid ${BORD}`, borderRadius:3, padding:"1px 5px", letterSpacing:".05em" }}>NODE v{VERSION}</span>
        </div>
        {(["overview","peers","dht","votes","logs"] as const).map(t => (
          <button key={t} className={`tab${tab===t?" on":""}`} onClick={()=>setTab(t)}>{t.toUpperCase()}</button>
        ))}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:18, fontSize:11 }}>
        {lastPoll && <span style={{ color:MUTED }}>last poll {lastPoll.toISOString().slice(11,19)}</span>}
        <span style={{ color:MUTED }}>⏱ {`${String(Math.floor(uptime/3600)).padStart(2,"0")}:${String(Math.floor(uptime/60)%60).padStart(2,"0")}:${String(uptime%60).padStart(2,"0")}`}</span>
        <span style={{ color:"#3fb950" }}>↓ {fmtBytes(totalRx)}</span>
        <span style={{ color:"#f0883e" }}>↑ {fmtBytes(totalTx)}</span>
        <span style={{ color:MUTED, fontSize:10 }}>{shortAddr(selfAddr)}</span>
      </div>
    </div>

    <div style={{ padding:"14px 16px", animation:"fadein .3s ease" }}>

      {/* ══ OVERVIEW ══════════════════════════════════════════════════════ */}
      {tab==="overview" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:10 }}>
            {SC2("Connected Peers", connCount, `${peers.length} known`, "#3fb950")}
            {SC2("↓ RX", fmtBytes(totalRx), `total ${fmtBytes(totalRx)}`, ACCENT)}
            {SC2("↑ TX", fmtBytes(totalTx), `total ${fmtBytes(totalTx)}`, "#f0883e")}
            {SC2("Avg Latency", avgLat ? `${fmt(avgLat,0)}ms` : 'N/A', `${connCount} peers measured`, "#d29922")}
            {SC2("DHT Nodes", dhtNodes.length.toString(), "routing table entries", "#a5d6ff")}
            {SC2("Your Votes", `${votes.tracks+votes.artists+votes.albums}`, `${votes.tracks} tracks / ${votes.artists} artists / ${votes.albums} albums`, "#bc8cff")}
          </div>

          <div style={P()}>
            <PH label="Peers" right={`${connCount}/${peers.length}`} />
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ background:"#0d1117", fontSize:10, color:MUTED, textTransform:"uppercase" }}>
                    {PEER_HEADER.map(([k,l]) => <th key={String(k)} onClick={()=>toggleSort(k)} style={{ padding:"7px 12px", textAlign:"left", fontWeight:700, letterSpacing:".07em", cursor:"pointer", whiteSpace:"nowrap" }}>
                      {l} <SI k={k}/>
                    </th>)}
                  </tr>
                </thead>
                <tbody>
                  {peers.map(p => <tr key={p.address} className="rh" onClick={()=>setSel(s=>s?.address===p.address?null:p)}
                    style={{ borderTop:`1px solid ${BORD}`, cursor:"pointer", background:sel?.address===p.address?"rgba(88,166,255,.05)":"transparent" }}>
                    <td style={{ padding:"8px 12px", whiteSpace:"nowrap" }}><SDot status={p.status}/><span style={{ fontSize:10, color:SC[p.status] }}>{p.status}</span></td>
                    <td style={{ padding:"8px 12px", fontSize:10, color:MUTED }}>{shortAddr(p.address)}</td>
                    <td style={{ padding:"8px 12px", fontSize:11, color:MUTED }}>{toEmoji(p.country)} {p.hostname}</td>
                    <td style={{ padding:"8px 12px", color:p.latency?latColor(p.latency):MUTED }}>{p.latency?`${Math.round(p.latency*10)/10}ms`:"—"}</td>
                    <td style={{ padding:"8px 12px", color:ACCENT }}>{fmtBytes(p.rxTotal)}</td>
                    <td style={{ padding:"8px 12px", color:"#f0883e" }}>{fmtBytes(p.txTotal)}</td>
                    <td style={{ padding:"8px 12px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <div style={{ width:40, height:3, background:"#21262d", borderRadius:2, overflow:"hidden" }}>
                          <div style={{ width:`${p.confidence*100}%`, height:"100%", background:confColor(p.confidence), borderRadius:2 }}/>
                        </div>
                        <span style={{ fontSize:10, color:MUTED }}>{(p.confidence*100).toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══ PEERS ═════════════════════════════════════════════════════════ */}
      {tab==="peers" && <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <span style={{ fontSize:11, color:MUTED }}>Filter:</span>
          {(["all","connected","disconnected"] as const).map(s => <button key={s} className={`fbtn${filter===s?" on":""}`} onClick={()=>setFilter(s)}>{s}</button>)}
          <span style={{ marginLeft:"auto", fontSize:11, color:MUTED }}>{sorted.length} peers</span>
        </div>
        {sorted.map(p => <div key={p.address} style={{ ...P(), cursor:"pointer", borderColor:sel?.address===p.address?"#58a6ff55":BORD, transition:"border-color .15s" }}
          onClick={()=>setSel(s=>s?.address===p.address?null:p)}>
          <div style={{ padding:"12px 16px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:8, marginBottom:12 }}>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                  <SDot status={p.status}/>
                  <span style={{ fontSize:12, fontWeight:700 }}>{p.address}</span>
                  <span style={{ fontSize:12 }}>{toEmoji(p.country)}</span>
                </div>
                <div style={{ fontSize:11, color:MUTED, marginLeft:12 }}>ws://{p.hostname}</div>
              </div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {p.plugins.map(pl => <span key={pl} style={{ fontSize:10, padding:"2px 8px", borderRadius:4, background:"#21262d", border:`1px solid ${BORD}`, color:ACCENT }}>{pl}</span>)}
                {p.plugins.length===0 && <span style={{ fontSize:10, color:MUTED }}>no plugins</span>}
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(100px,1fr))", gap:8, marginBottom:10 }}>
              {[
                ["Latency",  p.latency?`${Math.round(p.latency*10)/10}ms`:"—", p.latency?latColor(p.latency):MUTED],
                ["↓ RX",fmtBytes(p.rxTotal), ACCENT],
                ["↑ TX",fmtBytes(p.txTotal), "#f0883e"],
                ["Uptime", `${`${String(Math.floor(p.uptime/3600_000)).padStart(2,"0")}:${String(Math.floor(p.uptime/60_000)%60).padStart(2,"0")}:${String(Math.floor(p.uptime/1_000)%60).padStart(2,"0")}`}`, p.uptime/1_000>90?"#3fb950":p.uptime/1_000>60?"#d29922":"#f85149"],
              ].map(([l,v,c]) => <div key={l} style={{ background:"#0d1117", borderRadius:6, padding:"8px 10px" }}>
                <div style={{ fontSize:9, color:MUTED, textTransform:"uppercase", letterSpacing:".1em", marginBottom:4 }}>{l}</div>
                <div style={{ fontSize:15, fontWeight:700, color:c }}>{v}</div>
              </div>)}
            </div>
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                <span style={{ fontSize:9, color:MUTED, textTransform:"uppercase", letterSpacing:".1em" }}>Historic Confidence</span>
                <span style={{ fontSize:10, fontWeight:700, color:confColor(p.confidence) }}>{(p.confidence*100).toFixed(1)}%</span>
              </div>
              <div style={{ height:4, background:"#21262d", borderRadius:2, overflow:"hidden" }}>
                <div style={{ width:`${p.confidence*100}%`, height:"100%", background:confColor(p.confidence), borderRadius:2, transition:"width .3s" }}/>
              </div>
            </div>
          </div>
        </div>)}
      </div>}

      {/* ══ DHT ═══════════════════════════════════════════════════════════ */}
      {tab==="dht" && <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:10 }}>
          {SC2("Total Nodes", dhtNodes.length.toString(), "in routing table", ACCENT)}
          {SC2("Last Refresh", lastPoll ? `${Math.round((Date.now()-+lastPoll)/1000)}s ago` : "—", "last WS poll", "#3fb950")}
          {SC2("WS Status", wsState.toUpperCase(), socket.replace("wss://",""), wsState==="open"?"#3fb950":"#f85149")}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div style={P()}>
            <PH label="DHT Node Count" right="60s simulated" />
            <div style={{ padding:"10px 14px 8px" }}>
              <AreaChart series={[{label:"Nodes",data:dhtNodeCounts,color:"#a5d6ff"}]} labels={tLabels} height={160}/>
            </div>
          </div>
          <div style={P()}>
            <PH label="Geographic Distribution" right="connections" />
            <div style={{ padding:"12px 14px" }}>
                {Object.entries(dhtNodes
                  .reduce<Record<string, number>>((acc, {country}) => {
                    acc[country] = (acc[country] ?? 0) + 1;
                    return acc;
                  }, {}))
                  .sort(([, a], [, b]) => b - a).slice(0, 5).map(([country,count]) => (
                <div key={country} style={{ marginBottom:10 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                    <span style={{ fontSize:11, color:MUTED }}>{`${toEmoji(country)} ${country}`}</span>
                    <span style={{ fontSize:11, fontWeight:600 }}>{Math.round(1000*count/dhtNodes.length)/10}%</span>
                  </div>
                  <div style={{ height:4, background:"#21262d", borderRadius:2, overflow:"hidden" }}>
                    <div style={{ width:`${100*count/dhtNodes.length}%`, height:"100%", background:ACCENT, opacity:.65, borderRadius:2 }}/>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={P()}>
          <PH label="Routing Table" right={`${dhtNodes.length} nodes`} />
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ background:"#0d1117", fontSize:10, color:MUTED, textTransform:"uppercase" }}>
                  {["#","Country","IP Address","Port","Status"].map(h => <th key={h} style={{ padding:"7px 12px", textAlign:"left", fontWeight:700, letterSpacing:".07em" }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {dhtNodes.map((node,i) => {
                  const [ip, port] = node.host.split(':') as [string, string]
                  return <tr key={i} className="rh" style={{ borderTop:`1px solid ${BORD}` }}>
                    <td style={{ padding:"7px 12px", color:MUTED, fontSize:10 }}>{i+1}</td>
                    <td style={{ padding:"7px 12px", fontFamily:"monospace", fontSize:11 }}>{toEmoji(node.country)}</td>
                    <td style={{ padding:"7px 12px", fontFamily:"monospace", fontSize:11 }}>{ip}</td>
                    <td style={{ padding:"7px 12px", color:MUTED }}>{port}</td>
                    <td style={{ padding:"7px 12px" }}><SDot status="connected"/><span style={{ fontSize:10, color:"#3fb950" }}>reachable</span></td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>}

      {/* ══ VOTES ═════════════════════════════════════════════════════════ */}
      {tab==="votes" && <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:10 }}>
          {([["Tracks",  votes.tracks,  peerData.tracks,  "#bc8cff"],
            ["Artists", votes.artists, peerData.artists, "#ff9bce"],
            ["Albums",  votes.albums,  peerData.albums,  "#56d364"]
          ] as const).map(([l,local,votes,color]) => <div key={l} style={P()}>
            <div style={{ padding:"12px 14px" }}>
              <div style={{ fontSize:9, color:MUTED, textTransform:"uppercase", letterSpacing:".12em", marginBottom:6 }}>{l}</div>
              <div style={{ display:"flex", alignItems:"flex-end", gap:4, marginBottom:10 }}>
                <span style={{ fontSize:28, fontWeight:700, color, lineHeight:1 }}>{local}</span>
                <span style={{ fontSize:13, color:MUTED, marginBottom:2 }}>/ {votes}</span>
                <span style={{ fontSize:11, color:MUTED, marginLeft:"auto", marginBottom:2 }}>{votes>0?((local/votes)*100).toFixed(0):0}%</span>
              </div>
              <div style={{ height:5, background:"#21262d", borderRadius:3, overflow:"hidden" }}>
                <div style={{ width:`${votes>0?(local/votes)*100:0}%`, height:"100%", background:color, borderRadius:3 }}/>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:4, fontSize:9, color:MUTED }}>
                <span>your votes</span><span>peer votes</span>
              </div>
            </div>
          </div>)}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div style={P()}>
            <PH label="Plugins" />
            <div style={{ padding:"10px 0" }}>
              {knownPlugins.map(pl => {
                const on = installedPlugins.includes(pl);
                return <div key={pl} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 16px", borderBottom:`1px solid ${BORD}` }}>
                  <div>
                    <div style={{ fontWeight:700, marginBottom:2 }}>{pl}</div>
                    <div style={{ fontSize:10, color:MUTED }}>{on?"Installed":"Not installed"}</div>
                  </div>
                  <span style={{ fontSize:10, padding:"3px 10px", borderRadius:4, background:on?"rgba(63,185,80,.1)":"rgba(248,81,73,.1)", border:`1px solid ${on?"#3fb95044":"#f8514944"}`, color:on?"#3fb950":"#f85149" }}>{on?"ACTIVE":"INACTIVE"}</span>
                </div>
              })}
            </div>
          </div>
          <div style={P()}>
            <PH label="Plugin Coverage Across Peers" />
            <div style={{ padding:"12px 16px" }}>
              {knownPlugins.map(pl => {
                const n = peers.filter(p=>p.plugins.includes(pl)).length;
                return <div key={pl} style={{ marginBottom:14 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                    <span style={{ fontSize:12 }}>{pl}</span>
                    <span style={{ fontSize:11, color:MUTED }}>{n}/{peers.length} peers</span>
                  </div>
                  <div style={{ height:5, background:"#21262d", borderRadius:3, overflow:"hidden" }}>
                    <div style={{ width:`${peers.length>0?(n/peers.length)*100:0}%`, height:"100%", background:ACCENT, borderRadius:3 }}/>
                  </div>
                </div>
              })}
            </div>
          </div>
        </div>
      </div>}

      {/* ══ LOGS ══════════════════════════════════════════════════════════ */}
      {tab==="logs" && <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <span style={{ fontSize:11, color:MUTED }}>WebSocket:</span>
          <WsStatus state={wsState}/>
          <span style={{ fontSize:10, color:MUTED, marginLeft:4 }}>{socket}</span>
          {lastPoll && <span style={{ fontSize:10, color:MUTED, marginLeft:"auto" }}>last poll: {lastPoll.toISOString().slice(11,19)}</span>}
        </div>
        <div style={P()}>
          <PH label="Event Log" right={`${eventLog.length} entries`} />
          <div style={{ padding:"4px 0", maxHeight:560, overflowY:"auto" }}>
            {eventLog.map((e,i) => <div key={i} className="rh" style={{ display:"flex", gap:12, padding:"3px 14px", alignItems:"baseline", fontFamily:"monospace", fontSize:11 }}>
              <span style={{ color:MUTED, minWidth:60, flexShrink:0 }}>{e.t}</span>
              <span style={{ minWidth:42, flexShrink:0, fontSize:9, fontWeight:700, letterSpacing:".06em", color:e.lv==="ERROR"?"#f85149":e.lv==="WARN"?"#d29922":e.lv==="DEBUG"?"#484f58":ACCENT }}>{e.lv}</span>
              <span style={{ color:e.lv==="ERROR"?"#ffa198":e.lv==="WARN"?"#e3b341":TEXT }}>{e.m}</span>
            </div>)}
            {eventLog.length===0 && <div style={{ padding:"16px 14px", color:MUTED, fontSize:11 }}>Waiting for events…</div>}
          </div>
        </div>
      </div>}
    </div>
  </div>
}

export default function App() {
  const [socket, setSocket] = useState<string | null>(() => localStorage.getItem("socket"));
  const [key, setKey] = useState<string | null>(() => localStorage.getItem("api_key"));
  if (!socket || !key) return <ApiKeyGate onSubmit={(socket, key) => {
    setSocket(socket)
    setKey(key)
  }} />;
  return <Dashboard socket={socket} apiKey={key} />;
}
