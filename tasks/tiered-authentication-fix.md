# Tiered Authentication Fix for NAT Clients

## Problem Analysis

### Current Security-Breaking Hack
The existing NAT workaround in `handshake.ts:verifyClient` silently accepts unverified hostname claims when reverse authentication fails:

```typescript
if (isConnectionError) {
  return resolve(true)  // Accepts unverified hostname claim
}
```

### Security Vulnerabilities Enabled
1. **Hostname spoofing**: Attackers can claim any unreachable hostname (including legitimate nodes behind NAT)
2. **Disinformation propagation**: False hostname mappings get broadcast to other peers via `announce()`
3. **Guaranteed bypass**: Any attacker can trigger this by claiming unreachable hostnames

### Root Cause: Conflated Authentication Concerns
HIP1/HIP3 protocol treats two separate concerns as atomic:
- **Identity verification** (cryptographic): "Prove you hold private key for address X"
- **Reachability verification** (network): "Prove you control hostname Y"

When reachability fails, the protocol has no degradation path and currently chooses security over functionality.

## Solution: Tiered Authentication Model

### Core Principle
**Accept verified identity, mark unverified reachability.**

NATted peers are **client-only peers** - they can connect out and exchange data but cannot accept incoming connections. The protocol should reflect this reality rather than either rejecting them or accepting false claims.

### Two-Tier Authentication Levels

#### Tier 1: Identity Verification (Always Required)
- Client signs `"I am connecting to {server_hostname:port}"` with secp256k1 private key
- Server verifies signature matches claimed address via ECDSA recovery
- **Works through NAT** - uses existing outbound connection
- **Proves**: Client holds private key for claimed address
- **Prevents**: Address spoofing, replay attacks (server hostname binding)

#### Tier 2: Hostname Verification (Best Effort)
- Server attempts reverse connection to client's claimed hostname
- On success: Full bidirectional peer with verified hostname
- On failure: Client-only peer with unverified hostname
- **Prevents**: Hostname spoofing, network topology pollution

## Implementation

### 1. Extend Identity Type System

**File: `src/backend/protocol/HIP1/handshake.ts`**

```typescript
// Extend existing Identity type to track hostname verification status
export interface VerifiedIdentity extends Identity {
  hostnameVerified: true
}

export interface UnverifiedIdentity extends Identity {
  hostnameVerified: false
  clientOnly: true
}

export type PeerIdentity = VerifiedIdentity | UnverifiedIdentity

// Update AuthSchema to support verification status
export const AuthSchema = IdentitySchema.extend({
  signature: z.string(),
  hostnameVerified: z.boolean().default(false)
})
```

### 2. Fix verifyClient Security Hole

**File: `src/backend/protocol/HIP1/handshake.ts`**

```typescript
export const verifyClient = async (
  node: Config['node'], 
  auth: Auth | { apiKey: string }, 
  apiKey: false | string, 
  serverAuthenticator?: (hostname: `${string}:${number}`) => Promise<[number, string] | Identity>
): Promise<[number, string] | PeerIdentity> => {
  
  if ('apiKey' in auth) {
    // API key authentication unchanged
    if (auth.apiKey !== apiKey) return [500, 'Invalid API Key']
    return { 
      address: '0x0', 
      hostname: 'API:4545', 
      userAgent: `Hydrabase-API/${VERSION}`, 
      username: node.username,
      hostnameVerified: true
    }
  }

  // Step 1: Always verify identity (works through NAT)
  debug(`[HIP3] Verifying client identity ${auth.username} ${auth.address}`)
  if (!Signature.fromString(auth.signature).verify(`I am connecting to ${node.hostname}:${node.port}`, auth.address)) {
    return [403, 'Failed to authenticate address']
  }

  // Step 2: Attempt hostname verification (may fail for NAT clients)
  const authenticate = serverAuthenticator ?? authenticateServer
  
  try {
    const hostnameAuth = await authenticate(auth.hostname)
    
    if (Array.isArray(hostnameAuth)) {
      // Reverse authentication failed
      if (isConnectionError(hostnameAuth[1])) {
        // NAT/firewall - accept as client-only peer
        log(`[HIP3] Client ${auth.username} ${auth.address} accepted as client-only — ` +
            `hostname ${auth.hostname} unverified (NAT/firewall)`)
        
        return {
          ...auth,
          hostnameVerified: false,
          clientOnly: true
        }
      } else {
        // Other authentication error - reject
        return hostnameAuth
      }
    }

    // Successful reverse authentication
    if (hostnameAuth.address !== auth.address) {
      warn('DEVWARN:', "[HIP3] Address mismatch", {
        expected: auth.address, 
        got: hostnameAuth.address
      })
      return [500, 'Address mismatch in hostname verification']
    }

    log(`[HIP3] Client ${auth.username} ${auth.address} fully verified`)
    return {
      ...auth,
      hostnameVerified: true,
      clientOnly: false
    }

  } catch (error) {
    return [500, `Hostname verification failed: ${error.message}`]
  }
}

// Helper function to detect connection errors
const isConnectionError = (errorMessage: string): boolean => {
  const connectionErrors = [
    'Unable to connect',
    'Connection refused', 
    'Connection timed out',
    'Network unreachable',
    'Host unreachable'
  ]
  return connectionErrors.some(pattern => errorMessage.includes(pattern))
}
```

