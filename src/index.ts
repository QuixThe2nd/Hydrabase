import ITunes from "./Metadata/plugins/iTunes";
import MetadataManager from "./Metadata";
import Peers from "./Peers";
import Server from "./Server";

const server = new Server(new MetadataManager([new ITunes()]))
const peers = new Peers(["ws://localhost:3000", "ws://127.0.0.1:3000"]) // TODO: peer discovery

await new Promise(res => setTimeout(res, 1_000))
const request = {
  type: 'search',
  trackName: 'dont stop me now'
} as const;

const results = await server.handleRawRequest(request)
const hashes: { [pluginId: string]: bigint } = {}
for (const id in results) {
  const result = results[id]!
  const hash = BigInt(Bun.hash(JSON.stringify(result)))
  hashes[id] = hash;
}

const peerResults = await peers.requestAll(request, hashes)
console.log(peerResults)

