import type { Config } from "../../types/hydrabase";
import type { Account } from "../Crypto/Account";
import type PeerManager from '../PeerManager';

import { debug, log, warn } from '../../utils/log';
import { AuthSchema, type Identity, proveServer, verifyServer } from "../protocol/HIP1/handshake";
import { serveStaticFile } from "../webui";
import { authenticatedPeers } from './rpc';
import { handleConnection, websocketHandlers } from "./ws/server";

export const authenticateServerHTTP = async (hostname: `${string}:${number}`): Promise<[number, string] | Identity> => {
  const cache = authenticatedPeers.get(hostname)
  if (cache) return cache
  
  try {
    const response = await fetch(`http://${hostname}/auth`)
    const body = await response.text()
    const auth = AuthSchema.safeParse(JSON.parse(body)).data
    if (!auth) return [500, 'Failed to parse server authentication']
    
    if (auth.hostname !== hostname) {
      debug(`[HTTP] Upgrading hostname from ${hostname} to ${auth.hostname}`)
      return await authenticateServerHTTP(auth.hostname)
    }
    
    const authResults = verifyServer(auth, hostname)
    if (authResults !== true) return authResults
    
    authenticatedPeers.set(hostname, auth)
    log(`[HTTP] Authenticated server ${hostname}`)
    return auth
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    warn('WARN:', `[HTTP] Authentication failed for ${hostname} - ${message}`)
    return [500, `Failed to authenticate server via HTTP: ${message}`]
  }
}

export const startServer = (account: Account, peerManager: PeerManager, node: Config['node'], apiKey: string) => {
  const server = Bun.serve({
    fetch: async (req, server) =>  {
      const url = new URL(req.url)
      if (req.headers.get("upgrade") !== "websocket") return serveStaticFile(url.pathname)
      const response = await handleConnection(server, req, server.requestIP(req), node, apiKey)
      if (response === undefined) return response
      const {address, hostname, res} = response
      warn('DEVWARN:', `[SERVER] Rejected connection with client ${address || hostname ? [address,hostname].join(' ') : 'N/A'} for reason: ${res[1]}`)
      return new Response(res[1], { status: res[0] })
    },
    hostname: node.listenAddress,
    port: node.port,
    routes: { '/auth': () => new Response(JSON.stringify(proveServer(account, node))) },
    websocket: websocketHandlers(peerManager)
  })
  debug(`[SERVER] Listening on port ${server.port}`)
  return server
}
