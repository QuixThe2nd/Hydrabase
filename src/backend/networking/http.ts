import type { Config } from "../../types/hydrabase";
import type { Account } from "../Crypto/Account";
import type PeerManager from '../PeerManager';

import { debug, log, logContext, warn } from '../../utils/log';
import { Trace } from '../../utils/trace';
import { AuthSchema, type Identity, proveServer, verifyServer } from "../protocol/HIP1/handshake";
import { serveStaticFile } from "../webui";
import { authenticatedPeers } from "./udp/server";
import { handleConnection, websocketHandlers } from "./ws/server";

export const authenticateServerHTTP = async (hostname: `${string}:${number}`, trace?: Trace): Promise<[number, string] | Identity> => {
  const cache = authenticatedPeers.get(hostname)
  if (cache) {
    trace?.step('HTTP auth cached')
    return cache
  }
  
  try {
    trace?.step('HTTP GET /auth')
    const response = await fetch(`http://${hostname}/auth`, { signal: AbortSignal.timeout(10_000) })
    trace?.step(`HTTP GET /auth → ${response.status}`)
    const body = await response.text()
    const auth = AuthSchema.safeParse(JSON.parse(body)).data
    if (!auth) {
      trace?.step('Failed to parse server authentication')
      return [500, 'Failed to parse server authentication']
    }
    
    if (auth.hostname !== hostname) {
      trace?.step(`Upgrading hostname → ${auth.hostname}`)
      debug(`Upgrading hostname from ${hostname} to ${auth.hostname}`)
      return await authenticateServerHTTP(auth.hostname, trace)
    }
    
    const authResults = verifyServer(auth, hostname)
    if (authResults !== true) {
      trace?.step('HIP1 verifyServer → invalid')
      return authResults
    }
    trace?.step('HIP1 verifyServer → valid')
    
    authenticatedPeers.set(hostname, auth)
    log(`Authenticated server ${hostname}`)
    return auth
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    trace?.step(`HTTP error: ${message}`)
    warn('WARN:', `Authentication failed for ${hostname} - ${message}`)
    return [500, `Failed to authenticate server via HTTP: ${message}`]
  }
}

export const startServer = (account: Account, peerManager: PeerManager, node: Config['node'], apiKey: string) => {
  const server = Bun.serve({
    fetch: (req, server) => logContext('HTTP', async () => {
      const url = new URL(req.url)
      if (req.headers.get("upgrade") !== "websocket") return serveStaticFile(url.pathname)
      const ip = server.requestIP(req)
      if (!ip) {
        warn('DEVWARN:', 'Failed to get client IP')
        return new Response('Failed to get client IP', { status: 500 })
      }
      const response = await handleConnection(server, req, ip, node, apiKey, peerManager)
      if (response === undefined) return response
      const {address, hostname, res} = response
      warn('DEVWARN:', `Rejected connection with client ${address || hostname ? [address,hostname].join(' ') : 'N/A'} for reason: ${res[1]}`)
      return new Response(res[1], { status: res[0] })
    }),
    hostname: node.listenAddress,
    port: node.port,
    routes: { '/auth': () => new Response(JSON.stringify(proveServer(account, node))) },
    websocket: websocketHandlers(peerManager)
  })
  debug(`Listening on port ${server.port}`)
  return server
}
