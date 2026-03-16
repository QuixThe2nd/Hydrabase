# Task: Clean Up Basic Warnings

## Issue 1: WebSocket Reconnection Spam

**Problem:** A connected peer (ggtothemax at 49.186.157.224) keeps initiating new WebSocket connections every ~15 seconds. The server correctly authenticates them and logs "Skipping duplicate connection" but the CLIENT keeps retrying.

**Root cause:** The WebSocket client doesn't check if it already has an active connection to a peer before initiating a new one. The server-side duplicate check works, but the client wastes bandwidth and fills logs.

**Fix location:** `src/backend/PeerManager.ts` or wherever WebSocket client connections are initiated.

**Fix:** Before calling `toSocket()` or initiating a WS connection, check if a connection to that peer address already exists in the active peers/connections map. If already connected, skip silently. Also check `ws/server.ts` — the `handleConnection` function should return early before `Upgrade failed` if the peer is already connected.

**Also:** The first connection attempt from a NATted peer succeeds auth but returns "Upgrade failed" (`Rejected connection with client ... for reason: Upgrade failed`). The second attempt works. Look at why the server upgrade response fails on the first WebS auth — likely because `verifyClient` returns success but the WebSocket upgrade has already been rejected by then (10s timeout waiting for HTTP callback).

## Issue 2: Unexpected Payload for `hydra__auth` UDP Query

**Problem:** When a peer sends a UDP auth query (`q: "hydra__auth"`), the message handler hits the `QueryMessage` Zod schema which uses `.strict()`. The auth query has fields like `address`, `hostname`, `signature`, `userAgent`, `username` in the `a` field, which aren't in the standard DHT query schema.

**Log:**
```
Unexpected payload { err: ZodError: [{ "code": "unrecognized_keys", "keys": ["address", "hostname", "signature", "userAgent", "username"], ...
```

**Fix:** Add a Hydrabase auth query schema variant to the `rpcMessageSchema` union, or handle `hydra__auth` queries before they hit the strict DHT schema validation. The `a` field for hydra auth queries contains: `address`, `hostname`, `id`, `signature`, `userAgent`, `username`.

## Deliverables
- Fix client-side reconnection spam (check before connecting)
- Fix first-connection "Upgrade failed" for NATted peers if feasible  
- Handle `hydra__auth` UDP queries without Zod errors
- `tsc --noEmit` must pass
- Commit to `dev` branch
