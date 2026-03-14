# Quick Start - Dual-Node Connectivity Test

## TL;DR

```bash
# Validate setup
./validate-test-setup.sh

# Run test (recommended)
./test-connectivity-isolated.sh

# Or run manually
./test-manual.sh
```

## What You Get

✅ Two isolated Docker containers  
✅ Automatic peer discovery  
✅ Clean output (no warnings)  
✅ Comprehensive verification  
✅ Full documentation  

## Test Scripts

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `validate-test-setup.sh` | Check setup is correct | Before first run |
| `test-connectivity-isolated.sh` ⭐ | Automated test (isolated) | **Recommended** |
| `test-connectivity.sh` | Automated test (basic) | Quick verification |
| `test-manual.sh` | Manual testing | Interactive exploration |

## Access URLs

- **Node1**: http://localhost:4545
- **Node2**: http://localhost:4546

## Network

- **Subnet**: 172.20.0.0/24
- **Node1**: 172.20.0.10:4545
- **Node2**: 172.20.0.11:4545

## Expected Output

```
========================================
Test Summary
========================================

✓ Both nodes started successfully
✓ Authentication endpoints working
✓ Peer connections established

Node Information:
  Node1: Node1 (0x...) @ 172.20.0.10:4545
  Node2: Node2 (0x...) @ 172.20.0.11:4545

✓ Test completed successfully!
```

## Quick Commands

```bash
# Check node status
curl http://localhost:4545/auth | jq
curl http://localhost:4546/auth | jq

# View logs
docker-compose -f docker-compose.test-isolated.yml logs -f

# Check peer connections
docker exec hydrabase-node1 cat /app/data/ws-servers.json | jq
docker exec hydrabase-node2 cat /app/data/ws-servers.json | jq

# Cleanup
docker-compose -f docker-compose.test-isolated.yml down -v
rm -rf test-data/
```

## Troubleshooting

### Ports in use?
```bash
lsof -i :4545
lsof -i :4546
```

### Nodes won't connect?
```bash
# Check connectivity
docker exec hydrabase-node1 ping -c 3 172.20.0.11

# Trigger connection
docker exec hydrabase-node2 curl http://172.20.0.10:4545/auth

# View logs
docker-compose -f docker-compose.test-isolated.yml logs -f
```

### Need to rebuild?
```bash
docker-compose -f docker-compose.test-isolated.yml build --no-cache
```

## Documentation

- **DUAL-NODE-TEST-SUMMARY.md** - Complete summary
- **TESTING.md** - Comprehensive testing guide
- **TEST-SETUP.md** - Detailed setup documentation
- **QUICK-START.md** - This file

## Support

1. Check `TESTING.md` for detailed troubleshooting
2. View logs: `docker-compose -f docker-compose.test-isolated.yml logs`
3. Open an issue with logs and configuration

---

**Ready to test?** Run: `./test-connectivity-isolated.sh`
