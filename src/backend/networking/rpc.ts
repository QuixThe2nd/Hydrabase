import krpc from 'k-rpc'

import type { Config, Socket } from '../../types/hydrabase'
import type PeerManager from '../PeerManager'

import { debug, error, log, warn } from '../../utils/log'
import { FSMap } from '../FSMap'
import { AuthSchema, type Identity, proveClient, proveServer, verifyClient, verifyServer } from '../protocol/HIP1/handshake'
import { DHT_Node } from './dht'

export const authenticatedPeers = new FSMap<`${string}:${number}`, Identity>('./data/authenticated-peers.json')
const connections = new Map<`${string}:${number}`, RPC>()

export class RPC implements Socket {
  public isOpened = true
  public readonly messageHandlers: ((message: string) => void)[] = []
  public readonly peer
  private closeHandlers: (() => void)[] = []
  private readonly node: { host: string, port: number }
  private openHandler?: () => void
  private constructor(private readonly peers: PeerManager, private readonly identity: { address: `0x${string}`, hostname: `${string}:${number}`, userAgent: string, username: string }, private readonly dhtConfig: Config['dht']) {
    authenticatedPeers.set(`${identity.hostname}`, identity)
    connections.set(identity.hostname, this)
    log(`[RPC] Connecting to peer ${identity.hostname}`)
    const [host, port] = identity.hostname.split(':') as [string, `${number}`]
    this.node = { host, port: Number(port) }
    this.peer = { ...identity, hostname: identity.hostname }
    setTimeout(() => this.openHandler?.(), 0)
  }
  static readonly fromInbound = (peers: PeerManager, identity: Identity, dhtConfig: Config['dht']): RPC => new RPC(peers, identity, dhtConfig)
  static readonly fromOutbound = async (identity: Identity, peers: PeerManager, config: Config['dht'], node: Config['node']): Promise<false | RPC> => {
    const response = await new Promise<krpc.KRPCResponse | undefined>(resolve => {
      const [host, port] = identity.hostname.split(':') as [string, `${number}`]
      peers.rpc.query({ host, port: Number(port) }, { a: proveClient(peers.account, node, identity.hostname), q: `${config.rpcPrefix}_auth` }, (err, res) => {
        if (err) warn('DEVWARN:', `[RPC] Failed to send auth to ${identity.hostname} - ${err.message}`)
        resolve(res)
      })
    })
    if (!response) return warn('DEVWARN:', `[RPC] Auth handshake failed with ${identity.hostname}`)
    const err = response.r?.['e']?.[1].toString()
    if (err) return warn('DEVWARN:', `[RPC] Failed to authenticate from outbound - ${err}`)

    return new RPC(peers, identity, config)
  }
  public readonly close = () => {
    this.isOpened = false
    connections.delete(`${this.node.host}:${this.node.port}`)
    this.closeHandlers.map(handler => handler())
  }
  public readonly onClose = (handler: () => void) => {
    this.closeHandlers.push(() => handler())
  }
  public onMessage(handler: (message: string) => void) {
    this.messageHandlers.push(handler)
  }
  public onOpen(handler: () => void) {
    this.openHandler = () => handler()
  }
  public readonly send = (message: string) => this.peers.rpc.query(this.node, { a: { d: message }, q: `${this.dhtConfig.rpcPrefix}_msg` }, err => {
    if (err) {
      error('ERROR:', `[RPC] Message failed to send ${err.message}`)
      return
    }
    debug(`[RPC] Peer acknowledged message ${this.identity.hostname}`)
    if (!this.isOpened) {
      this.isOpened = true
      this.openHandler?.()
    }
  })
}

const queryAuth = (rpc: krpc.KRPC, dhtConfig: Config['dht'], hostname: `${string}:${number}`, clientIdentity?: object): Promise<[number, string] | Identity> => {
  const [host, port] = hostname.split(':') as [string, `${number}`]
  const query = clientIdentity ? 
    { q: `${dhtConfig.rpcPrefix}_auth`, ...clientIdentity } : 
    { q: `${dhtConfig.rpcPrefix}_auth` }
  
  return new Promise(resolve => {
    rpc.query({ host, port: Number(port) }, query, (err, res) => {
      if (err) {
        warn('WARN:', `[RPC] UDP auth failed for ${hostname} - ${err.message}`)
        resolve([500, 'Failed to authenticate server via UDP'])
        return
      }
      const auth = AuthSchema.safeParse({
        address: res?.r?.['address']?.toString(),
        hostname: res?.r?.['hostname']?.toString(),
        signature: res?.r?.['signature']?.toString(),
        userAgent: res?.r?.['userAgent']?.toString(),
        username: res?.r?.['username']?.toString(),
      }).data
      if (!auth) {
        resolve([500, 'Failed to parse UDP server authentication'])
        return
      }
      const result = verifyServer(auth, hostname)
      if (result === true) {
        authenticatedPeers.set(hostname, auth)
        log(`[RPC] Authenticated server ${hostname} via UDP`)
        resolve(auth)
      } else if (auth.hostname === hostname) {
        resolve(result)
      } else {
        debug(`[RPC] Upgrading hostname from ${hostname} to ${auth.hostname}`)
        queryAuth(rpc, dhtConfig, auth.hostname, clientIdentity).then(resolve)
      }
    })
  })
}



