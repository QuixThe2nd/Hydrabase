import ITunes from './Metadata/plugins/iTunes'
import MetadataManager from './Metadata'
import Node from './Node'
import { CONFIG } from './config';
import Spotify from './Metadata/plugins/Spotify';

declare global {
  interface Console {
    error(level: 'ERROR:', message: string, context?: `- ${string}` | Record<string, any>): void;
    warn(level: 'WARN:', message: string, context?: `- ${string}` | Record<string, any>): void;
    log(level: 'LOG:', message: string, context?: `- ${string}` | Record<string, any>): void;
  }
}

export const metadataManager = new MetadataManager([new ITunes(), new Spotify()])

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
  const hashes = new Set<bigint>()
  const plugins = new Set<string>()
  for (const result of results) {
    hashes.add(BigInt(Bun.hash(JSON.stringify(result))))
    plugins.add(result.plugin_id)
  }

  console.log('LOG:', 'Searching peers')
  const peerResults = await peers.requestAll(request, hashes, plugins)

  // Inject local results
  for (const result of results) {
    const hash = BigInt(Bun.hash(JSON.stringify(result)))
    peerResults.set(hash, { ...result, confidences: [...peerResults.get(hash)?.confidences ?? [], Infinity] })
  }

  return [...peerResults.values()]
}

console.log('LOG:', 'Search results:', await search('dont stop me now'));

// TODO: cache results
// TODO: prevent connecting to self
