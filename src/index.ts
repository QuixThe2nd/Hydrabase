import ITunes from './Metadata/plugins/iTunes'
import MetadataManager from './Metadata'
import Node from './Node'

export const CONFIG = {
  serverPort: 4000,
  dhtPort: 30000,
  dhtRoom: '0000dabae71be086ec43ca1be7e97b2f982620f0',
  dummyNodes: 2, // Dummy nodes are full nodes used for testing, each is run on a sequential port
  upnpTTL: 3600, // Seconds
  upnpReannounce: 1800, // Seconds
};

export const metadataManager = new MetadataManager([new ITunes()])

// Start Dummy Nodes
for (let i = 1; i < 1+CONFIG.dummyNodes; i++) {
  console.log('Starting node', i)
  new Node(CONFIG.serverPort+i, CONFIG.dhtPort+i, CONFIG.dhtRoom)
  await new Promise(res => setTimeout(res, 5_000))
}

// Start Node
const peers = new Node(CONFIG.serverPort, CONFIG.dhtPort, CONFIG.dhtRoom)

await new Promise(res => setTimeout(res, 10_000))

const search = async (query: string) => {
  const request = {
    type: 'search',
    trackName: query
  } as const;

  console.log('Searching locally')
  const results = await metadataManager.handleRequest(request)
  const hashes: { [pluginId: string]: bigint } = {}
  for (const id in results) {
    const result = results[id]!
    const hash = BigInt(Bun.hash(JSON.stringify(result)))
    hashes[id] = hash;
  }

  console.log('Searching peers')
  const peerResults = await peers.requestAll(request, hashes)
  return peerResults // TODO: merge local and remote results
}

console.log(await search('dont stop me now'));

// TODO: cache results
// TODO: prevent connecting to self
