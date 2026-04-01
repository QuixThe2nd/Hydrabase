export interface ApiPeer {
  address: `0x${string}`
  auth?: PeerAuthInfo
  connection: Connection | undefined
  knownPlugins?: string[]
}

export interface Config {
  apiKey: string | undefined
  bootstrapPeers: string
  dht: {
    bootstrapNodes: string
    reannounce: number
    requireReady: boolean
    roomSeed: string
  }
  formulas: {
    finalConfidence: string
    pluginConfidence: string
  }
  node: {
    bio?: string
    connectMessage: string
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
  announcedHostnames: `${string}:${number}`[]
  bio?: string
  confidence: number
  connectionCount: number
  connections: `0x${string}`[]
  hostname: `${string}:${number}`
  latency: number
  lifetimeDL: number
  lifetimeUL: number
  lookupTime: number
  plugins: string[]
  totalDL: number
  totalUL: number
  type: 'CLIENT' | 'SERVER' | 'UDP'
  uptime: number
  userAgent: string
  username: string
  votes: Votes
}

export interface EventEntry {
  lv: string
  m: string
  stack?: string
  t: string
}

export type FilterState = 'all' | 'connected' | 'disconnected'

export interface LogEvent {
  lv: string
  m: string
  stack?: string
}

export interface NodeStats {
  dhtNodes: string[]
  peers: {
    known: ApiPeer[]
    plugins: string[]
    pluginVotes: VotesByPlugin
    votes: Votes
  }
  self: {
    address: `0x${string}`
    hostname: string
    nodeStartTime: number
    plugins: string[]
    pluginVotes: VotesByPlugin
    votes: Votes
  }
}

export interface PartialNodeStats {
  dhtNodes?: NodeStats['dhtNodes']
  peers?: Partial<NodeStats['peers']>
  self?: Partial<NodeStats['self']>
}

export interface PeerAuthInfo {
  bio?: string
  hostname: `${string}:${number}`
  userAgent: string
  username: string
}

export interface PeerConnectionAttempt {
  error?: PeerConnectionError
  hostname: `${string}:${number}`
  nonce: number
  startedAt: number
  state: 'failed' | 'pending'
  timedOut?: boolean
}

export interface PeerConnectionError {
  hostname: `${string}:${number}`
  message: string
  stack: string
  status: number
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

export interface RuntimeConfigSnapshot {
  editable: {
    nodeProfile: RuntimeNodeProfileConfig
  }
  readonly: RuntimeReadonlyConfig
}

export interface RuntimeConfigUpdate {
  nodeProfile: Partial<RuntimeNodeProfileConfig>
}

export interface RuntimeNodeProfileConfig {
  bio: string
  connectMessage: string
  username: string
}

export interface RuntimeReadonlyConfig {
  apiKeyConfigured: boolean
  node: {
    hostname: string
    ip: string
    listenAddress: string
    port: number
  }
}

export interface Socket {
  readonly close: () => void
  readonly identity: Identity
  readonly onClose: (handler: () => void) => void
  readonly onMessage: (handler: (message: string) => void) => void
  readonly send: (message: string) => void
}

export interface StatsPulseBundle {
  history: StatsPulsePayload[]
  latest: StatsPulsePayload
}

export interface StatsPulsePayload {
  intervalMs: number
  timestamp: string
  totalDL: number
  totalUL: number
}

export interface StatsVotesPayload {
  peers: Pick<NodeStats['peers'], 'plugins' | 'pluginVotes' | 'votes'>
  self: Pick<NodeStats['self'], 'pluginVotes' | 'votes'>
}

export interface Votes {
  albums: number
  artists: number
  tracks: number
}

export type VotesByPlugin = Record<string, Votes>

export type WsState = 'closed' | 'connecting' | 'error' | 'open'
