#!/usr/bin/env bash
# MAKTAB+ — start the live demo locally: database → API server → web app.
# Needs: PostgreSQL 16 running, Node 20+. Usage:
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres ./dev.sh          (fresh demo database)
#   then open http://localhost:5173/live.html
set -euo pipefail
cd "$(dirname "$0")"
DB=${DEMO_DB:-maktab_demo}
echo "== building the demo database ($DB)"
dropdb --if-exists "$DB"; createdb "$DB"
for f in local_compat schema api_phase1 family_api round4_roles_signals weekly_tests_gen curriculum quiet_hours auth_local demo_seed; do
  psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "db/$f.sql" >/dev/null
done
echo "== starting API server on :8787"
DATABASE_URL="postgres://authenticator:dev-only-change-me@${PGHOST:-localhost}:${PGPORT:-5432}/$DB" node server/index.mjs &
trap 'kill %1 2>/dev/null' EXIT
echo "== starting web app → http://localhost:5173/live.html"
npx vite
