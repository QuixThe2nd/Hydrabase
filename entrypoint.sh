#!/bin/sh
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

echo "Starting with UID: $PUID, GID: $PGID"

if ! getent group "$PGID" > /dev/null 2>&1; then
    addgroup -g "$PGID" appgroup
fi

if ! getent passwd "$PUID" > /dev/null 2>&1; then
    adduser -D -u "$PUID" -G "$(getent group "$PGID" | cut -d: -f1)" appuser
fi

chown -R "$PUID:$PGID" /app/data 2>/dev/null || echo "Warning: Cannot chown /app/data (FUSE mount). Ensure host dir is writable by UID:GID $PUID:$PGID."

exec gosu "$PUID:$PGID" bun src/index.ts

