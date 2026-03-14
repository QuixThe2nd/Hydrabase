#!/bin/bash

# Manual testing script for dual-node setup
# This script keeps the containers running for manual inspection

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Hydrabase Manual Test Environment${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Stopping containers...${NC}"
    docker-compose -f docker-compose.test.yml down
}

trap cleanup EXIT INT TERM

# Check if already running
if docker-compose -f docker-compose.test.yml ps | grep -q "Up"; then
    echo -e "${YELLOW}Containers are already running.${NC}\n"
else
    # Clean up old data
    echo -e "${YELLOW}Cleaning up old test data...${NC}"
    rm -rf test-data
    mkdir -p test-data/node1 test-data/node2

    # Start containers
    echo -e "${YELLOW}Starting containers...${NC}"
    docker-compose -f docker-compose.test.yml up -d

    # Wait for health
    echo -e "${YELLOW}Waiting for nodes to be healthy...${NC}"
    sleep 5
    
    timeout=60
    elapsed=0
    while [ $elapsed -lt $timeout ]; do
        if docker-compose -f docker-compose.test.yml ps | grep -q "node1.*healthy" && \
           docker-compose -f docker-compose.test.yml ps | grep -q "node2.*healthy"; then
            break
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done
fi

# Get node information
echo -e "${GREEN}✓ Nodes are running${NC}\n"

AUTH1=$(curl -s http://localhost:4545/auth)
AUTH2=$(curl -s http://localhost:4546/auth)

NODE1_ADDR=$(echo "$AUTH1" | grep -o '"address":"0x[^"]*"' | cut -d'"' -f4)
NODE2_ADDR=$(echo "$AUTH2" | grep -o '"address":"0x[^"]*"' | cut -d'"' -f4)
NODE1_USER=$(echo "$AUTH1" | grep -o '"username":"[^"]*"' | cut -d'"' -f4)
NODE2_USER=$(echo "$AUTH2" | grep -o '"username":"[^"]*"' | cut -d'"' -f4)

echo -e "${BLUE}Node Information:${NC}"
echo -e "  ${GREEN}Node1:${NC} $NODE1_USER ($NODE1_ADDR)"
echo -e "    Internal: 172.20.0.10:4545"
echo -e "    External: http://localhost:4545"
echo -e ""
echo -e "  ${GREEN}Node2:${NC} $NODE2_USER ($NODE2_ADDR)"
echo -e "    Internal: 172.20.0.11:4545"
echo -e "    External: http://localhost:4546"

echo -e "\n${BLUE}Available Commands:${NC}"
echo -e "  ${YELLOW}View Logs:${NC}"
echo -e "    docker-compose -f docker-compose.test.yml logs -f node1"
echo -e "    docker-compose -f docker-compose.test.yml logs -f node2"
echo -e ""
echo -e "  ${YELLOW}Check Node Status:${NC}"
echo -e "    curl http://localhost:4545/auth | jq"
echo -e "    curl http://localhost:4546/auth | jq"
echo -e ""
echo -e "  ${YELLOW}Trigger Manual Connection:${NC}"
echo -e "    # Node2 connects to Node1:"
echo -e "    docker exec hydrabase-node2 curl http://172.20.0.10:4545/auth"
echo -e ""
echo -e "    # Node1 connects to Node2:"
echo -e "    docker exec hydrabase-node1 curl http://172.20.0.11:4545/auth"
echo -e ""
echo -e "  ${YELLOW}Execute Commands Inside Containers:${NC}"
echo -e "    docker exec -it hydrabase-node1 sh"
echo -e "    docker exec -it hydrabase-node2 sh"
echo -e ""
echo -e "  ${YELLOW}Check DHT Status:${NC}"
echo -e "    docker exec hydrabase-node1 cat /app/data/dht-nodes.json | jq"
echo -e "    docker exec hydrabase-node2 cat /app/data/dht-nodes.json | jq"
echo -e ""
echo -e "  ${YELLOW}Check Peer Cache:${NC}"
echo -e "    docker exec hydrabase-node1 cat /app/data/ws-servers.json | jq"
echo -e "    docker exec hydrabase-node2 cat /app/data/ws-servers.json | jq"

echo -e "\n${GREEN}Containers are running. Press Ctrl+C to stop and cleanup.${NC}\n"

# Follow logs
docker-compose -f docker-compose.test.yml logs -f
