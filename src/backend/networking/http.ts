import type { Config } from '../../types/hydrabase'
import type { Account } from '../crypto/Account'
import type PeerManager from '../PeerManager'

import { debug, logContext } from '../../utils/log'
import { Trace } from '../../utils/trace'
import { AuthSchema, type Identity, proveServer, verifyServer } from '../protocol/HIP1_Identity'
import { serveStaticFile } from '../WebUI'
import { authenticatedPeers, UDP_Server } from './udp/server'
import { handleConnection, websocketHandlers } from './ws/server'

export const authenticateServerHTTP = async (hostname: `${string}:${number}`, trace: Trace): Promise<[number, string] | Identity> => {
  const cache = authenticatedPeers.get(hostname)
  if (cache) {
    trace.step('[HTTP] Using cached auth')
    return cache
  }
  
  try {
    trace.step('[HTTP] Fetching auth')
    const response = await fetch(`http://${hostname}/auth`, { signal: AbortSignal.timeout(10_000) })
    trace.step(`[HTTP] Fetched auth → ${response.status}`)
    const body = await response.text()
    const auth = AuthSchema.safeParse(JSON.parse(body)).data
    if (!auth) {
      trace.step('[HIP1] Failed to parse server authentication')
      return [500, '[HIP1] Failed to parse server authentication']
    }
    if (auth.hostname !== hostname) {
      trace.step(`Upgrading hostname → ${auth.hostname}`)
      debug(`Upgrading hostname from ${hostname} to ${auth.hostname}`)
      return await authenticateServerHTTP(auth.hostname, trace)
    }
    
    const authResults = verifyServer(auth, hostname, trace)
    if (authResults !== true) {
      trace.step('[HIP1] Failed to verify server')
      return authResults
    }
    trace.step('[HIP1] Successfully verified server')
    authenticatedPeers.set(hostname, auth)
    return auth
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return [500, message]
  }
}

export const startServer = (
  account: Account,
  peerManager: PeerManager,
  node: Config['node'],
  apiKey: string,
  preferTransport: 'TCP' | 'UDP' = node.preferTransport,
  udpServer?: UDP_Server,
  identity: Identity = { address: account.address, hostname: `${node.hostname}:${node.port}`, userAgent: 'Hydrabase', username: node.username }
) => logContext('HTTP', () => {
  const server = Bun.serve({
    fetch: async (req, server) => {
      const url = new URL(req.url)
      if (req.headers.get('upgrade') !== 'websocket') return serveStaticFile(url.pathname)
      const trace = Trace.start('Inbound WS connection')
      const ip = server.requestIP(req)
      if (!ip) {
        trace.fail('Failed to get client IP')
        return new Response('Failed to get client IP', { status: 500 })
      }
      const response = await handleConnection(server, req, ip, node, apiKey, trace, peerManager, preferTransport, udpServer, account, identity)
      if (response === undefined) return response
      const {res} = response
      trace.fail(res[1])
      return new Response(res[1], { status: res[0] })
    },
    hostname: node.listenAddress,
    port: node.port,
    routes: { '/auth': () => {
      const trace = Trace.start('Peer requested server auth')
      const res = new Response(JSON.stringify(proveServer(account, node, trace))) 
      trace.success()
      return res
    } },
    websocket: websocketHandlers(peerManager)
  })
  debug(`Listening on port ${server.port}`)
  return server
})
