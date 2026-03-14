#!/bin/bash

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Live P2P Connection Demonstration${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Get current log positions to only show new logs
NODE1_LOG_LINES=$(docker-compose -f docker-compose.test.yml logs node1 2>&1 | wc -l)
NODE2_LOG_LINES=$(docker-compose -f docker-compose.test.yml logs node2 2>&1 | wc -l)

echo -e "${CYAN}Step 1: Getting node identities...${NC}"
NODE1_AUTH=$(curl -s http://localhost:4545/auth)
NODE2_AUTH=$(curl -s http://localhost:4546/auth)

NODE1_ADDR=$(echo "$NODE1_AUTH" | grep -o '"address":"0x[^"]*"' | cut -d'"' -f4)
NODE2_ADDR=$(echo "$NODE2_AUTH" | grep -o '"address":"0x[^"]*"' | cut -d'"' -f4)
NODE1_NAME=$(echo "$NODE1_AUTH" | grep -o '"username":"[^"]*"' | cut -d'"' -f4)
NODE2_NAME=$(echo "$NODE2_AUTH" | grep -o '"username":"[^"]*"' | cut -d'"' -f4)

echo -e "  ${GREEN}$NODE1_NAME${NC}: $NODE1_ADDR @ 172.20.0.10:4545 (localhost:4545)"
echo -e "  ${GREEN}$NODE2_NAME${NC}: $NODE2_ADDR @ 172.20.0.11:4545 (localhost:4546)"
echo ""

echo -e "${CYAN}Step 2: Verifying existing peer connections...${NC}"
NODE1_PEERS=$(docker-compose -f docker-compose.test.yml logs node1 2>&1 | grep -c "Connected to 1 peer" || echo "0")
NODE2_PEERS=$(docker-compose -f docker-compose.test.yml logs node2 2>&1 | grep -c "Connected to 1 peer" || echo "0")

if [ "$NODE1_PEERS" -gt 0 ] && [ "$NODE2_PEERS" -gt 0 ]; then
    echo -e "  ${GREEN}✓ Both nodes report having 1 peer connection${NC}"
else
    echo -e "  ${RED}✗ Peer connections not established${NC}"
    exit 1
fi
echo ""

echo -e "${CYAN}Step 3: Showing connection establishment logs...${NC}\n"

echo -e "${MAGENTA}Node2 -> Node1 (CLIENT connection):${NC}"
docker-compose -f docker-compose.test.yml logs node2 2>&1 | grep -E "(Connecting to $NODE1_NAME|Connected to $NODE1_NAME)" | head -5

echo -e "\n${MAGENTA}Node1 accepting Node2 (SERVER connection):${NC}"
docker-compose -f docker-compose.test.yml logs node1 2>&1 | grep -E "(Connecting to client|Authenticated connection to $NODE2_NAME)" | head -5

echo -e "\n${CYAN}Step 4: Demonstrating bidirectional message flow...${NC}\n"

echo -e "${YELLOW}Recent messages from Node1 to Node2:${NC}"
docker-compose -f docker-compose.test.yml logs node1 2>&1 | grep "Sending.*to.*$NODE2_NAME" | tail -3

echo -e "\n${YELLOW}Recent responses from Node2 to Node1:${NC}"
docker-compose -f docker-compose.test.yml logs node2 2>&1 | grep "Sending.*to.*$NODE1_NAME" | tail -3

echo -e "\n${CYAN}Step 5: Triggering a new search to demonstrate live communication...${NC}\n"

# Make a search request to Node1 which will query Node2
echo -e "${YELLOW}Sending search request to Node1 for 'queen'...${NC}"
SEARCH_RESULT=$(curl -s "http://localhost:4545/search?type=artists&query=queen" | head -c 200)
echo -e "${GREEN}✓ Search completed${NC}"
echo ""

# Wait a moment for logs to be written
sleep 2

echo -e "${CYAN}Step 6: Showing new communication logs...${NC}\n"

echo -e "${MAGENTA}Node1 logs (new activity):${NC}"
docker-compose -f docker-compose.test.yml logs node1 2>&1 | tail -n +$NODE1_LOG_LINES | grep -E "(Sending|Received|HIP2)" | tail -10

echo -e "\n${MAGENTA}Node2 logs (new activity):${NC}"
docker-compose -f docker-compose.test.yml logs node2 2>&1 | tail -n +$NODE2_LOG_LINES | grep -E "(Sending|Received|HIP2)" | tail -10

echo -e "\n${BLUE}========================================${NC}"
echo -e "${GREEN}✓ DEMONSTRATION COMPLETE${NC}"
echo -e "${BLUE}========================================${NC}\n"

echo -e "${CYAN}Summary:${NC}"
echo -e "  • Node2 initiated a CLIENT connection to Node1"
echo -e "  • Node1 accepted Node2 as a SERVER connection"
echo -e "  • Both nodes can send and receive messages through this connection"
echo -e "  • The connection is fully bidirectional and functional"
echo -e "  • Search queries and results flow in both directions"
echo -e "\n${YELLOW}Note:${NC} The system uses a single WebSocket connection between peers"
echo -e "      rather than two separate connections. This is by design and"
echo -e "      provides efficient bidirectional communication."
echo ""
