# Hydrabase

Hydrabase is currently a proof of concept consensus-less P2P network. The networks primary purpose is to act as a unified source that propagates music metadata.

Hydrabase is a WIP and not intended for use yet.

## Install

### Docker

```yml
services:
  hydrabase:
    image: ghcr.io/quixthe2nd/hydrabase:latest
    container_name: hydrabase
    ports:
      - 3000:3000/tcp
      - 30000:30000/udp
    # Uncomment for testing
    # volumes:
    #   - ./app:/app
    environment:
      # Uncomment to enable Spotify plugin:
      # SPOTIFY_CLIENT_ID: $SPOTIFY_CLIENT_ID
      # SPOTIFY_CLIENT_SECRET: $SPOTIFY_CLIENT_SECRET
      # Ports
      DHT_PORT: 30000
      SERVER_PORT: 3000
      # Use `openssl rand -hex 16` to generate an api key
      # API_KEY: $API_KEY
      # Used for testing
      DUMMY_NODES: 0
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

### Updates
Hydrabase is automatically updated on launch.

## Networking

Currently Hydrabase needs 2 ports forwarded:
```
TCP: 3000 (WebSocket - Used to communicate with peers)
UDP: 30000 (DHT - Used to discover peers)
```

Hydrabase will automatically try to forward required ports using uPnP, but manual port forwarding is recommended.

Theoretically, if there's enough peers in the network, you can use Hydrabase without port forwarding, but if everyone did that, Hydrabase won't work. Plus, not port forwarding reduces your connectability.

## How it Works

As Hydrabase is under active development, this section will be incomplete. Here is what is currently functional:

### Peer Discovery

Hydrabase nodes connect to BitTorrent's DHT network and query it for an infohash for a torrent that doesn't exist, then announce that they're seeding it. This infohash can be anything, as long as all peers use the same one. This allows for peers to find each other without a centralised tracker or signalling server.

### Local Metadata Lookups

Hydrabase nodes can run plugins. For now, only iTunes & Spotify plugins exist. These plugins expose a `search` function which is used to search external metadata providers directly for music.

### Remote Metadata Lookups

Hydrabase nodes can query their peers to lookup metadata for them. This will trigger a local lookup on the peer's end with the results relayed.

### Confidence Scoring
A score is calculated that represents your confidence/trust in a peer's response. This aims to represent the odds that a peer is lying to you. Currently, this is calculated by comparing the results for plugins you and your peer share in common. A confidence score of 1 means that for all information you can verify, they always told the truth. While 0 means that all the results they gave you were inconsistent with what you can verify with a local lookup.

### Peer Reputation
Historic confidence scores of each peers' responses are kept track of. This will be used in the future to weigh votes when deciding on the "correct" response. Aka, peers that we have a longer history with are more trustworthy that newer peers.

### Identities
Each Hydrabase has it's own public key used to identify itself. This is currently used to de-duplicate peers and to avoid connecting to self. In the future identities will be used to permanently keep track of peer reputation.

### Cache Layer
Metadata discovered via API lookups is stored in a database. The cache layer for now is write-only, meaning songs, artists, and albums discovered via plugin lookups are cached, but this cache isn't used. In the future the cache will obviously be used. In the future the cache layer will also store peer responses so you can build up a database of metadata for songs that you normally wouldn't have access to.

### Future Plans
While everything listed above is working, Hydrabase is very incomplete. I scatter `TODO`s throughout the code, so if you're super curious, I've listed technical next-steps. But at a high level, most my focus is on improving the confidence scoring mechanism. The end goal is for peers running different plugins to benefit by exchanging api responses from different metadata providers.
