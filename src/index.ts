import ITunes from "./Metadata/plugins/iTunes";
import MetadataManager from "./Metadata";
import Peers from "./Peers";
import Server from "./Server";

const CONFIG = {
  serverPort: 3000,
  dhtPort: 30000,
  dhtRoom: '0000dabae71be086ec43ca1be7e97b2f982620f0',
};

// for (let i = 1; i < 3; i++) {
//   console.log('Starting node', i)

//   new Server(new MetadataManager([new ITunes()]), CONFIG.serverPort+i)
//   new Peers(CONFIG.serverPort+i, CONFIG.dhtPort+i, CONFIG.dhtRoom)
// }

const server = new Server(new MetadataManager([new ITunes()]), CONFIG.serverPort)
const peers = new Peers(CONFIG.serverPort, CONFIG.dhtPort, CONFIG.dhtRoom)

await new Promise(res => setTimeout(res, 10_000))
const request = {
  type: 'search',
  trackName: 'dont stop me now'
} as const;

console.log('Search locally')
const results = await server.handleRawRequest(request)
const hashes: { [pluginId: string]: bigint } = {}
for (const id in results) {
  const result = results[id]!
  const hash = BigInt(Bun.hash(JSON.stringify(result)))
  hashes[id] = hash;
}

console.log('Search peers')
const peerResults = await peers.requestAll(request, hashes)
console.log(peerResults)

// TODO: cache results
// TODO: uPnP
// TODO: prevent connecting to self