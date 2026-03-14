# Fix RPC Authentication Port Bug

## Problem Description

**Critical bug:** RPC authentication uses ephemeral UDP source port instead of configured node listening port.

**Symptoms:**
- Node advertises wrong port during P2P authentication (e.g., 12972 instead of 4545)
- Peer discovery fails because other nodes can't authenticate back
- WebUI shows 0 connected peers despite node being online
- Logs show authentication failures due to port mismatches

## Root Cause Analysis

**File:** `src/backend/networking/rpc.ts`
**Function:** `handlers.auth` (line ~104)

**Bug:**
```typescript
const identity = await verifyClient(node, { 
  address: query.a?.['address']?.toString() as `0x${string}`, 
  hostname: `${peer.host}:${peer.port}`,  // <-- BUG: Uses socket peer info
  signature: query.a?.['signature']?.toString() ?? '', 
  userAgent: query.a?.['userAgent']?.toString() ?? '', 
  username: query.a?.['username']?.toString() ?? '' 
}, ...)
```

**What happens:**
1. Client connects UDP from local port 4545 to remote peer
2. OS assigns ephemeral source port (e.g., 12972)  
3. Server receives UDP packet with `peer.host:peer.port` = `49.186.30.234:12972`
4. **BUG:** Server overwrites client's claimed hostname with socket peer info
5. Authentication verification uses wrong hostname
6. Peer tries to authenticate back to port 12972 instead of 4545
7. Connection fails

## Solution

**Replace socket peer info with client's claimed hostname:**

```typescript
const identity = await verifyClient(node, { 
  address: query.a?.['address']?.toString() as `0x${string}`, 
  hostname: query.a?.['hostname']?.toString() ?? `${peer.host}:${peer.port}`,  // Use client's claim first
  signature: query.a?.['signature']?.toString() ?? '', 
  userAgent: query.a?.['userAgent']?.toString() ?? '', 
  username: query.a?.['username']?.toString() ?? '' 
}, ...)
```

**Validation:** The `verifyClient` function already validates that the hostname matches the signature and performs reverse authentication, so trusting the client's claimed hostname is safe.

## Testing

**Before fix:**
- WebUI shows 0 peers
- Logs show port mismatches (12972 vs 4545)
- P2P connections fail

**After fix:**
- Peers should connect successfully
- WebUI should show connected peers count > 0
- Authentication should use correct listening ports

## Files to Change

1. `src/backend/networking/rpc.ts` - Fix hostname assignment in auth handler

## Implementation Notes

- Keep fallback to socket peer info for cases where hostname is not provided
- Ensure backward compatibility with older clients
- The verification logic already handles hostname validation safely