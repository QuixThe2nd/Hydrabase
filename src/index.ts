import ITunes from './Metadata/plugins/iTunes'
import MetadataManager from './Metadata'
import Peers from './Peers'
import Server from './Server'
import natUpnp from 'nat-upnp'

const CONFIG = {
  serverPort: 3000,
  dhtPort: 30000,
  dhtRoom: '0000dabae71be086ec43ca1be7e97b2f982620f0',
  dummyNodes: 0, // Dummy nodes are full nodes used for testing, each is run on a sequential port
  upnpTTL: 3600, // Seconds
  upnpReannounce: 1800, // Seconds
};

const upnp = natUpnp.createClient();
const _portForward = (port: number, description: string, protocol: 'TCP' | 'UDP' = 'TCP') => upnp.portMapping({ public: port, private: port, ttl: CONFIG.upnpTTL, protocol, description }, err => { if (err) console.error(err) })
export const portForward = (port: number, description: string, protocol: 'TCP' | 'UDP' = 'TCP') => {
  _portForward(port, description, protocol)
  setInterval(() => _portForward(port, description, protocol), CONFIG.upnpReannounce*1_000)
}

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
  return peerResults // TODO: merge local and remote results
}

console.log(await search('dont stop me now'));

// TODO: cache results
// TODO: prevent connecting to self
