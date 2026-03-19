// @ts-expect-error: This is supported by bun
import VERSION from '../../VERSION' with { type: 'text' }
import { log } from '../utils/log'
import { makeSentryRelease } from '../utils/sentryRelease'
import { BRANCH } from './branch'

const initTelemetry = async (): Promise<void> => {
  if (process.env['HYDRABASE_TELEMETRY'] !== 'true') {
    log('[TELEMETRY] Disabled (set HYDRABASE_TELEMETRY=true to enable)')
    return
  }
  const Sentry = await import('@sentry/bun')
  const release = makeSentryRelease({ app: 'hydrabase', branch: BRANCH, version: VERSION })
  Sentry.init({
    dsn: 'https://e048333b5d85bdc50499b9de2c440f81@o4511068837314560.ingest.de.sentry.io/4511068838625360',
    enableLogs: true,
    integrations: [Sentry.consoleLoggingIntegration({ levels: ['log', 'warn', 'error'] })],
    release,
    sendDefaultPii: true,
    tracesSampleRate: 1.0,
  })
  log(`[TELEMETRY] Enabled (Sentry) release=${release}`)
  ;(globalThis as typeof globalThis & {
    __hydrabaseSentryLogger__?: unknown
  }).__hydrabaseSentryLogger__ = Sentry.logger
  ;(globalThis as typeof globalThis & {
    __hydrabaseCaptureException__?: (exception: unknown) => void
  }).__hydrabaseCaptureException__ = (exception) => Sentry.captureException(exception)
  ;(globalThis as typeof globalThis & {
    __hydrabaseLogEvent__?: (event: {
      category: string
      context?: unknown
      level: 'debug' | 'error' | 'info' | 'warning'
      message: string
    }) => void
  }).__hydrabaseLogEvent__ = (event: {
    category: string
    context?: unknown
    level: 'debug' | 'error' | 'info' | 'warning'
    message: string
  }) => {
    Sentry.addBreadcrumb({
      category: event.category,
      data: event.context && typeof event.context === 'object' ? (event.context as Record<string, unknown>) : { context: event.context },
      level: event.level,
      message: event.message,
      timestamp: Date.now() / 1000,
      type: 'default',
    })
  }
}

import dgram from 'dgram'
import net from 'net'

import type { Config } from '../types/hydrabase'

import { error, warn } from '../utils/log'
import { startNode } from './Node'

await initTelemetry()


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
  bootstrapPeers: 'ddns.yazdani.au:4543,ddns.yazdani.au:4544,ddns.yazdani.au:4545',
  dht: {
    bootstrapNodes: 'router.bittorrent.com:6881,router.utorrent.com:6881,dht.transmissionbt.com:6881,ddns.yazdani.au:4543,ddns.yazdani.au:4544,ddns.yazdani.au:4545',
    reannounce: 15*60*1_000,
    requireReady: process.env['REQUIRE_DHT_READY'] !== 'false',
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
