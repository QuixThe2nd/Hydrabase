# Dual-Node Connectivity Tests

This directory contains a complete test setup for verifying peer-to-peer connectivity between Hydrabase nodes.

## Quick Start

```bash
./test-connectivity-isolated.sh
```

## Documentation

| File | Purpose |
|------|---------|
| [QUICK-START.md](QUICK-START.md) | Quick reference and TL;DR |
| [TESTING.md](TESTING.md) | Comprehensive testing guide |
| [TEST-SETUP.md](TEST-SETUP.md) | Detailed setup documentation |
| [DUAL-NODE-TEST-SUMMARY.md](DUAL-NODE-TEST-SUMMARY.md) | Complete summary |
| [CHANGES.md](CHANGES.md) | List of all changes made |

## Test Scripts

| Script | Purpose |
|--------|---------|
| `validate-test-setup.sh` | Validate setup before testing |
| `test-connectivity-isolated.sh` ⭐ | Automated test (recommended) |
| `test-connectivity.sh` | Automated test (basic) |
| `test-manual.sh` | Manual testing environment |

## Docker Compose Files

| File | Purpose |
|------|---------|
| `docker-compose.test-isolated.yml` ⭐ | Isolated dual-node setup (recommended) |
| `docker-compose.test.yml` | Basic dual-node setup |

## What You Get

✅ Two isolated Docker containers  
✅ Automatic peer discovery  
✅ Clean output (no warnings)  
✅ Comprehensive verification  
✅ Full documentation  

## Access

- **Node1**: http://localhost:4545 (172.20.0.10:4545)
- **Node2**: http://localhost:4546 (172.20.0.11:4545)

## Support

Start with [QUICK-START.md](QUICK-START.md) or [TESTING.md](TESTING.md) for help.
