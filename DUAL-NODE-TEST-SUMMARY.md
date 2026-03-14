# Dual-Node Connectivity Test Setup - Summary

## Overview

A complete, working dual-node connectivity test setup has been created for Hydrabase. Two isolated Docker containers can discover and connect to each other successfully with comprehensive testing scripts.

## What Was Created

### 1. Docker Compose Configurations

#### `docker-compose.test.yml`
- Basic dual-node setup
- Node1: `172.20.0.10:4545` (exposed as `localhost:4545`)
- Node2: `172.20.0.11:4545` (exposed as `localhost:4546`)
- Standard bootstrap configuration

#### `docker-compose.test-isolated.yml` ⭐ **Recommended**
- Isolated dual-node setup with mutual bootstrap
- Nodes configured to discover each other automatically
- No external dependencies required
- More reliable for testing

### 2. Test Scripts

#### `test-connectivity.sh`
Automated test with basic configuration
- Starts both nodes
- Verifies authentication endpoints
- Checks for peer connections
- Reports warnings/errors
- Auto-cleanup after 30 seconds

#### `test-connectivity-isolated.sh` ⭐ **Recommended**
Automated test with isolated configuration
- Uses mutual bootstrap (nodes discover each other)
- More comprehensive connection verification
- Checks peer caches
- Better error filtering
- Auto-cleanup after 30 seconds

#### `test-manual.sh`
Manual testing environment
- Keeps containers running indefinitely
- Streams logs in real-time
- Provides helpful inspection commands
- Manual cleanup on Ctrl+C

#### `validate-test-setup.sh`
Validation script
- Checks all required files exist
- Verifies executable permissions
- Validates Docker installation
- Checks port availability
- Confirms source code modifications

### 3. Documentation

#### `TESTING.md`
Comprehensive testing guide covering:
- All test scripts and their usage
- Configuration options
- Troubleshooting guide
- Advanced testing scenarios
- Inspection commands
- CI/CD integration

#### `TEST-SETUP.md`
Detailed setup documentation covering:
- Architecture overview
- Network configuration
- Testing connectivity methods
- Node state inspection
- Cleanup procedures

#### `DUAL-NODE-TEST-SUMMARY.md` (this file)
Quick reference and summary

## Changes Made to Source Code

### `src/backend/index.ts`
Added environment variable support for bootstrap configuration:

```typescript
bootstrapPeers: process.env['BOOTSTRAP_PEERS'] ?? 'ddns.yazdani.au:4545,ddns.yazdani.au:4544',
dht: {
  bootstrapNodes: process.env['DHT_BOOTSTRAP_NODES'] ?? 'router.bittorrent.com:6881,...',
  // ...
}
```

**Benefits:**
- Allows custom bootstrap peers via environment variables
- Enables isolated testing without external dependencies
- Maintains backward compatibility (uses defaults if not set)

### `Dockerfile`
Added curl for health checks:

```dockerfile
RUN apt-get update && apt-get install -y gosu curl && rm -rf /var/lib/apt/lists/*
```

**Benefits:**
- Enables health checks in docker-compose
- Allows verification that nodes are ready before testing
- Useful for debugging and manual testing

## Quick Start

### 1. Validate Setup

```bash
./validate-test-setup.sh
```

### 2. Run Automated Test (Recommended)

```bash
./test-connectivity-isolated.sh
```

### 3. Or Run Manual Test

```bash
./test-manual.sh
```

## Expected Results

### ✅ Successful Test Output

```
========================================
Test Summary
========================================

✓ Both nodes started successfully
✓ Authentication endpoints working
✓ Peer connections established

Node Information:
  Node1: Node1 (0x...) @ 172.20.0.10:4545 (localhost:4545)
  Node2: Node2 (0x...) @ 172.20.0.11:4545 (localhost:4546)

✓ Test completed successfully!
```

### 🔍 Connection Indicators

**In logs, you should see:**
- `[CLIENT] Connected to Node2 0x... ws://172.20.0.11:4545`
- `[RPC] Connecting to peer 172.20.0.11:4545`
- `[SERVER] Received connection from Node1 0x...`

**In peer caches:**
- `data/ws-servers.json` contains peer hostnames
- `data/authenticated-peers.json` contains peer identities

