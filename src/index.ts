import ITunes from "./Metadata/plugins/iTunes";
import MetadataManager from "./Metadata";
import Peers from "./Peers";
import Server from "./Server";

const CONFIG = {
  serverPort: 3000,
  dhtPort: 30000,
  dhtRoom: '0000dabae71be086ec43ca1be7e97b2f982620f0',
  dummyNodes: 0 // Dummy nodes are full nodes used for testing, each is run on a sequential port
};

// Start Dummy Nodes
for (let i = 1; i < 1+CONFIG.dummyNodes; i++) {
  console.log('Starting node', i)
  new Server(new MetadataManager([new ITunes()]), CONFIG.serverPort+i)
  new Peers(CONFIG.serverPort+i, CONFIG.dhtPort+i, CONFIG.dhtRoom)
  await new Promise(res => setTimeout(res, 1_000))
}

// Start Node
const server = new Server(new MetadataManager([new ITunes()]), CONFIG.serverPort)
const peers = new Peers(CONFIG.serverPort, CONFIG.dhtPort, CONFIG.dhtRoom)

await new Promise(res => setTimeout(res, 5_000))

const search = async (query: string) => {
  const request = {
    type: 'search',
    trackName: query
  } as const;

  console.log('Searching locally')
  const results = await server.handleRawRequest(request)
  const hashes: { [pluginId: string]: bigint } = {}
  for (const id in results) {
    const result = results[id]!
    const hash = BigInt(Bun.hash(JSON.stringify(result)))
    hashes[id] = hash;
  }

  console.log('Searching peers')
  const peerResults = await peers.requestAll(request, hashes)
  return peerResults
}

console.log(await search('dont stop me now'));

// TODO: cache results
// TODO: uPnP
// TODO: prevent connecting to self
