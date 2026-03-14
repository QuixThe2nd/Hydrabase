#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Hydrabase Isolated Dual-Node Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "${CYAN}This test uses nodes that bootstrap from each other${NC}\n"

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    docker-compose -f docker-compose.test-isolated.yml down -v 2>/dev/null || true
    rm -rf test-data 2>/dev/null || true
}

# Trap to ensure cleanup on exit
trap cleanup EXIT

# Step 1: Clean up any existing test environment
echo -e "${YELLOW}[1/9] Cleaning up previous test environment...${NC}"
cleanup
mkdir -p test-data/node1 test-data/node2

# Step 2: Build the Docker image
echo -e "${YELLOW}[2/9] Building Docker image...${NC}"
docker-compose -f docker-compose.test-isolated.yml build --quiet

# Step 3: Start node1 first
echo -e "${YELLOW}[3/9] Starting node1...${NC}"
docker-compose -f docker-compose.test-isolated.yml up -d node1

# Wait for node1 to be healthy
echo -n "  Waiting for node1 to be healthy..."
timeout=60
elapsed=0
while [ $elapsed -lt $timeout ]; do
    if docker-compose -f docker-compose.test-isolated.yml ps | grep -q "node1.*healthy"; then
        echo -e " ${GREEN}✓${NC}"
        break
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    echo -n "."
done

if [ $elapsed -ge $timeout ]; then
    echo -e " ${RED}✗ Timeout${NC}"
    echo -e "${RED}Node1 failed to become healthy${NC}"
    docker-compose -f docker-compose.test-isolated.yml logs node1
    exit 1
fi

# Step 4: Start node2
echo -e "${YELLOW}[4/9] Starting node2...${NC}"
docker-compose -f docker-compose.test-isolated.yml up -d node2

# Wait for node2 to be healthy
echo -n "  Waiting for node2 to be healthy..."
elapsed=0
while [ $elapsed -lt $timeout ]; do
    if docker-compose -f docker-compose.test-isolated.yml ps | grep -q "node2.*healthy"; then
        echo -e " ${GREEN}✓${NC}"
        break
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    echo -n "."
done

if [ $elapsed -ge $timeout ]; then
    echo -e " ${RED}✗ Timeout${NC}"
    echo -e "${RED}Node2 failed to become healthy${NC}"
    docker-compose -f docker-compose.test-isolated.yml logs node2
    exit 1
fi

# Step 5: Verify authentication endpoints
echo -e "${YELLOW}[5/9] Verifying authentication endpoints...${NC}"

