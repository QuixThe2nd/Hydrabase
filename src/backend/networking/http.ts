import type { Config } from '../../types/hydrabase'
import type { Account } from '../crypto/Account'
import type PeerManager from '../PeerManager'

import { debug, logContext } from '../../utils/log'
import { Trace } from '../../utils/trace'
import { AuthSchema, type Identity, proveServer, verifyServer } from '../protocol/HIP1_Identity'
import { serveStaticFile } from '../webui'
import { authenticatedPeers } from './authenticatedPeers'
import { isPeerLocalHostname } from './utils'
import { handleConnection, websocketHandlers } from './ws/server'

const parseHost = (hostname: `${string}:${number}`): string => {
  const separatorIndex = hostname.lastIndexOf(':')
  if (separatorIndex === -1) return hostname
  return hostname.slice(0, separatorIndex)
}

const isPrivateIPv4Host = (host: string): boolean => {
  if (!/^\d+\.\d+\.\d+\.\d+$/u.test(host)) return false
  const [aRaw, bRaw] = host.split('.')
  const a = Number(aRaw)
  const b = Number(bRaw)
  if (a === 10) return true
  if (a === 127) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

const isLocalRouteHostname = (hostname: `${string}:${number}`): boolean => {
  const host = parseHost(hostname)
  return isPeerLocalHostname(host) || isPrivateIPv4Host(host)
}

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
      const requestedIsLocalRoute = isLocalRouteHostname(hostname)
      const advertisedIsLocalRoute = isLocalRouteHostname(auth.hostname)
      if (requestedIsLocalRoute && !advertisedIsLocalRoute) {
        trace.step(`[HTTP] Keeping local route ${hostname} (ignoring advertised hostname ${auth.hostname})`)
        const authResults = verifyServer(auth, auth.hostname, trace)
        if (authResults !== true) {
          trace.step('[HIP1] Failed to verify server')
          return authResults
        }
        trace.step('[HIP1] Successfully verified server')
        const routedAuth: Identity = { ...auth, hostname }
        authenticatedPeers.set(hostname, routedAuth)
        return routedAuth
      }
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
  identity: Identity = { address: account.address, bio: node.bio?.slice(0, 140), hostname: `${node.hostname}:${node.port}`, userAgent: 'Hydrabase', username: node.username }
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
      const response = await handleConnection(server, req, ip, node, apiKey, trace, peerManager, node.preferTransport, account, identity)
      if (response === undefined) return new Response(null)
      const {res} = response
      const {apiPeer} = peerManager
      if (apiPeer) {
        const fallbackHostname = `${ip.address}:${ip.port}` as `${string}:${number}`
        const hostname = response.hostname ?? fallbackHostname
        apiPeer.sendConnectionError({
          hostname,
          message: res[1],
          stack: trace.getFullTrace(),
          status: res[0],
        }, apiPeer.nonce++, trace)
      }
      trace.fail(res[1])
      return new Response(res[1], { status: res[0] })
    },
    hostname: node.listenAddress,
    port: node.port,
    routes: { '/auth': async () => {
      const trace = Trace.start('Peer requested server auth')
      const res = new Response(JSON.stringify(await proveServer(account, node, trace))) 
      trace.success()
      return res
    } },
    websocket: websocketHandlers(peerManager)
  })
  debug(`Listening on port ${server.port}`)
  return server
})
