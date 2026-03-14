# Hydrabase Dual-Node Connectivity Test Setup

This directory contains a complete test setup for verifying peer-to-peer connectivity between two isolated Hydrabase nodes running in Docker containers.

## Overview

The test setup creates two isolated Hydrabase nodes that can discover and connect to each other:

- **Node1**: Runs on `172.20.0.10:4545` (exposed as `localhost:4545`)
- **Node2**: Runs on `172.20.0.11:4545` (exposed as `localhost:4546`)

Both nodes run in an isolated Docker network (`172.20.0.0/24`) and can communicate with each other without external dependencies.

## Files

- `docker-compose.test.yml` - Docker Compose configuration for dual-node setup
- `test-connectivity.sh` - Automated test script that verifies connectivity
- `test-manual.sh` - Manual testing script for interactive exploration

## Quick Start

### Automated Testing

Run the automated connectivity test:

```bash
./test-connectivity.sh
```

This script will:
1. Clean up any previous test environment
2. Build the Docker image
3. Start both nodes
4. Wait for nodes to be healthy
5. Verify authentication endpoints
6. Check for peer connections
7. Report any warnings or errors
8. Display node information and access URLs
9. Clean up after 30 seconds (or on Ctrl+C)

### Manual Testing

For interactive testing and exploration:

```bash
./test-manual.sh
```

This script will:
1. Start both nodes
2. Display node information and available commands
3. Stream logs from both nodes
4. Keep containers running until you press Ctrl+C

## Architecture

### Network Configuration

- **Network**: `hydratest` (bridge network)
- **Subnet**: `172.20.0.0/24`
- **Node1 IP**: `172.20.0.10`
- **Node2 IP**: `172.20.0.11`

### Node Configuration

Both nodes are configured with:
- `REQUIRE_DHT_CONNECTION: false` - Allows startup without external DHT
- `PREFER_TRANSPORT: TCP` - Prefers WebSocket connections
- Unique usernames (Node1, Node2)
- Separate data directories
- Health checks for startup verification

## Testing Connectivity

### Method 1: WebSocket Connection

Nodes can connect via WebSocket (TCP):

```bash
# From Node2 to Node1
docker exec hydrabase-node2 curl http://172.20.0.10:4545/auth

# From Node1 to Node2
docker exec hydrabase-node1 curl http://172.20.0.11:4545/auth
```

### Method 2: UDP/RPC Connection

Nodes can also connect via UDP RPC protocol (automatic fallback).

### Verifying Connection

Check logs for connection messages:

```bash
# Node1 logs
docker-compose -f docker-compose.test.yml logs node1 | grep -i "connect"

# Node2 logs
docker-compose -f docker-compose.test.yml logs node2 | grep -i "connect"
```

Look for messages like:
- `[CLIENT] Connected to Node2 0x... ws://172.20.0.11:4545`
- `[RPC] Connecting to peer 172.20.0.10:4545`

## Inspecting Node State

### Check Authentication

```bash
# Node1
curl http://localhost:4545/auth | jq

# Node2
curl http://localhost:4546/auth | jq
```

### Check Peer Cache

```bash
# Node1 peers
docker exec hydrabase-node1 cat /app/data/ws-servers.json | jq

# Node2 peers
docker exec hydrabase-node2 cat /app/data/ws-servers.json | jq
```

### Check DHT Nodes

```bash
# Node1 DHT
docker exec hydrabase-node1 cat /app/data/dht-nodes.json | jq

# Node2 DHT
docker exec hydrabase-node2 cat /app/data/dht-nodes.json | jq
```

## Troubleshooting

### Nodes Won't Start

1. Check if ports are already in use:
   ```bash
   lsof -i :4545
   lsof -i :4546
   ```

2. View startup logs:
   ```bash
   docker-compose -f docker-compose.test.yml logs
   ```

### Nodes Won't Connect

1. Verify nodes are healthy:
   ```bash
   docker-compose -f docker-compose.test.yml ps
   ```

2. Check network connectivity:
   ```bash
   docker exec hydrabase-node1 ping -c 3 172.20.0.11
   docker exec hydrabase-node2 ping -c 3 172.20.0.10
   ```

3. Manually trigger connection:
   ```bash
   docker exec hydrabase-node2 curl http://172.20.0.10:4545/auth
   ```

### Connection Warnings

Some warnings are expected and can be ignored:
- `Failed to fetch server authentication from ddns.yazdani.au` - External bootstrap servers
- `ECONNREFUSED` or `ENOTFOUND` for external DHT nodes
- DHT announce errors when external nodes are unreachable

## Cleanup

### Stop and Remove Containers

```bash
docker-compose -f docker-compose.test.yml down
```

### Remove Test Data

```bash
rm -rf test-data/
```

### Complete Cleanup

```bash
docker-compose -f docker-compose.test.yml down -v
rm -rf test-data/
```

## Advanced Usage

### Custom Bootstrap Configuration

To test with custom bootstrap peers, modify the environment variables in `docker-compose.test.yml`:

```yaml
environment:
  # Add custom bootstrap peers
  BOOTSTRAP_PEERS: "172.20.0.10:4545,172.20.0.11:4545"
```

Note: This requires modifying the source code to read the `BOOTSTRAP_PEERS` environment variable.

### Testing UDP-Only Mode

Change `PREFER_TRANSPORT` to `UDP`:

```yaml
environment:
  PREFER_TRANSPORT: UDP
```

### Testing with DHT Required

Enable DHT requirement:

```yaml
environment:
  REQUIRE_DHT_CONNECTION: "true"
```

Note: This may cause startup delays as nodes try to connect to external DHT nodes.

## Expected Behavior

### Successful Connection

When nodes successfully connect, you should see:

1. **Node1 logs**:
   ```
   [CLIENT] Connecting to Node2 0x... ws://172.20.0.11:4545
   [CLIENT] Connected to Node2 0x... ws://172.20.0.11:4545
   ```

2. **Node2 logs**:
   ```
   [SERVER] Received connection from Node1 0x...
   ```

### Peer Discovery

Nodes should discover each other and cache the connection:
- Check `data/ws-servers.json` for cached WebSocket servers
- Check `data/authenticated-peers.json` for authenticated peer list

## Integration with CI/CD

The automated test script (`test-connectivity.sh`) can be integrated into CI/CD pipelines:

```bash
# Run test and exit with appropriate code
./test-connectivity.sh
```

Exit codes:
- `0` - Success
- `1` - Failure (nodes didn't start, connection failed, etc.)

## Notes

- Both nodes use the same Docker image built from the repository
- Each node has its own data directory to prevent conflicts
- Nodes generate unique cryptographic identities on first run
- The test network is completely isolated from external networks
- Health checks ensure nodes are ready before testing begins

## Support

For issues or questions about the test setup, please refer to the main README or open an issue on GitHub.
