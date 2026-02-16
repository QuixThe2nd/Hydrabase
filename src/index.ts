import ITunes from './Metadata/plugins/iTunes'
import MetadataManager from './Metadata'
import Node from './Node'
import { CONFIG } from './config';

declare global {
  interface Console {
    error(level: 'ERROR:', message: string, context?: `- ${string}` | Record<string, any>): void;
    warn(level: 'WARN:', message: string, context?: `- ${string}` | Record<string, any>): void;
    log(level: 'LOG:', message: string, context?: `- ${string}` | Record<string, any>): void;
  }
}

export const metadataManager = new MetadataManager([new ITunes()])

// Start Dummy Nodes
for (let i = 1; i < 1+CONFIG.dummyNodes; i++) {
  console.log('LOG:', `Starting dummy node ${i}`)
  new Node(CONFIG.serverPort+i, CONFIG.dhtPort+i, CONFIG.dhtRoom)
  await new Promise(res => setTimeout(res, 1_000))
}

// Start Node
const peers = new Node(CONFIG.serverPort, CONFIG.dhtPort, CONFIG.dhtRoom)

await new Promise(res => setTimeout(res, 10_000))

const search = async (query: string) => {
  const request = {
    type: 'search',
    trackName: query
  } as const;

  console.log('LOG:', 'Searching locally')
  const results = await metadataManager.handleRequest(request)
  const hashes: { [pluginId: string]: bigint } = {}
  for (const id in results) {
    const result = results[id]!
    const hash = BigInt(Bun.hash(JSON.stringify(result)))
    hashes[id] = hash;
  }

  console.log('LOG:', 'Searching peers')
  const peerResults = await peers.requestAll(request, hashes)

  // Inject local results
  for (const id in results) {
    if (!(id in peerResults)) peerResults[id] = {}
    peerResults[id]![0] = { result: results[id]!, confidence: [{ current: 1, historic: 1 }] }
  }
  return peerResults
}

console.log('LOG:', 'Search results:', await search('dont stop me now'));

// TODO: cache results
// TODO: prevent connecting to self