export const authenticateServerUDP = (rpc: krpc.KRPC, dhtConfig: Config['dht']) =>
  (hostname: `${string}:${number}`): Promise<[number, string] | Identity> => {
    const cache = authenticatedPeers.get(hostname)
    if (cache) return Promise.resolve(cache)
    return queryAuth(rpc, dhtConfig, hostname)
  }

const handlers = {
  auth: async (peers: PeerManager, query: krpc.KRPCQuery, peer: { host: string, port: number }, node: Config['node'], apiKey: false | string, dhtConfig: Config['dht']) => {
    const hasClientIdentity = query.a?.['address'] || query.a?.['signature'] || query.a?.['username']
    
    if (!hasClientIdentity) {
      debug(`[RPC] Received identity request from ${peer.host}:${peer.port}`)
      peers.rpc.response(peer, query, { ...proveServer(peers.account, node), ok: 1 })
      return
    }
    
    log(`[RPC] Received mutual auth from ${peer.host}:${peer.port}`)
    const identity = await verifyClient(node, { address: query.a?.['address']?.toString() as `0x${string}`, hostname: `${peer.host}:${peer.port}`, signature: query.a?.['signature']?.toString() ?? '', userAgent: query.a?.['userAgent']?.toString() ?? '', username: query.a?.['username']?.toString() ?? '' }, apiKey, authenticateServerUDP(peers.rpc, dhtConfig))
    if (Array.isArray(identity)) {
      warn('DEVWARN:', `[RPC] Authentication failed ${peer.host}:${peer.port} - ${identity[1]}`)
      peers.rpc.response(peer, query, { e: [500, 'Failed to verify client'], ok: 0 })
      return
    }
    log(`[RPC] Authenticated peer ${identity.username} ${identity.address} at ${identity.hostname}`)
    peers.rpc.response(peer, query, { ...proveServer(peers.account, node), ok: 1 })
    if (!connections.has(identity.hostname)) peers.add(RPC.fromInbound(peers, identity, dhtConfig))
  },
  msg: async (peers: PeerManager, query: krpc.KRPCQuery, dhtConfig: Config['dht'], node: Config['node'], peer: { host: string, port: number }) => {
    if (!authenticatedPeers.has(`${peer.host}:${peer.port}`)) {
      warn('DEVWARN:', `[RPC] Received message from unauthenticated peer ${peer.host}:${peer.port}`)
      peers.rpc.response(peer, query, { e: [0, 'Not authenticated'], ok: 0 })
      const auth = await authenticateServerUDP(peers.rpc, dhtConfig)(`${peer.host}:${peer.port}`)
      if (Array.isArray(auth)) {
        warn('DEVWARN:', `[RPC] Failed to authenticate server ${auth[1]}`)
        return
      } 
      const rpc = await RPC.fromOutbound(auth, peers, dhtConfig, node)
      if (!rpc || !await peers.add(rpc)) return
    }
    const message = query.a?.['d']?.toString()
    if (message) {
      const connection = connections.get(`${peer.host}:${peer.port}`)
      if (connection) {
        connection.messageHandlers.forEach(handler => {
          handler(message)
        })
        if (connection.messageHandlers.length === 0) warn('DEVWARN:', `[RPC] Couldn't find message handler ${peer.host}:${peer.port}`)
      } else {
        warn('DEVWARN:', `[RPC] Couldn't find connection ${`${peer.host}:${peer.port}`}`)
        const auth = await authenticateServerUDP(peers.rpc, dhtConfig)(`${peer.host}:${peer.port}`)
        if (Array.isArray(auth)) warn('DEVWARN:', `[RPC] Failed to authenticate server ${auth[1]}`)
        else {
          const rpc = await RPC.fromOutbound(auth, peers, dhtConfig, node)
          if (rpc) peers.add(rpc)
        }
      }
    }
    peers.rpc.response(peer, query, { ok: 1 })
  }
}

export const startRPC = (peers: PeerManager, node: Config['node'], config: Config['dht'], apiKey: false | string) => {
  const rpc = krpc({ id: Buffer.from(DHT_Node.getNodeId(node)), nodes: config.bootstrapNodes.split(','), timeout: 5_000 })
  rpc.on('query', async (query, peer) => {
    const q = query.q.toString()
    if (!q.startsWith(config.rpcPrefix)) return
    const _host = `${peer.address}:${peer.port}` as const
    if (!authenticatedPeers.has(_host)) await authenticateServerUDP(rpc, config)(_host)
    const host = authenticatedPeers.get(_host)?.hostname ?? _host
    log(`[RPC] Received message ${q} from ${host}`)
    if (q === `${config.rpcPrefix}_auth`) await handlers.auth(peers, query, { host: peer.address, port: peer.port }, node, apiKey, config)
    else if (q === `${config.rpcPrefix}_msg`) await handlers.msg(peers, query, config, node, { host: peer.address, port: peer.port })
    else warn('DEVWARN:', `[RPC] Received message from ${host}: ${q}`, {query})
  })
  return { rpc }
}


