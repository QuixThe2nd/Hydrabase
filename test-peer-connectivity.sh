#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Hydrabase P2P Connectivity Verification${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Check if containers are running
if ! docker-compose -f docker-compose.test.yml ps | grep -q "healthy"; then
    echo -e "${RED}Error: Containers are not running or healthy${NC}"
    echo -e "${YELLOW}Please run: docker-compose -f docker-compose.test.yml up -d${NC}"
    exit 1
fi

echo -e "${CYAN}[1/6] Checking container status...${NC}"
docker-compose -f docker-compose.test.yml ps | grep -E "node1|node2"
echo ""

echo -e "${CYAN}[2/6] Getting node identities...${NC}"
NODE1_AUTH=$(curl -s http://localhost:4545/auth)
NODE2_AUTH=$(curl -s http://localhost:4546/auth)

NODE1_ADDR=$(echo "$NODE1_AUTH" | grep -o '"address":"0x[^"]*"' | cut -d'"' -f4)
NODE2_ADDR=$(echo "$NODE2_AUTH" | grep -o '"address":"0x[^"]*"' | cut -d'"' -f4)
NODE1_NAME=$(echo "$NODE1_AUTH" | grep -o '"username":"[^"]*"' | cut -d'"' -f4)
NODE2_NAME=$(echo "$NODE2_AUTH" | grep -o '"username":"[^"]*"' | cut -d'"' -f4)

echo -e "  ${GREEN}Node1:${NC} $NODE1_NAME ($NODE1_ADDR) @ 172.20.0.10:4545"
echo -e "  ${GREEN}Node2:${NC} $NODE2_NAME ($NODE2_ADDR) @ 172.20.0.11:4545"
echo ""

echo -e "${CYAN}[3/6] Checking peer discovery logs...${NC}"

# Check Node1's logs for Node2 connection
echo -e "\n  ${YELLOW}Node1 -> Node2 connection:${NC}"
NODE1_LOGS=$(docker-compose -f docker-compose.test.yml logs node1 2>&1)

if echo "$NODE1_LOGS" | grep -q "Peer connection established with $NODE2_NAME"; then
    echo -e "    ${GREEN}✓ Node1 established connection with Node2${NC}"
    CONNECTION_TYPE=$(echo "$NODE1_LOGS" | grep "Peer connection established with $NODE2_NAME" | grep -o "CLIENT\|SERVER\|RPC" | head -1)
    echo -e "    ${GREEN}✓ Connection type: $CONNECTION_TYPE WebSocket${NC}"
elif echo "$NODE1_LOGS" | grep -q "Authenticated connection to $NODE2_NAME $NODE2_ADDR"; then
    echo -e "    ${GREEN}✓ Node1 authenticated Node2${NC}"
    CONNECTION_TYPE=$(echo "$NODE1_LOGS" | grep "Authenticated connection to $NODE2_NAME" | grep -o "\[SERVER\]\|\[CLIENT\]" | head -1)
    echo -e "    ${GREEN}✓ Connection type: $CONNECTION_TYPE${NC}"
else
    echo -e "    ${RED}✗ Node1 did not connect to Node2${NC}"
fi

if echo "$NODE1_LOGS" | grep -q "Connected to 1 peer"; then
    echo -e "    ${GREEN}✓ Node1 reports 1 peer connected${NC}"
else
    echo -e "    ${YELLOW}⚠ Node1 peer count not found${NC}"
fi

# Check Node2's logs for Node1 connection
echo -e "\n  ${YELLOW}Node2 -> Node1 connection:${NC}"
NODE2_LOGS=$(docker-compose -f docker-compose.test.yml logs node2 2>&1)

if echo "$NODE2_LOGS" | grep -q "Peer connection established with $NODE1_NAME"; then
    echo -e "    ${GREEN}✓ Node2 established connection with Node1${NC}"
    CONNECTION_TYPE=$(echo "$NODE2_LOGS" | grep "Peer connection established with $NODE1_NAME" | grep -o "CLIENT\|SERVER\|RPC" | head -1)
    echo -e "    ${GREEN}✓ Connection type: $CONNECTION_TYPE WebSocket${NC}"
elif echo "$NODE2_LOGS" | grep -q "Connected to $NODE1_NAME $NODE1_ADDR"; then
    echo -e "    ${GREEN}✓ Node2 connected to Node1${NC}"
    CONNECTION_TYPE=$(echo "$NODE2_LOGS" | grep "Connected to $NODE1_NAME" | grep -o "\[SERVER\]\|\[CLIENT\]" | head -1)
    echo -e "    ${GREEN}✓ Connection type: $CONNECTION_TYPE${NC}"
else
    echo -e "    ${RED}✗ Node2 did not connect to Node1${NC}"
fi

if echo "$NODE2_LOGS" | grep -q "Connected to 1 peer"; then
    echo -e "    ${GREEN}✓ Node2 reports 1 peer connected${NC}"
else
    echo -e "    ${YELLOW}⚠ Node2 peer count not found${NC}"
fi

echo -e "\n${CYAN}[4/6] Verifying bidirectional data exchange...${NC}"

# Check Node1 sending to Node2
echo -e "\n  ${YELLOW}Node1 -> Node2 data exchange:${NC}"
if echo "$NODE1_LOGS" | grep -q "Sending.*to.*$NODE2_NAME.*$NODE2_ADDR"; then
    SEND_COUNT=$(echo "$NODE1_LOGS" | grep -c "Sending.*to.*$NODE2_NAME.*$NODE2_ADDR" || echo "0")
    echo -e "    ${GREEN}✓ Node1 sent $SEND_COUNT messages to Node2${NC}"
else
    echo -e "    ${RED}✗ No messages sent from Node1 to Node2${NC}"
fi

if echo "$NODE1_LOGS" | grep -q "Received.*from.*$NODE2_NAME.*$NODE2_ADDR"; then
    RECV_COUNT=$(echo "$NODE1_LOGS" | grep -c "Received.*from.*$NODE2_NAME.*$NODE2_ADDR" || echo "0")
    echo -e "    ${GREEN}✓ Node1 received $RECV_COUNT responses from Node2${NC}"
else
    echo -e "    ${RED}✗ No responses received by Node1 from Node2${NC}"
fi

# Check Node2 sending to Node1
echo -e "\n  ${YELLOW}Node2 -> Node1 data exchange:${NC}"
if echo "$NODE2_LOGS" | grep -q "Sending.*to.*$NODE1_NAME.*$NODE1_ADDR"; then
    SEND_COUNT=$(echo "$NODE2_LOGS" | grep -c "Sending.*to.*$NODE1_NAME.*$NODE1_ADDR" || echo "0")
    echo -e "    ${GREEN}✓ Node2 sent $SEND_COUNT messages to Node1${NC}"
else
    echo -e "    ${RED}✗ No messages sent from Node2 to Node1${NC}"
fi

if echo "$NODE2_LOGS" | grep -q "Received.*from.*$NODE1_NAME.*$NODE1_ADDR"; then
    RECV_COUNT=$(echo "$NODE2_LOGS" | grep -c "Received.*from.*$NODE1_NAME.*$NODE1_ADDR" || echo "0")
    echo -e "    ${GREEN}✓ Node2 received $RECV_COUNT requests from Node1${NC}"
else
    echo -e "    ${RED}✗ No requests received by Node2 from Node1${NC}"
fi

echo -e "\n${CYAN}[5/6] Testing search result exchange...${NC}"

# Check if they exchanged search results
if echo "$NODE1_LOGS" | grep -q "Received [0-9]* results"; then
    RESULTS=$(echo "$NODE1_LOGS" | grep "Received [0-9]* results" | tail -5)
    echo -e "  ${GREEN}✓ Node1 received search results:${NC}"
    echo "$RESULTS" | while read line; do
        echo -e "    ${YELLOW}$line${NC}"
    done
else
    echo -e "  ${RED}✗ Node1 did not receive search results${NC}"
fi

if echo "$NODE2_LOGS" | grep -q "Received [0-9]* results"; then
    RESULTS=$(echo "$NODE2_LOGS" | grep "Received [0-9]* results" | tail -5)
    echo -e "  ${GREEN}✓ Node2 received search results:${NC}"
    echo "$RESULTS" | while read line; do
        echo -e "    ${YELLOW}$line${NC}"
    done
else
    echo -e "  ${RED}✗ Node2 did not receive search results${NC}"
fi

echo -e "\n${CYAN}[6/6] Summary of P2P connectivity...${NC}\n"

# Final summary
ERRORS=0

if echo "$NODE1_LOGS" | grep -q "Peer connection established with $NODE2_NAME" && \
   echo "$NODE2_LOGS" | grep -q "Peer connection established with $NODE1_NAME"; then
    echo -e "  ${GREEN}✓ Peer discovery: SUCCESSFUL${NC}"
    echo -e "    - Node1 discovered and connected to Node2"
    echo -e "    - Node2 discovered and connected to Node1"
else
    echo -e "  ${RED}✗ Peer discovery: FAILED${NC}"
    ERRORS=$((ERRORS + 1))
fi

if echo "$NODE1_LOGS" | grep -q "Sending.*to.*$NODE2_NAME" && \
   echo "$NODE2_LOGS" | grep -q "Sending.*to.*$NODE1_NAME"; then
    echo -e "  ${GREEN}✓ Bidirectional communication: SUCCESSFUL${NC}"
    echo -e "    - Node1 can send to Node2"
    echo -e "    - Node2 can send to Node1"
else
    echo -e "  ${RED}✗ Bidirectional communication: FAILED${NC}"
    ERRORS=$((ERRORS + 1))
fi

if echo "$NODE1_LOGS" | grep -q "Received.*results" && \
   echo "$NODE2_LOGS" | grep -q "Received.*results"; then
    echo -e "  ${GREEN}✓ Data exchange: SUCCESSFUL${NC}"
    echo -e "    - Nodes successfully exchanged search queries and results"
else
    echo -e "  ${RED}✗ Data exchange: FAILED${NC}"
    ERRORS=$((ERRORS + 1))
fi

echo -e "\n${BLUE}========================================${NC}"
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✓ ALL TESTS PASSED${NC}"
    echo -e "${GREEN}P2P connectivity is working correctly!${NC}"
else
    echo -e "${RED}✗ $ERRORS TEST(S) FAILED${NC}"
    echo -e "${YELLOW}Check the logs above for details${NC}"
fi
echo -e "${BLUE}========================================${NC}\n"

exit $ERRORS
