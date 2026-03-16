import type { Config } from "../types/hydrabase"

import { error } from '../utils/log';
import { startNode } from './Node';

process.on('unhandledRejection', (err) => error('ERROR:', '[MAIN] Unhandled rejection', {err}))
process.on('uncaughtException', (err) => error('ERROR:', '[MAIN] Uncaught exception', {err}))

const ipServers = ['https://icanhazip.com', 'https://api.ipify.org']

const getIp = () => new Promise<string>(resolve => {
  (async () => {
    for (const ipServer of ipServers) {
      try {
        const response = await fetch(ipServer)
        const ip = await response.text()
        resolve(ip)
      } catch(e) {
        error('ERROR:', `[IP] Failed to fetch external IP from ${ipServer}`, {e})
      }
    }
  })()
})

const ip = await getIp()

const CONFIG: Config = {
  apiKey: process.env['API_KEY'],
  bootstrapPeers: 'ddns.yazdani.au:4545,ddns.yazdani.au:4544',
  dht: {
    bootstrapNodes: 'router.bittorrent.com:6881,router.utorrent.com:6881,dht.transmissionbt.com:6881,ddns.yazdani.au:4545,ddns.yazdani.au:4544',
    reannounce: 15*60*1_000,
    requireConnection: process.env['REQUIRE_DHT_CONNECTION'] !== 'false',
    roomSeed: 'hydrabase',
  },
  formulas: {
    finalConfidence: 'avg(x, y, z)',
    pluginConfidence: 'x / (x + y)',
  },
  node: {
    hostname: process.env['DOMAIN'] ?? ip,
    ip,
    listenAddress: process.env['LISTEN_ADDRESS'] ?? '0.0.0.0',
    port: Number(process.env['PORT'] ?? 4545),
    preferTransport: (process.env['PREFER_TRANSPORT'] === 'UDP' ? 'UDP' : 'TCP'),
    username: process.env['USERNAME'] ?? 'Anonymous',
  },
  rpc: {
    prefix: 'hydra_'
  },
  soulIdCutoff: 32,
  upnp: {
    reannounce: 1_800_000, // Ms
    ttl: 3_600_000, // Ms
  }
}


await startNode(CONFIG)
// TODO: Merge duplicate artists from diff plugins
