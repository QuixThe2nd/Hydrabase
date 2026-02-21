const ip = (await (await fetch('https://icanhazip.com')).text()).trim()

const serverPort = Number(process.env['SERVER_PORT'] ?? 3000)
const dummyNodes = Number(process.env['DUMMY_NODES'] ?? 0)

export const CONFIG = {
  serverPort,
  dhtPort: Number(process.env['DHT_PORT'] ?? 30000),
  dhtRoomSeed: 'hydrabase',
  dhtReannounce: 15*60*1_000, // Ms
  dummyNodes, // Dummy nodes are full nodes used for testing, each is run on a sequential port
  upnpTTL: 3600, // Seconds
  upnpReannounce: 1800, // Seconds
  pluginConfidence: 'x / (x + y)',
  finalConfidence: 'x * y',
  listenAddress: '0.0.0.0', // Listen address
  serverHostname: ip,
  soulIdCutoff: 32, // DO NOT CHANGE - ONLY HERE FOR DEVELOPMENT - CHANGING WILL BREAK SOUL_IDs
  publicHostnames: [ // This should be an address only you control, peers, when proving their identity will use your public hostname. If this IP is different to the one being announce, Hydrabase can't authenticate peers.
    `ws://${ip}:${serverPort}`,
    ...Array.from({ length: dummyNodes }, (_, i) => `ws://${ip}:${serverPort + i + 1}`)
  ],
  apiKey: process.env['API_KEY'] ?? false
} as const
