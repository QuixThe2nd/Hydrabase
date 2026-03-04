# Hydrabase - WIP

Hydrabase is web-of-trust inspired consensus-less distributed relational database. Hydrabase is a P@P network that acts as a unified source for music metadata.

## Install

### Docker

```yml
services:
  hydrabase:
    image: ghcr.io/quixthe2nd/hydrabase
    container_name: hydrabase
    restart: always
    ports:
      - 4545:4545/tcp
      - 45454:45454/udp
    volumes:
      - ./data:/app/data
    environment:
      PUID: 1000
      PGID: 1000
      # Uncomment to enable Spotify plugin:
      # SPOTIFY_CLIENT_ID: $SPOTIFY_CLIENT_ID
      # SPOTIFY_CLIENT_SECRET: $SPOTIFY_CLIENT_SECRET
      # Ports
      DHT_PORT: 45454
      SERVER_PORT: 4545
      # Use `openssl rand -hex 16` to generate an api key
      # API_KEY: $API_KEY
      USERNAME: Anonymous
```

### Manual

To install:
```bash
git clone https://github.com/QuixThe2nd/Hydrabase
cd Hydrabase
bun install
```

To run:

```bash
bun src
```

## API Documentation

To make an API request, you need to connect to a Hydrabase node via WebSocket. Connect to `ws://ip_address:4545` with the `x-api-key` header set.

### Requests
Once connected to a node, you can trigger searches by sending a message structured like so:
```json
{
  "request": {
    "type": "artist" | "track" | "album",
    "query": "black eyed peas"
  },
  "nonce": 20
}
```

Nonces are optional but recommended, they can be any number, but should be unique to that request. That way when the server responds, you know which request it's for:
```json
{
  "response": [
    {
      "id": "360391",
      "name": "Black Eyed Peas",
      "popularity": 0,
      "genres": [ "Pop" ],
      "followers": 0,
      "image_url": "",
      "external_urls": {},
      "plugin_id": "iTunes"
    },
    {
      "id": "1yxSLGMDHlW21z4YXirZDS",
      "name": "Black Eyed Peas",
      "popularity": 81,
      "genres": [],
      "followers": 10041814,
      "image_url": "https://i.scdn.co/image/ab6761610000e5ebb3037310c07b99cbefbd2c6d",
      "external_urls": { "spotify": "https://open.spotify.com/artist/1yxSLGMDHlW21z4YXirZDS" },
      "plugin_id": "Spotify"
    }
  ],
  "nonce": 20
}
```

## Networking
Currently Hydrabase needs 2 ports forwarded:
```
TCP: 4545 (WebSocket - Used to communicate with peers)
UDP: 45454 (DHT - Used to discover peers)
```

Hydrabase will automatically try to forward required ports using uPnP, but manual port forwarding is recommended. Hydrabase will not work without port forwarding enabled.

## How it Works
As Hydrabase is under active development, this section will be incomplete. Here is what is currently functional:

### Peer Discovery
#### DHT
Hydrabase nodes connect to BitTorrent's DHT network and query it for an infohash for a torrent that doesn't exist, then announce that they're seeding it. This infohash can be anything, as long as all peers use the same one. This allows for peers to find each other without a centralised tracker or signalling server.

#### Gossip Network
Each time 2 Hydrabase nodes create a connection, they announce each other to all known peers. This acts as a more reliable peer discovery network, using DHT as a bootstrap network.

### Local Metadata Lookups
Hydrabase nodes can run plugins. For now, only iTunes & Spotify plugins exist. These plugins expose search functions which are used to search external metadata providers directly for music.

### Remote Metadata Lookups
Hydrabase nodes can query their peers to lookup metadata for them. This will trigger a local lookup on the peer's end with the results relayed.

### Identities
Each Hydrabase has it's own public key used to identify itself. This is used to de-duplicate peers and to avoid connecting to self. The identities are also used to permanently keep track of peer reputation.

### Peer Reputation
Historic peer responses are kept track of, like a ledger of votes. The confidence we have in this peer is calculated as a score between 0-1, 0 meaning "ive only ever seen them lie" and 1 meaning "ive only ever seen them tell the truth." This score is used to weigh votes when deciding on the "correct" response. Aka, peers that we have a longer history with are more trustworthy that newer peers.

### Result Confidence
Each API response includes a confidence score. This score represents how trustworthy that individual result is. That confidence score is derived from a series of sub-confidence scores such as peer scores.

To break this down, lets say a peer with a confidence score of 0.8 votes that the track id of a song is xxxxx with 0.9 certainty, the confidence in that id is 0.72. If a later lookup that involves that ID, and that lookup from a peer with a 0.95 reputation and 0.4 confidence (0.38 score) relies on that id, the confidence in the lookup will be 0.2736.

The formulas used to derive these numbers are configurable. A threshold can then be set by applications integrating Hydrabase defining minimum scores allowed for different types of information, to avoid trusting results with a 0.2736 score.

### Cache Layer
Metadata discovered via API lookups and other peers is stored in a database. When queried, Hydrabase will query your local cache, any configured plugins, and peers. When a peer receives a request, they will only search their local cache and plugins, they won't relay to other peers.

### Future Plans
While everything listed above is working, Hydrabase is very incomplete. I scatter `TODO`s throughout the code, so if you're super curious, I've listed technical next-steps. But at a high level, most my focus is on improving the confidence scoring mechanism. The end goal is for peers running different plugins to benefit by exchanging api responses from different metadata providers.

### Versioning
#### Protocol Versioning
A Hydrabase Improvement Proposals (HIP) defines hows peers communicate with each other, they're essentially API specifications/capabilities. Each new type of communication uses a new HIP number (HIP1, HIP2, etc). For example, HIP2 defines how request/response messages are structured, and HIP3 defines how peers authenticate each other. Currently, I am rapidly iterating on Hydrabase, so HIPs are changing, however, once ready for production, HIPs will be immutable. Once immutable, if the authentication protocol needs updating, HIP3v2 will be created.

#### Application Versioning
v**MAJOR.MINOR.PATCH**:
- MAJOR = Protocol breaking (wire-incompatible, peers must upgrade)
- MINOR = Protocol additive OR app breaking (with clear changelog)
- PATCH = App-level fixes/updates

![Star History Chart](https://api.star-history.com/image?repos=QuixThe2nd/Hydrabase&type=date&legend=top-left)
