const ip = (await (await fetch('https://icanhazip.com')).text()).trim()

export interface Config {
  apiKey: false | string
  bootstrapPeers: string
  dhtBootstrapNodes: string
  dhtReannounce: number
  dhtRoomSeed: string
  finalConfidence: string
  hostname: string
  ip: string,
  listenAddress: string
  pluginConfidence: string
  port: number,
  preferTransport: 'TCP' | 'UDP',
  requireDhtConnection: boolean,
  rpcPrefix: string,
  soulIdCutoff: number,
  upnpReannounce: number,
  upnpTTL: number,
  username: string,
}

export const CONFIG: Config = {
  apiKey: process.env['API_KEY'] ?? false,
  bootstrapPeers: 'ddns.yazdani.au:4545,ddns.yazdani.au:4544',
  dhtBootstrapNodes: 'router.bittorrent.com:6881,router.utorrent.com:6881,dht.transmissionbt.com:6881,ddns.yazdani.au:4545,ddns.yazdani.au:4544',
  dhtReannounce: 15*60*1_000, // Ms
  dhtRoomSeed: 'hydrabase',
  finalConfidence: 'avg(x, y, z)',
  hostname: process.env['DOMAIN'] ?? ip,
  ip,
  listenAddress: process.env['LISTEN_ADDRESS'] ?? '0.0.0.0',
  pluginConfidence: 'x / (x + y)',
  port: Number(process.env['PORT'] ?? 4545),
  preferTransport: (process.env['PREFER_TRANSPORT'] === 'UDP' ? 'UDP' : 'TCP'),
  requireDhtConnection: process.env['REQUIRE_DHT_CONNECTION'] !== 'false',
  rpcPrefix: 'hydra',
  soulIdCutoff: 32,
  upnpReannounce: 1800, // Seconds
  upnpTTL: 3600, // Seconds
  username: process.env['USERNAME'] ?? 'Anonymous',
}
