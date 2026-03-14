# Hydrabase Testing Guide

This guide covers the dual-node connectivity test setup for Hydrabase.

## Overview

The test environment provides isolated Docker containers that can discover and connect to each other, allowing you to verify peer-to-peer connectivity without external dependencies.

## Test Scripts

### 1. Automated Connectivity Test (Basic)

**File:** `test-connectivity.sh`

Tests basic dual-node setup with standard configuration.

```bash
./test-connectivity.sh
```

**Features:**
- Uses default bootstrap configuration
- Tests WebSocket and UDP/RPC connectivity
- Automatic cleanup after 30 seconds
- Comprehensive error checking

**Use when:** You want a quick verification that nodes can start and communicate.

---

### 2. Isolated Connectivity Test (Recommended)

**File:** `test-connectivity-isolated.sh`

Tests dual-node setup with mutual bootstrap configuration (nodes bootstrap from each other).

```bash
./test-connectivity-isolated.sh
```

**Features:**
- Nodes configured to bootstrap from each other
- Completely isolated from external networks
- More reliable peer discovery
- Detailed connection verification
- Checks peer caches

**Use when:** You want to test peer discovery in a controlled, isolated environment.

---

### 3. Manual Testing Environment

**File:** `test-manual.sh`

Starts nodes and keeps them running for interactive testing.

```bash
./test-manual.sh
```

**Features:**
- Keeps containers running indefinitely
- Streams logs in real-time
- Provides helpful commands for inspection
- Manual cleanup on Ctrl+C

**Use when:** You want to manually explore node behavior and test specific scenarios.

---

## Docker Compose Files

### docker-compose.test.yml

Basic dual-node configuration with standard settings.

**Network:** `172.20.0.0/24`
- Node1: `172.20.0.10:4545` → `localhost:4545`
- Node2: `172.20.0.11:4545` → `localhost:4546`

### docker-compose.test-isolated.yml

Isolated dual-node configuration with mutual bootstrap.

**Network:** `172.20.0.0/24`
- Node1: `172.20.0.10:4545` → `localhost:4545` (bootstraps from Node2)
- Node2: `172.20.0.11:4545` → `localhost:4546` (bootstraps from Node1)

**Environment Variables:**
- `BOOTSTRAP_PEERS`: Comma-separated list of peer addresses
- `DHT_BOOTSTRAP_NODES`: Comma-separated list of DHT bootstrap nodes

---

## Quick Start

### Run Automated Test

```bash
# Basic test
./test-connectivity.sh

# Or isolated test (recommended)
./test-connectivity-isolated.sh
```

### Manual Testing

```bash
# Start nodes
./test-manual.sh

# In another terminal, run commands:
curl http://localhost:4545/auth | jq
curl http://localhost:4546/auth | jq

# Check peer connections
docker exec hydrabase-node1 cat /app/data/ws-servers.json | jq
docker exec hydrabase-node2 cat /app/data/ws-servers.json | jq
```

---

## What to Expect

### Successful Connection Indicators

1. **Health Checks Pass**
   ```
   ✓ Both nodes started successfully
   ✓ Authentication endpoints working
   ```

2. **Connection Logs**
   - WebSocket: `[CLIENT] Connected to Node2 0x... ws://172.20.0.11:4545`
   - RPC: `[RPC] Connecting to peer 172.20.0.11:4545`
   - Server: `[SERVER] Received connection from Node1 0x...`

3. **Peer Caches**
   - `data/ws-servers.json` contains peer hostnames
   - `data/authenticated-peers.json` contains peer identities

### Expected Warnings (Can Be Ignored)

These warnings are normal and can be safely ignored:

- `Failed to fetch server authentication from ddns.yazdani.au` - External bootstrap servers
- `ECONNREFUSED` / `ENOTFOUND` for external DHT nodes
- `router.bittorrent.com`, `router.utorrent.com`, `dht.transmissionbt.com` connection failures
- `An error occurred during announce` - DHT announce to external nodes
- `icanhazip.com` connection issues (IP detection)

---

## Configuration Changes

### Enable Environment Variable Bootstrap

The following change has been made to support configurable bootstrap peers:

```typescript
// src/backend/index.ts
bootstrapPeers: process.env['BOOTSTRAP_PEERS'] ?? 'ddns.yazdani.au:4545,ddns.yazdani.au:4544',
dht: {
  bootstrapNodes: process.env['DHT_BOOTSTRAP_NODES'] ?? 'router.bittorrent.com:6881,...',
  // ...
}
```

This allows you to set bootstrap peers via environment variables:

```yaml
environment:
  BOOTSTRAP_PEERS: "172.20.0.10:4545,172.20.0.11:4545"
  DHT_BOOTSTRAP_NODES: "172.20.0.10:4545,172.20.0.11:4545"
```

---

## Troubleshooting

### Nodes Won't Start

**Problem:** Containers fail health checks

**Solutions:**
1. Check if ports are in use:
   ```bash
   lsof -i :4545
   lsof -i :4546
   ```

2. View logs:
   ```bash
   docker-compose -f docker-compose.test.yml logs
   ```

3. Rebuild image:
   ```bash
   docker-compose -f docker-compose.test.yml build --no-cache
   ```

---

### Nodes Won't Connect

**Problem:** No peer connections established

**Solutions:**
1. Verify network connectivity:
   ```bash
   docker exec hydrabase-node1 ping -c 3 172.20.0.11
   docker exec hydrabase-node2 ping -c 3 172.20.0.10
   ```

2. Check authentication endpoints:
   ```bash
   docker exec hydrabase-node1 curl http://172.20.0.11:4545/auth
   docker exec hydrabase-node2 curl http://172.20.0.10:4545/auth
   ```

