const ip = (await (await fetch('https://icanhazip.com')).text()).trim()

const serverPort = Number(process.env['SERVER_PORT'] ?? 4545)

export const CONFIG = {
  username: process.env['USERNAME'] ?? 'Anonymous',
  apiKey: process.env['API_KEY'] ?? false,
  blacklistedIPs: ['0.0.0.0'],
  dhtPort: Number(process.env['DHT_PORT'] ?? 45454),
  dhtReannounce: 15*60*1_000, // Ms
  dhtRoomSeed: 'hydrabase',
  finalConfidence: 'avg(x, y, z)',
  listenAddress: '0.0.0.0', // Listen address
  pluginConfidence: 'x / (x + y)',
  serverHostname: ip,
  serverPort,
  soulIdCutoff: 32,
  upnpReannounce: 1800, // Seconds
  upnpTTL: 3600 // Seconds
}
