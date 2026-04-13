#!/bin/bash
set -e

cd /root/.hermes/Hydrabase

# Check if we're on dev branch
git checkout dev

# Capture current HEAD
before=$(git rev-parse HEAD)

# Pull latest
git fetch upstream
git reset --hard upstream/dev

after=$(git rev-parse HEAD)

if [ "$before" != "$after" ]; then
    echo "$(date) - Updated: $before -> $after, restarting..."
else
    echo "$(date) - No changes"
fi

# Always restart (picks up env changes and any code updates)
pkill -f "bun src/backend" 2>/dev/null || true
sleep 1

# Load .env and start
set -a
source /root/.hermes/Hydrabase/.env
set +a

USERNAME=Bob BIO="Building the future, one node at a time. 🚧" \
DOMAIN=bob.yazdani.au HYDRABASE_TELEMETRY=false \
HYDRABASE_BOOTSTRAP_PEERS="$HYDRABASE_BOOTSTRAP_PEERS" \
HYDRABASE_DHT_BOOTSTRAP_NODES="$HYDRABASE_DHT_BOOTSTRAP_NODES" \
API_KEY="$API_KEY" \
bun src/backend >> /tmp/hydrabase-4545.log 2>&1 &

echo "$(date) - Started PID $!"
