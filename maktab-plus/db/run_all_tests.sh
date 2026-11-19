#!/usr/bin/env bash
# MAKTAB+ — run every test on fresh databases. Exit code 0 = all green.
# Usage: PGHOST=localhost PGPORT=5432 PGUSER=postgres ./run_all_tests.sh
set -euo pipefail
cd "$(dirname "$0")"
FAILED=0
run() {
  local out; out=$(psql -q -X -v ON_ERROR_STOP=1 -d "$1" -f "$2" 2>&1) || FAILED=1
  echo "$out" | grep -E "FAIL|RESULT|attacks|checks passed|ERROR" || true
}

dropdb --if-exists maktab_t1 >/dev/null; createdb maktab_t1
LOAD="-f local_compat.sql -f schema.sql -f seed.sql -f api_phase1.sql -f round4_roles_signals.sql -f weekly_tests_gen.sql -f curriculum.sql -f quiet_hours.sql -f family_api.sql"
psql -q -X -v ON_ERROR_STOP=1 -d maktab_t1 $LOAD >/dev/null
echo "== 1. role matrix + v3 + plans (test_rls.sql) ==";  run maktab_t1 test_rls.sql
echo "== 2. Perplexity's attacks (test_perplexity.sql) =="; run maktab_t1 test_perplexity.sql
echo "== 3. round 4: roles, weekly tests, curriculum, quiet hours (test_round4.sql) =="; run maktab_t1 test_round4.sql

dropdb --if-exists maktab_t2 >/dev/null; createdb maktab_t2
psql -q -X -v ON_ERROR_STOP=1 -d maktab_t2 $LOAD >/dev/null
echo "== 4. teacher's day API (test_api.sql) ==";         run maktab_t2 test_api.sql
echo "== 4b. parents & students (test_family.sql) ==";
dropdb --if-exists maktab_t3 >/dev/null; createdb maktab_t3
psql -q -X -v ON_ERROR_STOP=1 -d maktab_t3 -f local_compat.sql -f schema.sql -f seed.sql -f api_phase1.sql -f family_api.sql >/dev/null
run maktab_t3 test_family.sql
echo "== 5. AI budget race, 2 connections ==";           PGDATABASE=maktab_t2 ./test_api_race.sh || FAILED=1

if [ "$FAILED" = 0 ]; then echo "ALL TEST FILES GREEN"; else echo "SOMETHING FAILED (see above)"; exit 1; fi
