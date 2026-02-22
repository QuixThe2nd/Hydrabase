import ITunes from './Metadata/plugins/iTunes'
import MetadataManager from './Metadata'
import Node from './Node'
import { CONFIG } from './config';
import Spotify from './Metadata/plugins/Spotify';
import { Crypto, getPrivateKey } from './utils/crypto';
import { startDatabase } from './db';

process.on('unhandledRejection', (err) => {
  console.error('ERROR:', 'Unhandled rejection', err)
})
process.on('uncaughtException', (err) => {
  console.error('ERROR:', 'Uncaught exception', err)
})

declare global {
  interface Console {
    error(level: 'ERROR:', message: string, context?: `- ${string}` | Record<string, any>): void;
    warn(level: 'WARN:', message: string, context?: `- ${string}` | Record<string, any>): void;
    log(level: 'LOG:', message: string, context?: `- ${string}` | Record<string, any>): void;
  }
}

// TODO: Merge duplicate artists from diff plugins
// TODO: search db cache

const SPOTIFY_CLIENT_ID = process.env['SPOTIFY_CLIENT_ID']
const SPOTIFY_CLIENT_SECRET = process.env['SPOTIFY_CLIENT_SECRET']

const db = startDatabase()

const metadataManager = new MetadataManager([new ITunes(), ... SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET ? [new Spotify(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET)] : []], db)

// Start Dummy Nodes
for (let i = 1; i < 1+CONFIG.dummyNodes; i++) {
  console.log('LOG:', `Starting dummy node ${i}`)
  const node = new Node(CONFIG.serverPort+i, CONFIG.dhtPort+i, new Crypto(await getPrivateKey(i)), metadataManager, db)
  await new Promise(res => setTimeout(res, 5_000))
  await node.search('track', 'dont stop me now')
  await node.search('artist', 'jay z')
  await node.search('album', 'made in england')
}

// Start Node
const node = new Node(CONFIG.serverPort, CONFIG.dhtPort, new Crypto(await getPrivateKey()), metadataManager, db)

await new Promise(res => setTimeout(res, 10_000))

console.log('LOG:', 'Track results:', await node.search('track', 'dont stop me now'));
console.log('LOG:', 'Artist results:', await node.search('artist', 'jay z'));
console.log('LOG:', 'Album results:', await node.search('album', 'made in england'));
