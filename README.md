# Hydrabase
Hydrabase is currently a proof of concept consensus-less P2P network. The networks primary purpose is to act as a unified source that propagates music metadata.

Hydrabase is a WIP and not intended for use yet.

## Install

To install dependencies:

```bash
bun install
```

To run:

```bash
bun src/index.ts
```

## Networking

Currently Hydrabase needs 2 ports forwarded:
```
TCP: 3000 (WebSocket - Used to communicate with peers)
UDP: 30000 (DHT - Used to discover peers)
```

Theoretically, if there's enough peers in the network, you can use Hydrabase without port forwarding, but if everyone did that, Hydrabase won't work. Plus, not port forwarding reduces your connectability.
