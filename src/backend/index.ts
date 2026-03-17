import dgram from 'dgram'
import net from 'net'

import type { Config } from "../types/hydrabase"

import { error, warn } from '../utils/log'
import { startNode } from './Node'

process.on('unhandledRejection', (err) => error('ERROR:', '[MAIN] Unhandled rejection', {err}))
process.on('uncaughtException', (err) => error('ERROR:', '[MAIN] Uncaught exception', {err}))

const socketHandler = (socket: dgram.Socket | net.Server, res: (value: boolean | PromiseLike<boolean>) => void, rej: (reason: Error) => void) => {
  socket.addListener('listening', () => {
    socket.close()
    res(false)
  })
  socket.addListener('error', (err: Error) => {
    socket.close()
    if ((err as unknown as { code: string }).code === 'EADDRINUSE') res(true)
    else rej(err)
  })
}
const isTCPPortInUse = (port: number) => new Promise<boolean>((res, rej) => {
  const server = net.createServer()
  socketHandler(server, res, rej)
  server.listen(port)
})
const isUDPPortInUse = (port: number) => new Promise<boolean>((res, rej) => {
  const socket = dgram.createSocket('udp4')
  socketHandler(socket, res, rej)
  socket.bind(port)
})

export const BRANCH = process.env['BRANCH'] ?? 'unknown'

const defaultPort = process.env['PORT'] ?? 4545
let port = Number(defaultPort)
while (await isTCPPortInUse(port) || await isUDPPortInUse(port)) port++
if (port !== Number(defaultPort)) warn('WARN:', `[SERVER] Port ${defaultPort} in use - Using ${port} instead`)

const ipServers = ['https://icanhazip.com', 'https://api.ipify.org']

const getIp = () => new Promise<string>(resolve => {
  (async () => {
    for (const ipServer of ipServers) {
      try {
        const response = await fetch(ipServer)
        resolve((await response.text()).trim())
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
    port,
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
