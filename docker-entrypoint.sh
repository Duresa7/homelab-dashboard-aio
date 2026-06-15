#!/bin/sh
# Make the bind-mounted data dir writable by the unprivileged app user, then drop
# privileges to it. A fresh `./data` bind mount arrives root-owned, which would
# otherwise crash the non-root app on startup (SQLITE_CANTOPEN). If the container
# is already started as a non-root user (e.g. a compose `user:` override), skip
# the fix-up and just run.
set -e

if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  chown -R node:node /app/data 2>/dev/null || true
  exec gosu node "$@"
fi

exec "$@"
