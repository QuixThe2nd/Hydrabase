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

const search = async (type: 'track' | 'artist' | 'album', query: string) => {
  const request = { type, query } as const;

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
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const hash = [...hashes.values()][i]!;
    peerResults.set(hash, { ...result, confidences: [...peerResults.get(hash)?.confidences ?? [], Infinity] })
  }

  return [...peerResults.values()]
}

console.log('LOG:', 'Track results:', await search('track', 'dont stop me now'));
console.log('LOG:', 'Artist results:', await search('artist', 'jay z'));
console.log('LOG:', 'Album results:', await search('album', 'made in england'));

// TODO: cache results
// TODO: prevent connecting to self
