export const CONFIG = {
  serverPort: process.env['SERVER_PORT'] ?? 3000,
  dhtPort: process.env['DHT_PORT'] ?? 30000,
  dhtRoom: '0000dabae71be086ec43ca1be7e97b2ff0f0f0f0',
  dummyNodes: 0, // Dummy nodes are full nodes used for testing, each is run on a sequential port
  upnpTTL: 3600, // Seconds
  upnpReannounce: 1800, // Seconds
  pluginConfidence: 'x / (x + y)',
  historicConfidence: 'x * y',
  finalConfidence: 'x * y'
}