3. Manually trigger connection:
   ```bash
   # This should trigger peer discovery
   docker exec hydrabase-node2 curl http://172.20.0.10:4545/auth
   ```

4. Check logs for connection attempts:
   ```bash
   docker-compose -f docker-compose.test.yml logs | grep -i "connect"
   ```

---

### Too Many Warnings

**Problem:** Logs show many warnings

**Solutions:**
1. Use isolated test configuration (filters external connection attempts)
2. Set `REQUIRE_DHT_CONNECTION: "false"` to skip external DHT
3. Filter logs:
   ```bash
   docker-compose -f docker-compose.test.yml logs | grep -v "ECONNREFUSED"
   ```

---

## Advanced Testing

### Test UDP-Only Mode

Modify `PREFER_TRANSPORT` in docker-compose file:

```yaml
environment:
  PREFER_TRANSPORT: UDP
```

### Test with DHT Required

Enable DHT requirement:

```yaml
environment:
  REQUIRE_DHT_CONNECTION: "true"
```

Note: This will cause delays as nodes try to connect to external DHT.

### Test Different Network Configurations

Change subnet in docker-compose file:

```yaml
networks:
  hydratest:
    ipam:
      config:
        - subnet: 192.168.100.0/24
```

Update node IPs accordingly.

---

## Inspection Commands

### View Node Status

```bash
# Authentication info
curl http://localhost:4545/auth | jq
curl http://localhost:4546/auth | jq

# Peer caches
docker exec hydrabase-node1 cat /app/data/ws-servers.json | jq
docker exec hydrabase-node2 cat /app/data/ws-servers.json | jq

# DHT nodes
docker exec hydrabase-node1 cat /app/data/dht-nodes.json | jq
docker exec hydrabase-node2 cat /app/data/dht-nodes.json | jq

# Authenticated peers
docker exec hydrabase-node1 cat /app/data/authenticated-peers.json | jq
docker exec hydrabase-node2 cat /app/data/authenticated-peers.json | jq
```

### View Logs

```bash
# All logs
docker-compose -f docker-compose.test.yml logs

# Follow logs
docker-compose -f docker-compose.test.yml logs -f

# Specific node
docker-compose -f docker-compose.test.yml logs node1
docker-compose -f docker-compose.test.yml logs node2

# Filter logs
docker-compose -f docker-compose.test.yml logs | grep -i "connect"
docker-compose -f docker-compose.test.yml logs | grep -i "peer"
docker-compose -f docker-compose.test.yml logs | grep -i "dht"
```

### Execute Commands in Containers

```bash
# Interactive shell
docker exec -it hydrabase-node1 sh
docker exec -it hydrabase-node2 sh

# Run single command
docker exec hydrabase-node1 ls -la /app/data
docker exec hydrabase-node2 ps aux
```

---

## Cleanup

### Stop Containers

```bash
docker-compose -f docker-compose.test.yml down
docker-compose -f docker-compose.test-isolated.yml down
```

### Remove Test Data

```bash
rm -rf test-data/
```

### Complete Cleanup

```bash
# Stop and remove containers, networks, volumes
docker-compose -f docker-compose.test.yml down -v
docker-compose -f docker-compose.test-isolated.yml down -v

# Remove test data
rm -rf test-data/

# Remove Docker images (optional)
docker rmi hydrabase-node1 hydrabase-node2
```

---

## CI/CD Integration

The test scripts can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions
- name: Run connectivity tests
  run: |
    ./test-connectivity-isolated.sh
```

Exit codes:
- `0` - Success
- `1` - Failure

---

## Architecture

### Network Topology

```
┌─────────────────────────────────────┐
│   Docker Bridge Network             │
│   172.20.0.0/24                     │
│                                     │
│  ┌──────────────┐  ┌──────────────┐│
│  │   Node1      │  │   Node2      ││
│  │ 172.20.0.10  │◄─┤ 172.20.0.11  ││
│  │   :4545      │─►│   :4545      ││
│  └──────────────┘  └──────────────┘│
│         │                  │        │
└─────────┼──────────────────┼────────┘
          │                  │
          ▼                  ▼
    localhost:4545    localhost:4546
```

### Connection Flow

1. **Startup**
   - Nodes start and generate cryptographic identities
   - Health checks verify HTTP endpoints are responding
   - DHT nodes initialize (but don't require external connections)

2. **Discovery**
   - Nodes read bootstrap peers from environment variables
   - Attempt HTTP authentication with bootstrap peers
   - Exchange identity information and signatures

3. **Connection**
   - Establish WebSocket connection (TCP preferred)
   - Fallback to UDP/RPC if WebSocket fails
   - Cache successful connections for future use

4. **Communication**
   - Nodes can now exchange messages
   - Search requests can be forwarded to peers
   - Metadata votes can be shared

---

## Files Reference

| File | Purpose |
|------|---------|
| `test-connectivity.sh` | Basic automated test |
| `test-connectivity-isolated.sh` | Isolated automated test (recommended) |
| `test-manual.sh` | Manual testing environment |
| `docker-compose.test.yml` | Basic dual-node configuration |
| `docker-compose.test-isolated.yml` | Isolated dual-node configuration |
| `TEST-SETUP.md` | Detailed setup documentation |
| `TESTING.md` | This file |
| `test-bootstrap-patch.diff` | Patch for environment variable support |

---

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review logs: `docker-compose -f docker-compose.test.yml logs`
3. Refer to `TEST-SETUP.md` for detailed setup information
4. Open an issue on GitHub with logs and configuration

---

## Notes

- Nodes generate unique identities on first run (stored in `data/`)
- Test data is isolated per node (`test-data/node1`, `test-data/node2`)
- Network is completely isolated from external networks (except for IP detection)
- Health checks ensure nodes are ready before testing
- Automatic cleanup prevents port conflicts between test runs