## Network Architecture

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

## Key Features

### ✅ Isolated Testing
- Completely isolated Docker network
- No external dependencies required (with isolated config)
- Predictable IP addresses

### ✅ Automatic Discovery
- Nodes configured to bootstrap from each other
- Automatic peer discovery via DHT and WebSocket
- Fallback to UDP/RPC if WebSocket fails

### ✅ Comprehensive Verification
- Health checks ensure nodes are ready
- Authentication endpoint verification
- Connection log analysis
- Peer cache inspection
- Warning/error filtering

### ✅ No Warnings (Clean Output)
- Filters expected external connection warnings
- Only shows unexpected errors
- Clean, readable output

### ✅ Easy Cleanup
- Automatic cleanup after tests
- Manual cleanup with Ctrl+C
- Removes all test data and containers

## Troubleshooting

### Ports Already in Use

```bash
# Check what's using the ports
lsof -i :4545
lsof -i :4546

# Kill processes or change ports in docker-compose files
```

### Nodes Won't Connect

```bash
# Check network connectivity
docker exec hydrabase-node1 ping -c 3 172.20.0.11

# Manually trigger connection
docker exec hydrabase-node2 curl http://172.20.0.10:4545/auth

# View detailed logs
docker-compose -f docker-compose.test-isolated.yml logs -f
```

### Docker Issues

```bash
# Rebuild without cache
docker-compose -f docker-compose.test-isolated.yml build --no-cache

# Clean up everything
docker-compose -f docker-compose.test-isolated.yml down -v
docker system prune -a
```

## Files Reference

| File | Purpose | Executable |
|------|---------|------------|
| `docker-compose.test.yml` | Basic dual-node config | - |
| `docker-compose.test-isolated.yml` | Isolated dual-node config ⭐ | - |
| `test-connectivity.sh` | Basic automated test | ✓ |
| `test-connectivity-isolated.sh` | Isolated automated test ⭐ | ✓ |
| `test-manual.sh` | Manual testing environment | ✓ |
| `validate-test-setup.sh` | Setup validation | ✓ |
| `TESTING.md` | Comprehensive testing guide | - |
| `TEST-SETUP.md` | Detailed setup documentation | - |
| `DUAL-NODE-TEST-SUMMARY.md` | This summary | - |
| `test-bootstrap-patch.diff` | Source code patch reference | - |

## Common Commands

```bash
# Validate setup
./validate-test-setup.sh

# Run automated test (recommended)
./test-connectivity-isolated.sh

# Run manual test
./test-manual.sh

# View logs
docker-compose -f docker-compose.test-isolated.yml logs -f

# Check node status
curl http://localhost:4545/auth | jq
curl http://localhost:4546/auth | jq

# Inspect peer caches
docker exec hydrabase-node1 cat /app/data/ws-servers.json | jq
docker exec hydrabase-node2 cat /app/data/ws-servers.json | jq

# Cleanup
docker-compose -f docker-compose.test-isolated.yml down -v
rm -rf test-data/
```

## CI/CD Integration

```yaml
# Example GitHub Actions workflow
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Validate setup
        run: ./validate-test-setup.sh
      - name: Run connectivity test
        run: ./test-connectivity-isolated.sh
```

## Next Steps

1. **Run the validation:**
   ```bash
   ./validate-test-setup.sh
   ```

2. **Run the isolated test:**
   ```bash
   ./test-connectivity-isolated.sh
   ```

3. **Explore manually:**
   ```bash
   ./test-manual.sh
   ```

4. **Read the documentation:**
   - `TESTING.md` - Comprehensive testing guide
   - `TEST-SETUP.md` - Detailed setup documentation

## Support

- Check `TESTING.md` for troubleshooting
- View logs: `docker-compose -f docker-compose.test-isolated.yml logs`
- Open an issue on GitHub with logs and configuration

## Summary

✅ **Complete dual-node test setup created**
✅ **Nodes can discover and connect automatically**
✅ **Comprehensive test scripts provided**
✅ **Clean output with no unexpected warnings**
✅ **Full documentation included**
✅ **Ready for CI/CD integration**

**Recommended test:** `./test-connectivity-isolated.sh`
