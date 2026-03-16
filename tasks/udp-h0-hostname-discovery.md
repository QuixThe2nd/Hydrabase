# Task: Add h0 hostname discovery to UDP handshake

## Objective
Add an h0/h0r discovery round to the UDP handshake, mirroring how TCP uses `GET /auth` to learn the server's canonical hostname before signing the h1 handshake. This fixes hostname mismatch failures (e.g. connecting to `localhost:4545` when server identifies as `ddns.yazdani.au:4545`).

## Context
TCP flow already handles this — `authenticateServerHTTP` fetches `/auth`, gets `proveServer()` response, and if `auth.hostname !== hostname`, recursively calls itself with the canonical hostname. UDP has no equivalent discovery step, so the client signs h1 to the wrong hostname and verification fails.

The pattern to follow is **exactly** what TCP does in `src/backend/networking/http.ts` lines 11-36: discover identity → check hostname → upgrade if needed → proceed.

## Files to modify

### 1. `src/backend/networking/udp/server.ts`

**Add h0/h0r schema types:**
```ts
const HandshakeDiscoverySchema = BaseMessage.extend({
  y: z.literal('h0')
}).strict()
const HandshakeDiscoveryResponseSchema = BaseMessage.extend({
  h0r: AuthSchema,
  y: z.literal('h0r')
}).strict()
```

**Add both to the discriminated union** in `rpcMessageSchema` (the `z.discriminatedUnion('y', [...])` array).

**Export the types:**
```ts
export type HandshakeDiscovery = z.infer<typeof HandshakeDiscoverySchema>
export type HandshakeDiscoveryResponse = z.infer<typeof HandshakeDiscoveryResponseSchema>
```

**Add h0 handler in `messageHandler`** (before the h1 handler):
```ts
if (query.y === 'h0') {
  debug(`[UDP] [HANDSHAKE] Received h0 discovery from ${peerHostname}`)
  socket.send(bencode.encode({ h0r: proveServer(peerManager.account, node), t: query.t, y: 'h0r' } satisfies HandshakeDiscoveryResponse), peer.port, peer.host)
  return true
}
```

**Add h0r to the messageHandler** (same place as h2 — it should only reach messageHandler if no awaiter matched, which means orphaned):
```ts
if (query.y === 'h0r') {
  debug(`[UDP] [HANDSHAKE] Received orphaned h0r from ${peerHostname}`)
  return false
}
```

### 2. `src/backend/networking/udp/client.ts`

**Rewrite `authenticateServerUDP`** to do h0 discovery first, then h1:

```ts
export const authenticateServerUDP = (server: UDP_Server, hostname: `${string}:${number}`, account: Account, node: Config['node']): Promise<[number, string] | Identity> => {
  const cache = authenticatedPeers.get(hostname)
  if (cache) return Promise.resolve(cache)
  return new Promise(resolve => {
    // Phase 1: h0 discovery — learn the server's canonical hostname
    const txnId = Buffer.alloc(4)
    txnId.writeUInt32BE(Math.floor(Math.random() * 0xFFFFFFFF))
    const t = txnId.toString('hex')
    debug(`[UDP] [CLIENT] h0 discovery to ${hostname} with txnId=${t}`)

    const timer = setTimeout(() => {
      server.cancelAwaiter(t)
      debug(`[UDP] [CLIENT] h0 timeout for ${hostname} txnId=${t}`)
      resolve([408, 'UDP h0 discovery timeout'])
    }, 10_000)

    server.awaitResponse(t, (msg) => {
      if (msg.y !== 'h0r') return false
      clearTimeout(timer)
      debug(`[UDP] [CLIENT] Received h0r from ${hostname}, server identifies as ${msg.h0r.hostname}`)

      // Hostname upgrade — same pattern as authenticateServerHTTP
      const canonicalHostname = msg.h0r.hostname as `${string}:${number}`
      if (canonicalHostname !== hostname) {
        debug(`[UDP] [CLIENT] Upgrading hostname from ${hostname} to ${canonicalHostname}`)
        // Recursive call with canonical hostname
        authenticateServerUDP(server, canonicalHostname, account, node).then(resolve)
        return true
      }

      // Hostname matches — proceed with h1 handshake
      doH1Handshake(server, hostname, account, node).then(resolve)
      return true
    })

    const [host, port] = hostname.split(':') as [string, `${number}`]
    server.socket.send(bencode.encode({ t, y: 'h0' }), Number(port), host)
    debug(`[UDP] [CLIENT] Sent h0 to ${host}:${port} txnId=${t}`)
  })
}
```

**Extract the current h1 logic into a `doH1Handshake` function:**
This is the existing h1/h2 handshake code from the current `authenticateServerUDP`, starting from `const txnId = Buffer.alloc(4)` through the h1 send/await. Keep all the existing h1/h2 logic intact — just move it to a separate function.

```ts
const doH1Handshake = (server: UDP_Server, hostname: `${string}:${number}`, account: Account, node: Config['node']): Promise<[number, string] | Identity> => {
  return new Promise(resolve => {
    // ... existing h1/h2 handshake code (current lines 17-52 of client.ts)
  })
}
```

**Update imports** — add `HandshakeDiscovery, HandshakeDiscoveryResponse` to the imports from `./server`.

## Constraints
- Do NOT modify `handshake.ts` (HIP1) — the h0 discovery is transport-level, not protocol-level
- Do NOT modify `PeerManager.ts`
- h0/h0r must use the same `t` (transaction ID) correlation as h1/h2
- h0 must be unsigned — it's a discovery request, not an auth step
- h0r contains `proveServer()` output (same as TCP's `/auth` endpoint)
- The recursive call pattern must match TCP's `authenticateServerHTTP` exactly

## Non-goals
- Not changing TCP/WebSocket flow
- Not adding h0 caching (authenticatedPeers cache handles repeated connects)
- Not changing DHT discovery

## Acceptance criteria
- [ ] h0/h0r message types parse correctly through `rpcMessageSchema`
- [ ] `authenticateServerUDP("localhost:4545")` upgrades to canonical hostname before h1
- [ ] Self-connect completes successfully (no signature mismatch)
- [ ] Normal peer connections still work (h0 → h0r → h1 → h2)
- [ ] Build passes: `bun build src/backend/index.ts --outdir /tmp/hydrabase-build --target bun`

## Validation
Run from the repo directory:
```bash
bun build src/backend/index.ts --outdir /tmp/hydrabase-build --target bun
```
Must exit 0 with no type errors.

## Notes for agent
- Look at `src/backend/networking/http.ts` lines 21-23 for the TCP hostname upgrade pattern — this is the reference implementation
- The `satisfies` keyword is used for type-safe bencode encoding — follow the existing pattern
- `proveServer` is imported from `../../protocol/HIP1/handshake` in server.ts — it's already available
- The awaiter system (`awaitResponse` / `cancelAwaiter`) is the UDP equivalent of HTTP request/response — h0 uses the same mechanism as h1
