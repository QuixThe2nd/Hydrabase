export interface ApiPeer {
  address: `0x${string}`
  connection: Connection | undefined
}

export interface Config {
  apiKey: string | undefined
  bootstrapPeers: string
  dht: {
    bootstrapNodes: string
    reannounce: number
    requireConnection: boolean
    roomSeed: string
  }
  formulas: {
    finalConfidence: string
    pluginConfidence: string
  }
  node: {
    hostname: string
    ip: string
    listenAddress: string
    port: number
    preferTransport: 'TCP' | 'UDP'
    username: string
  }
  rpc: {
    prefix: string
  }
  soulIdCutoff: number
  upnp: {
    reannounce: number
    ttl: number
  }
}

export interface Connection {
  address: `0x${string}`
  confidence: number
  hostname: `${string}:${number}`
  latency: number
  lookupTime: number
  plugins: string[]
  totalDL: number
  totalUL: number
  uptime: number
  userAgent: string
  username: string
  votes: Votes
}

export interface Connection2 {
  address: `0x${string}`
  hostname: `${string}:${number}`
  userAgent: string
  username: string
}

export interface EventEntry {
  lv: string
  m: string
  t: string
}

export type FilterState = "all" | "connected" | "disconnected"

export interface NodeStats {
  dhtNodes: string[]
  peers: {
    known: ApiPeer[]
    plugins: string[]
    votes: Votes
  }
  self: {
    address: `0x${string}`
    hostname: string
    plugins: string[]
    votes: Votes
  }
  timestamp: string
}

export interface PeerStats {
  address: `0x${string}`
  peerPlugins: string[]
  sharedPlugins: string[]
  totalMatches: number
  totalMismatches: number
  votes: { albums: number; artists: number; tracks: number }
}

export type PeerWithCountry = ApiPeer & {
  activity: number[]
  country: string
};

export interface PluginAccuracy {
  match: number
  mismatch: number
  plugin_id: string
}

export interface Socket {
  readonly close: () => void
  readonly isOpened: boolean
  readonly onClose: (handler: () => void) => void
  readonly onMessage: (handler: (message: string) => void) => void
  readonly onOpen: (handler: () => void) => void
  readonly peer: Connection2
  readonly send: (message: string) => void
}

export interface Votes {
  albums: number
  artists: number
  tracks: number
}

export type WebSocketData = Connection2 & {
  conn?: WebSocketServerConnection
  isOpened: boolean
}

export type WsState = "closed" | "connecting" | "error" | "open"
