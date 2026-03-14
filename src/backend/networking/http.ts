import type { Config } from "../../types/hydrabase";
import type { Account } from "../Crypto/Account";
import type PeerManager from '../PeerManager';

import { debug, warn } from '../../utils/log';
import { proveServer } from "../protocol/HIP1/handshake";
import { serveStaticFile } from "../webui";
import { handleConnection, websocketHandlers } from "./ws/server";

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
