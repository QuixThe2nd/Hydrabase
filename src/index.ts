import ITunes from './Metadata/plugins/iTunes'
import MetadataManager from './Metadata'
import Node from './Node'
import { CONFIG } from './config';
import Spotify from './Metadata/plugins/Spotify';
import { Crypto, getPrivateKey } from './Crypto';
import { startDatabase } from './db';

process.on('unhandledRejection', (err) => {
  console.error('ERROR:', 'Unhandled rejection', err)
})
process.on('uncaughtException', (err) => {
  console.error('ERROR:', 'Uncaught exception', err)
})

declare global {
  interface Console {
    error(level: 'ERROR:', message: string, context?: `- ${string}` | Record<string, unknown>): void;
    warn(level: 'WARN:', message: string, context?: `- ${string}` | Record<string, unknown>): void;
    log(level: 'LOG:', message: string, context?: `- ${string}` | Record<string, unknown>): void;
  }
}

// TODO: Merge duplicate artists from diff plugins

const SPOTIFY_CLIENT_ID = process.env['SPOTIFY_CLIENT_ID']
const SPOTIFY_CLIENT_SECRET = process.env['SPOTIFY_CLIENT_SECRET']

const { repos, db } = startDatabase()

const metadataManager = new MetadataManager([new ITunes(), ... SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET ? [new Spotify(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET)] : []], repos)

// Start Dummy Nodes
for (let i = 1; i < 1+CONFIG.dummyNodes; i++) {
  console.log('LOG:', `Starting dummy node ${i}`)
  const node = new Node(CONFIG.serverPort+i, CONFIG.dhtPort+i, new Crypto(await getPrivateKey(i)), metadataManager, repos, db)
  await new Promise(res => setTimeout(res, 5_000))
  const artists = await node.search('artist', 'jay z')
  /*const track = */await node.search('track', 'dont stop me now')
  /*const album = */await node.search('album', 'made in england')
  // console.log('LOG:', 'Artist results:', artists)
  // console.log('LOG:', 'Track results:', track)
  // console.log('LOG:', 'Album results:', album)
  if (artists[0]) {
    await node.search('artist.tracks', artists[0].soul_id)
    await node.search('artist.albums', artists[0].soul_id)
  }
}

// Start Node
const node = new Node(CONFIG.serverPort, CONFIG.dhtPort, new Crypto(await getPrivateKey()), metadataManager, repos, db)

await new Promise(res => setTimeout(res, 10_000))

const id = setInterval(async () => {
  if (node.peerCount === 0) {
    console.warn('WARN:', 'Waiting for connections')
    return
  }
  clearInterval(id)
  const artists = await node.search('artist', 'jay z')
  /*const track = */await node.search('track', 'dont stop me now')
  /*const album = */await node.search('album', 'made in england')
  // console.log('LOG:', 'Artist results:', artists)
  // console.log('LOG:', 'Track results:', track)
  // console.log('LOG:', 'Album results:', album)
  if (artists[0]) {
    await node.search('artist.tracks', artists[0].soul_id)
    await node.search('artist.albums', artists[0].soul_id)
  }
}, 5_000)
