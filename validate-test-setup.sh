#!/bin/bash

# Validation script to check test setup

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Test Setup Validation${NC}"
echo -e "${BLUE}========================================${NC}\n"

ERRORS=0
WARNINGS=0

# Check required files
echo -e "${YELLOW}Checking required files...${NC}"

FILES=(
    "docker-compose.test.yml"
    "docker-compose.test-isolated.yml"
    "test-connectivity.sh"
    "test-connectivity-isolated.sh"
    "test-manual.sh"
    "TEST-SETUP.md"
    "TESTING.md"
    "Dockerfile"
    "src/backend/index.ts"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "  ${GREEN}✓${NC} $file"
    else
        echo -e "  ${RED}✗${NC} $file (missing)"
        ERRORS=$((ERRORS + 1))
    fi
done

# Check executable permissions
echo -e "\n${YELLOW}Checking executable permissions...${NC}"

SCRIPTS=(
    "test-connectivity.sh"
    "test-connectivity-isolated.sh"
    "test-manual.sh"
)

for script in "${SCRIPTS[@]}"; do
    if [ -x "$script" ]; then
        echo -e "  ${GREEN}✓${NC} $script"
    else
        echo -e "  ${YELLOW}⚠${NC} $script (not executable)"
        WARNINGS=$((WARNINGS + 1))
    fi
done

# Check Docker
echo -e "\n${YELLOW}Checking Docker...${NC}"

if command -v docker &> /dev/null; then
    echo -e "  ${GREEN}✓${NC} Docker installed"
    
    if docker ps &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} Docker daemon running"
    else
        echo -e "  ${RED}✗${NC} Docker daemon not running"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "  ${RED}✗${NC} Docker not installed"
    ERRORS=$((ERRORS + 1))
fi

if command -v docker-compose &> /dev/null; then
    echo -e "  ${GREEN}✓${NC} docker-compose installed"
else
    echo -e "  ${YELLOW}⚠${NC} docker-compose not installed (may use 'docker compose' instead)"
    WARNINGS=$((WARNINGS + 1))
fi

# Check ports
echo -e "\n${YELLOW}Checking port availability...${NC}"

if command -v lsof &> /dev/null; then
    if lsof -i :4545 &> /dev/null; then
        echo -e "  ${YELLOW}⚠${NC} Port 4545 is in use"
        WARNINGS=$((WARNINGS + 1))
    else
        echo -e "  ${GREEN}✓${NC} Port 4545 available"
    fi
    
    if lsof -i :4546 &> /dev/null; then
        echo -e "  ${YELLOW}⚠${NC} Port 4546 is in use"
        WARNINGS=$((WARNINGS + 1))
    else
        echo -e "  ${GREEN}✓${NC} Port 4546 available"
    fi
else
    echo -e "  ${YELLOW}⚠${NC} lsof not available, cannot check ports"
    WARNINGS=$((WARNINGS + 1))
fi

# Check source code modifications
echo -e "\n${YELLOW}Checking source code modifications...${NC}"

if grep -q "process.env\['BOOTSTRAP_PEERS'\]" src/backend/index.ts; then
    echo -e "  ${GREEN}✓${NC} BOOTSTRAP_PEERS environment variable support"
else
    echo -e "  ${RED}✗${NC} BOOTSTRAP_PEERS environment variable not configured"
    ERRORS=$((ERRORS + 1))
fi

if grep -q "process.env\['DHT_BOOTSTRAP_NODES'\]" src/backend/index.ts; then
    echo -e "  ${GREEN}✓${NC} DHT_BOOTSTRAP_NODES environment variable support"
else
    echo -e "  ${RED}✗${NC} DHT_BOOTSTRAP_NODES environment variable not configured"
    ERRORS=$((ERRORS + 1))
fi

# Check Dockerfile
echo -e "\n${YELLOW}Checking Dockerfile...${NC}"

if grep -q "curl" Dockerfile; then
    echo -e "  ${GREEN}✓${NC} curl installed in Dockerfile"
else
    echo -e "  ${RED}✗${NC} curl not installed in Dockerfile (needed for health checks)"
    ERRORS=$((ERRORS + 1))
fi

# Summary
echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Validation Summary${NC}"
echo -e "${BLUE}========================================${NC}\n"

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo -e "\n${GREEN}You can now run the tests:${NC}"
    echo -e "  ${BLUE}./test-connectivity.sh${NC}"
    echo -e "  ${BLUE}./test-connectivity-isolated.sh${NC}"
    echo -e "  ${BLUE}./test-manual.sh${NC}"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ Validation completed with $WARNINGS warning(s)${NC}"
    echo -e "\n${YELLOW}You can still run the tests, but some features may not work optimally.${NC}"
    exit 0
else
    echo -e "${RED}✗ Validation failed with $ERRORS error(s) and $WARNINGS warning(s)${NC}"
    echo -e "\n${RED}Please fix the errors before running tests.${NC}"
    exit 1
fi
