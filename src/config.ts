export const CONFIG = {
  hostname: process.env['EXTERNAL_IP'] ?? (await (await fetch('https://icanhazip.com')).text()).trim(),
  listenAddress: process.env['LISTEN_ADDRESS'] ?? '0.0.0.0',
  serverPort: Number(process.env['SERVER_PORT'] ?? 4545),
  dhtPort: Number(process.env['DHT_PORT'] ?? 4545),
  username: process.env['USERNAME'] ?? 'Anonymous',
  apiKey: process.env['API_KEY'] ?? false,
  pluginConfidence: 'x / (x + y)',
  finalConfidence: 'avg(x, y, z)',
  soulIdCutoff: 32,
  upnpTTL: 3600, // Seconds
  upnpReannounce: 1800, // Seconds
  dhtReannounce: 15*60*1_000, // Ms
  dhtRoomSeed: 'hydrabase',
}
