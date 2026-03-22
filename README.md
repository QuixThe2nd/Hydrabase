<h1 align="center">Hydrabase - Beta</h1>
<p align="center">Hydrabase is web-of-trust inspired consensus-less distributed relational database. Hydrabase is a P2P network that acts as a unified source for music metadata.
</p>
<p align="center">
  <img src="./public/logo-black.svg">
</p>
<p align="center">
<img src="https://github.com/QuixThe2nd/Hydrabase/actions/workflows/docker-build-prod.yaml/badge.svg" />
<img src="https://github.com/QuixThe2nd/Hydrabase/actions/workflows/checks.yaml/badge.svg" />

## Why Hydrabase?

The core problem that Hydrabase aims to solve is making music metadata available to the masses. Currently, music metadata is gatekept and paywalled by certain greedy music companies. Hydrabase solves this by allowing users to distribute information they have access to that others might not. Hydrabase's entire purpose is to estimate the accuracy of metadata you wouldn't normally have access to.

## What is Hydrabase?

Hydrabase is a peer to peer (p2p) network of computers that continuously vote on things, letting applications read from shared state with probabilistic certainty instead of chain-style finality.

Hydrabase aims to source and organise music metadata across all peers in the network similar to how BitTorrent's DHT indexes torrent metadata. What makes Hydrabase powerful is that anyone can create a plugin and make new types of metadata available to the entire network.

## How does it work?

