#!/bin/sh
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

echo "Starting with UID: $PUID, GID: $PGID"

if ! getent group "$PGID" > /dev/null 2>&1; then
    addgroup --gid "$PGID" appgroup
fi

if ! getent passwd "$PUID" > /dev/null 2>&1; then
    adduser --uid "$PUID" --gid "$PGID" --disabled-password --gecos "" appuser
fi

chown -R "$PUID:$PGID" /app/data

exec gosu "$PUID:$PGID" bun run src/backend

