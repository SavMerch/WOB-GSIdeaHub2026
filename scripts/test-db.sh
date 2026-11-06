#!/usr/bin/env bash
# Starts a throwaway local Postgres (port 54329) for the database
# authorization tests. Requires PostgreSQL 15+ binaries on PATH or in
# /usr/lib/postgresql/*/bin. Usage: npm run db:test:setup && npm run test:db
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.tmp-pg"
PORT="${TEST_PG_PORT:-54329}"
BIN="$(dirname "$(command -v pg_ctl 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")"

if [ "$(id -u)" = "0" ]; then RUN="runuser -u postgres --"; chown -R postgres "$ROOT/.tmp-pg" 2>/dev/null || true; else RUN=""; fi

if [ ! -d "$DATA" ]; then
  mkdir -p "$DATA"; [ -n "$RUN" ] && chown postgres "$DATA"
  $RUN "$BIN/initdb" -D "$DATA" -U postgres --auth=trust >/dev/null
fi
if ! $RUN "$BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
  $RUN "$BIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp" -l "$DATA/log.txt" start >/dev/null
  sleep 1
fi
echo "Postgres ready: postgres://postgres@localhost:$PORT/postgres"
echo "Run: TEST_DATABASE_URL=postgres://postgres@localhost:$PORT/postgres npm run test:db"
