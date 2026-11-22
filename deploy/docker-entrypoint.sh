#!/bin/sh
# Start ParkSmart. With LITESTREAM_REPLICA_URL set, restore the database from the
# replica when the volume is empty (a fresh host), then run the app under Litestream so
# every write is streamed off the box. Without it, run the app directly.
set -eu
DB="${DATABASE_PATH:-/data/parksmart.db}"
APP="node /app/apps/api/dist/server.js"

if [ -n "${LITESTREAM_REPLICA_URL:-}" ]; then
  if [ ! -f "$DB" ]; then
    echo "No database at $DB: restoring from replica if one exists"
    litestream restore -config /app/litestream.yml -if-replica-exists "$DB"
  fi
  exec litestream replicate -config /app/litestream.yml -exec "$APP"
fi

echo "LITESTREAM_REPLICA_URL is not set: running without off-site backups"
exec $APP