### 3. Prevent Unverified Hostname Propagation

**File: `src/backend/PeerManager.ts`**

```typescript
private announce(peer: Socket): void {
  // Only announce peers with verified hostnames
  if ('hostnameVerified' in peer.peer && !peer.peer.hostnameVerified) {
    debug(`[PEERS] Skipping announce for client-only peer ${peer.peer.username} (unverified hostname)`)
    return
  }

  // Existing announcement logic for verified peers
  for (const peerAddress of this.peerAddresses) {
    this.rpc.query(peerAddress, {
      a: { 
        address: peer.peer.address,
        hostname: peer.peer.hostname,
        username: peer.peer.username
      },
      q: `${this.dhtConfig.rpcPrefix}_announce`
    }, (err) => {
      if (err) debug(`[PEERS] Failed to announce to ${peerAddress}: ${err.message}`)
    })
  }
}
```

### 4. Update Peer Caching Logic

**File: `src/backend/PeerManager.ts`**

```typescript
private updateServerCache(): void {
  // Only cache verified hostnames to ws-servers.json
  const verifiedServers = [...this.peers.values()]
    .filter(socket => 
      'hostnameVerified' in socket.peer && 
      socket.peer.hostnameVerified === true
    )
    .map(socket => socket.peer.hostname)

  this.cacheFile.write(JSON.stringify(verifiedServers))
}
```

### 5. Client-Side Awareness (Optional Enhancement)

**File: `src/backend/networking/ws/client.ts`**

```typescript
// After successful authentication, server can notify client of their status
interface AuthStatusMessage {
  type: 'auth_status'
  hostnameVerified: boolean
  clientOnly: boolean
}

// Client can adjust behavior based on verification status
private handleAuthStatus(message: AuthStatusMessage): void {
  if (message.clientOnly) {
    debug(`[CLIENT] Operating in client-only mode (behind NAT/firewall)`)
    // Skip trying to announce self to DHT, etc.
  } else {
    debug(`[CLIENT] Full peer status - hostname verified`)
  }
}
```

## Security Analysis

### What This Preserves
- **Identity verification**: Always cryptographically verified for all peers
- **Replay protection**: Signatures include target hostname  
- **Address authenticity**: Only verified private key holders accepted
- **Network integrity**: No false hostname propagation

### What This Improves  
- **NAT compatibility**: NATted clients can connect and participate
- **Attack surface reduction**: Eliminates hostname spoofing vector
- **Network topology accuracy**: Only reachable hostnames propagated
- **Clear security model**: Explicit verification status tracking

### Attack Scenarios Addressed
1. **Hostname spoofing**: Unverified hostnames not propagated to network
2. **False peer announcements**: Client-only peers don't get announced
3. **Network pollution**: Unreachable hostnames don't enter peer caches
4. **Address spoofing**: Still prevented by identity verification

## Testing Requirements

### 1. Compatibility Testing
- **Public ↔ Public**: Both peers should achieve full verification  
- **Public ↔ NAT**: NAT peer should connect as client-only
- **NAT ↔ NAT**: Both peers should connect as client-only (if initiated)

### 2. Security Testing
- **Spoofing attempts**: Verify unverified hostnames not propagated
- **Cache integrity**: Verify only verified hostnames cached
- **Identity bypass**: Verify identity verification still mandatory

### 3. Functionality Testing  
- **Data exchange**: Client-only peers should send/receive data normally
- **DHT participation**: Client-only peers should participate in DHT queries
- **Peer discovery**: Client-only peers should discover other peers

## Migration Strategy

### Phase 1: Security Fix (Immediate)
- Deploy tiered authentication with hostname verification flags
- Client-only peers accepted but not announced
- Zero breaking changes to existing verified peers

### Phase 2: Client Optimization (Future)
- Notify clients of their verification status
- Client-only peers optimize behavior (no self-announcement attempts)
- Add client-only indicators in WebUI/logging

### Phase 3: Advanced NAT Support (Future)
- UDP hole punching via DHT rendezvous
- Relay protocol for client-only peer reachability
- Web-of-trust hostname verification via mutual peers

## Expected Results

**After Implementation:**
```
# NAT client connection logs:
2026-03-15T13:19:29.267Z DEBUG: [HIP3] Verifying client identity Claw 0x00789fb5...
2026-03-15T13:19:29.268Z DEBUG: [HIP3] Identity verified for Claw 0x00789fb5...  
2026-03-15T13:19:29.269Z DEBUG: [HIP3] Reverse auth failed due to connectivity
2026-03-15T13:19:29.270Z LOG: [HIP3] Client Claw accepted as client-only — hostname unverified (NAT/firewall)
2026-03-15T13:19:29.271Z DEBUG: [PEERS] Skipping announce for client-only peer Claw
```

**WebUI Changes:**
- Peer count includes NAT clients
- Client-only peers marked with indicator
- Network topology shows only verified/reachable peers

---

## Summary

This implements a **security-preserving NAT compatibility fix** that:
- ✅ Enables NATted client participation  
- ✅ Maintains cryptographic identity verification
- ✅ Prevents hostname spoofing attacks
- ✅ Preserves network topology integrity
- ✅ Zero breaking changes for existing verified peers
- ✅ Clear upgrade path for future NAT traversal features

**The fix is approximately 50 lines of code across 3 files with comprehensive security analysis and testing requirements.**