Peers that consistently vote in line with what you observe first-hand earn higher trust. Trust amplifies their future votes, where confidence in a value increases as more peers independently confirm it. Real data enters the system through real software ([SoulSync](https://github.com/Nezreka/SoulSync)) used by real people.

Hydrabase creates a shared knowledge base that doesn't need finality. Without finality, we don't need to rely on proof of work or proof of stake limitations. Proof of vote, creates a whole new paradigm where consensus isn't required and instead your confidence in a value is probabilistic. The most obvious benefit of this is no-fees.

## Install

### Port Forwarding

Manually forward port 4545 (TCP & UDP) if you can. Without port forwarding, you won't be able to connect to connect to other peers who don't port forward.

### Config

All config is listed in the docker compose file. Hydrabase works out of the box with 0 config. Though consider setting a username and enabling Spotify.

### Docker

The compose file is available [here](https://raw.githubusercontent.com/QuixThe2nd/Hydrabase/refs/heads/main/compose.yaml).

### Manual

To install:

```bash
git clone https://github.com/QuixThe2nd/Hydrabase
cd Hydrabase
bun install
```

To run:

```bash
bun start
```

## Networking

Hydrabase uses both TCP & UDP (default: 4545):

```
TCP: 4545 (WebSocket)
UDP: 4545 (DHT)
```

Hydrabase will automatically try to port forward using uPnP. For best connectability, I recommend manually port forwarding both. However technically, only TCP is required for Hydrabase to work, though performance may be worse without UDP port forwarded.

When setting `PREFER_TRANSPORT`, you only change the transport for connections you initiate, not on ones initiated by other peers. If UDP is selected, TCP is still used to handle authentication. A proper UDP-only mode for those with restricted networks is planned.

## API Documentation

### 1. Connection & Authentication

To make an API request, you need to connect to a Hydrabase node via WebSocket. Connect to `ws://ip_address:4545` with the `x-api-key` header set.

### 2. Requests

Once connected to a node, you can trigger searches by sending a message structured like so:

```jsonc
{
  "request": {
    "type": "artists", // "artists" | "tracks" | "albums"
    "query": "black eyed peas"
  },
  "nonce": 0
}
```

Nonces are optional but recommended, they can be any number, but should be unique to that request. That way when the server responds, you know which request it's for:

```jsonc
{
  "response": [
    {
      "name": "Black Eyed Peas",
      "soul_id": "soul_202144721720576658",
      "id": "360391",
      "plugin_id": "iTunes",
      "confidence": 1
      // ...
    },
    {
      "name": "Black Eyed Peas",
      "soul_id": "soul_2038199553408899024",
      "id": "1yxSLGMDHlW21z4YXirZDS",
      "plugin_id": "Spotify",
      "confidence": 0.83
      // ...
    }
  ],
  "nonce": 0
}
```

### 3. Lookups

To lookup items, the query must be the Soul ID:

```jsonc
{
  "request": {
    "type": "artist.tracks", // "artist.albums" | "artist.tracks" | "album.tracks"
    "query": "soul_202144721720576658"
  },
  "nonce": 1
}
```

## How it Works

As Hydrabase is under active development, this section will be incomplete. Here is what is currently functional:

### Peer Discovery

#### DHT

Hydrabase nodes connect to BitTorrent's DHT network and query it for an infohash of a torrent that doesn't exist, then announce that they're seeding it. This infohash can be anything, as long as all peers use the same one. This allows for peers to find each other without a centralised tracker or signalling server.

#### Gossip Network

Each time 2 Hydrabase nodes create a connection, they announce each other to all known peers and also announce all known peers to the new peer. This acts as a more reliable peer discovery network, using DHT as a bootstrap network. After your first connection, you'll rapidly connect to all other peers.

### Local Metadata Lookups

Hydrabase nodes can run plugins. For now, only iTunes & Spotify plugins exist. These plugins expose search functions which are used to search external metadata providers directly for music.

### Remote Metadata Lookups

Hydrabase nodes can query their peers to lookup metadata for them. This will trigger a local lookup on the peer's end with the results relayed.

### Identities

Each Hydrabase node has its own public key used to identify itself. This is used both for reputation and to de-duplicate connections and avoid connecting to itself.

### Peer Reputation

Historic peer responses are kept track of, like a ledger of votes. The confidence we have in a peer is calculated as a score between 0-1, 0 meaning "I've only ever seen them lie" and 1 meaning "I've only ever seen them tell the truth." This score is used to weigh votes when deciding on the "correct" response. Aka, peers that we have a longer history with are more trustworthy that newer peers.

### Result Confidence

Each API response includes a confidence score. This score represents how trustworthy that individual result is. That confidence score is derived from a series of sub-confidence scores such as peer scores.

To break this down, lets say a peer with a confidence score of 0.8 votes that the track id of a song is xxxxx with 0.9 certainty, the confidence in that id is 0.72. If a later lookup that involves that ID, and that lookup from a peer with a 0.95 reputation and 0.4 confidence (0.38 score) relies on that id, the confidence in the lookup will be 0.2736.

The formulas used to derive these numbers are configurable. A threshold can then be set by applications integrating Hydrabase defining minimum scores allowed for different types of information, to avoid trusting results with a 0.2736 score.

### Cache Layer

Metadata discovered via API lookups and other peers is stored in a database. When queried, Hydrabase will query your local cache, any configured plugins, and peers. When a peer receives a request, they will only search their local cache and plugins, they won't relay to other peers.

### Transport Layer

Hydrabase connections are made via either a WebSocket connection (TCP, both sides require port forwarding), or via the DHT network (UDP, only one side needs to port forward). While TCP is more stable and the default, Hydrabase will automatically fallback to UDP if the TCP connection fails. You can optionally configure your node to prefer UDP, which will cause your node to try UDP first when initiating connections. 

### Future Plans

While everything listed above is working, Hydrabase is incomplete. I scatter `TODO`s throughout the code, so if you're super curious, I've listed technical next-steps.

The major flaws currently that I need to address include:
- Time is not taken into account when calculating reputation
- Soul ID implementation is incomplete
- Human feedback not yet possible

## Versioning

### Protocol Versioning

A Hydrabase Improvement Proposals (HIP) defines hows peers communicate with each other, they're essentially API specifications/capabilities. Each new type of communication uses a new HIP number (HIP1, HIP2, etc). For example, HIP2 defines how request/response messages are structured, and HIP3 defines how peers authenticate each other. Currently, I am rapidly iterating on Hydrabase, so HIPs are changing, however, once ready for production, HIPs will be immutable. Once immutable, if the authentication protocol needs updating, HIP3v2 will be created.

### Application Versioning

v**MAJOR.MINOR.PATCH**:

- MAJOR = Protocol breaking (wire-incompatible, peers must upgrade)
- MINOR = Protocol additive OR app breaking (with clear changelog)
- PATCH = App-level fixes/updates

<!-- ![Star History Chart](https://api.star-history.com/image?repos=QuixThe2nd/Hydrabase&type=date&legend=top-left) -->