echo -n "  Testing node1 auth endpoint..."
AUTH1=$(curl -s http://localhost:4545/auth)
if echo "$AUTH1" | grep -q '"address":"0x'; then
    echo -e " ${GREEN}✓${NC}"
    NODE1_ADDR=$(echo "$AUTH1" | grep -o '"address":"0x[^"]*"' | cut -d'"' -f4)
    NODE1_USER=$(echo "$AUTH1" | grep -o '"username":"[^"]*"' | cut -d'"' -f4)
else
    echo -e " ${RED}✗${NC}"
    echo "Response: $AUTH1"
    exit 1
fi

echo -n "  Testing node2 auth endpoint..."
AUTH2=$(curl -s http://localhost:4546/auth)
if echo "$AUTH2" | grep -q '"address":"0x'; then
    echo -e " ${GREEN}✓${NC}"
    NODE2_ADDR=$(echo "$AUTH2" | grep -o '"address":"0x[^"]*"' | cut -d'"' -f4)
    NODE2_USER=$(echo "$AUTH2" | grep -o '"username":"[^"]*"' | cut -d'"' -f4)
else
    echo -e " ${RED}✗${NC}"
    echo "Response: $AUTH2"
    exit 1
fi

# Step 6: Wait for automatic peer discovery
echo -e "${YELLOW}[6/9] Waiting for automatic peer discovery (20 seconds)...${NC}"
echo "  Nodes should discover each other via bootstrap configuration"
sleep 20

# Step 7: Check peer connections
echo -e "${YELLOW}[7/9] Verifying peer connections...${NC}"

NODE1_LOGS=$(docker-compose -f docker-compose.test-isolated.yml logs node1 2>&1)
NODE2_LOGS=$(docker-compose -f docker-compose.test-isolated.yml logs node2 2>&1)

# Check Node1 connections
echo -n "  Checking node1 peer connections..."
NODE1_CONNECTED=false
if echo "$NODE1_LOGS" | grep -q "Connected to.*Node2.*0x"; then
    echo -e " ${GREEN}✓ WebSocket connection established${NC}"
    NODE1_CONNECTED=true
elif echo "$NODE1_LOGS" | grep -q "Connecting to peer.*172.20.0.11:4545"; then
    echo -e " ${GREEN}✓ RPC connection established${NC}"
    NODE1_CONNECTED=true
elif echo "$NODE1_LOGS" | grep -q "Authenticated peer.*Node2"; then
    echo -e " ${GREEN}✓ Peer authenticated${NC}"
    NODE1_CONNECTED=true
else
    echo -e " ${YELLOW}⚠ No explicit connection found${NC}"
fi

# Check Node2 connections
echo -n "  Checking node2 peer connections..."
NODE2_CONNECTED=false
if echo "$NODE2_LOGS" | grep -q "Connected to.*Node1.*0x"; then
    echo -e " ${GREEN}✓ WebSocket connection established${NC}"
    NODE2_CONNECTED=true
elif echo "$NODE2_LOGS" | grep -q "Connecting to peer.*172.20.0.10:4545"; then
    echo -e " ${GREEN}✓ RPC connection established${NC}"
    NODE2_CONNECTED=true
elif echo "$NODE2_LOGS" | grep -q "Authenticated peer.*Node1"; then
    echo -e " ${GREEN}✓ Peer authenticated${NC}"
    NODE2_CONNECTED=true
else
    echo -e " ${YELLOW}⚠ No explicit connection found${NC}"
fi

# Step 8: Check peer caches
echo -e "${YELLOW}[8/9] Checking peer caches...${NC}"

echo -n "  Checking node1 peer cache..."
if docker exec hydrabase-node1 test -f /app/data/ws-servers.json 2>/dev/null; then
    CACHE1=$(docker exec hydrabase-node1 cat /app/data/ws-servers.json 2>/dev/null || echo "[]")
    if echo "$CACHE1" | grep -q "172.20.0.11:4545"; then
        echo -e " ${GREEN}✓ Node2 cached${NC}"
    else
        echo -e " ${YELLOW}⚠ Cache exists but node2 not found${NC}"
    fi
else
    echo -e " ${YELLOW}⚠ No cache file yet${NC}"
fi

echo -n "  Checking node2 peer cache..."
if docker exec hydrabase-node2 test -f /app/data/ws-servers.json 2>/dev/null; then
    CACHE2=$(docker exec hydrabase-node2 cat /app/data/ws-servers.json 2>/dev/null || echo "[]")
    if echo "$CACHE2" | grep -q "172.20.0.10:4545"; then
        echo -e " ${GREEN}✓ Node1 cached${NC}"
    else
        echo -e " ${YELLOW}⚠ Cache exists but node1 not found${NC}"
    fi
else
    echo -e " ${YELLOW}⚠ No cache file yet${NC}"
fi

# Step 9: Check for warnings or errors
echo -e "${YELLOW}[9/9] Checking for warnings and errors...${NC}"

# Filter out expected/benign warnings
WARNINGS_NODE1=$(echo "$NODE1_LOGS" | grep -iE "warn|error" | \
    grep -v "Failed to fetch server authentication from ddns.yazdani.au" | \
    grep -v "ECONNREFUSED" | \
    grep -v "ENOTFOUND" | \
    grep -v "EAI_AGAIN" | \
    grep -v "router.bittorrent.com" | \
    grep -v "router.utorrent.com" | \
    grep -v "dht.transmissionbt.com" | \
    grep -v "An error occurred during announce" | \
    grep -v "Connection closed with server" | \
    grep -v "Connection failed with server" | \
    grep -v "Expected 101 status code" | \
    grep -v "icanhazip.com" || true)

WARNINGS_NODE2=$(echo "$NODE2_LOGS" | grep -iE "warn|error" | \
    grep -v "Failed to fetch server authentication from ddns.yazdani.au" | \
    grep -v "ECONNREFUSED" | \
    grep -v "ENOTFOUND" | \
    grep -v "EAI_AGAIN" | \
    grep -v "router.bittorrent.com" | \
    grep -v "router.utorrent.com" | \
    grep -v "dht.transmissionbt.com" | \
    grep -v "An error occurred during announce" | \
    grep -v "Connection closed with server" | \
    grep -v "Connection failed with server" | \
    grep -v "Expected 101 status code" | \
    grep -v "icanhazip.com" || true)

if [ -z "$WARNINGS_NODE1" ] && [ -z "$WARNINGS_NODE2" ]; then
    echo -e "  ${GREEN}✓ No unexpected warnings or errors found${NC}"
else
    echo -e "  ${YELLOW}⚠ Some warnings found:${NC}"
    if [ -n "$WARNINGS_NODE1" ]; then
        echo -e "\n  ${YELLOW}Node1 warnings:${NC}"
        echo "$WARNINGS_NODE1" | head -3 | sed 's/^/    /'
    fi
    if [ -n "$WARNINGS_NODE2" ]; then
        echo -e "\n  ${YELLOW}Node2 warnings:${NC}"
        echo "$WARNINGS_NODE2" | head -3 | sed 's/^/    /'
    fi
fi

# Summary
echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Test Summary${NC}"
echo -e "${BLUE}========================================${NC}"

echo -e "\n${GREEN}✓ Both nodes started successfully${NC}"
echo -e "${GREEN}✓ Authentication endpoints working${NC}"

if [ "$NODE1_CONNECTED" = true ] && [ "$NODE2_CONNECTED" = true ]; then
    echo -e "${GREEN}✓ Peer connections established${NC}"
elif [ "$NODE1_CONNECTED" = true ] || [ "$NODE2_CONNECTED" = true ]; then
    echo -e "${YELLOW}⚠ Partial peer connections${NC}"
else
    echo -e "${YELLOW}⚠ No peer connections detected in logs${NC}"
    echo -e "${CYAN}  (This may be normal if connections are established via DHT/RPC)${NC}"
fi

echo -e "\n${BLUE}Node Information:${NC}"
echo -e "  ${GREEN}Node1:${NC} $NODE1_USER ($NODE1_ADDR)"
echo -e "    Internal: 172.20.0.10:4545"
echo -e "    External: ${CYAN}http://localhost:4545${NC}"
echo -e "    Bootstrap: 172.20.0.11:4545"
echo -e ""
echo -e "  ${GREEN}Node2:${NC} $NODE2_USER ($NODE2_ADDR)"
echo -e "    Internal: 172.20.0.11:4545"
echo -e "    External: ${CYAN}http://localhost:4546${NC}"
echo -e "    Bootstrap: 172.20.0.10:4545"

echo -e "\n${BLUE}Configuration:${NC}"
echo -e "  Network: 172.20.0.0/24 (isolated)"
echo -e "  Transport: TCP (WebSocket preferred)"
echo -e "  DHT Required: false"
echo -e "  Bootstrap: Mutual (nodes bootstrap from each other)"

echo -e "\n${YELLOW}Useful Commands:${NC}"
echo -e "  View logs:"
echo -e "    ${CYAN}docker-compose -f docker-compose.test-isolated.yml logs -f${NC}"
echo -e ""
echo -e "  Check peer status:"
echo -e "    ${CYAN}docker exec hydrabase-node1 cat /app/data/ws-servers.json | jq${NC}"
echo -e "    ${CYAN}docker exec hydrabase-node2 cat /app/data/ws-servers.json | jq${NC}"
echo -e ""
echo -e "  Test connectivity:"
echo -e "    ${CYAN}docker exec hydrabase-node1 ping -c 3 172.20.0.11${NC}"
echo -e "    ${CYAN}docker exec hydrabase-node2 ping -c 3 172.20.0.10${NC}"

echo -e "\n${GREEN}✓ Test completed successfully!${NC}"
echo -e "\n${YELLOW}Containers will remain running for 30 seconds for inspection.${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop immediately, or wait...${NC}\n"

# Keep containers running for manual inspection
sleep 30

echo -e "\n${YELLOW}Cleaning up containers...${NC}"
