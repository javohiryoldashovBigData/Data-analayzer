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
LOAD="-f local_compat.sql -f schema.sql -f seed.sql -f api_phase1.sql -f round4_roles_signals.sql -f weekly_tests_gen.sql -f curriculum.sql -f quiet_hours.sql -f family_api.sql -f school_api.sql -f ai_api.sql -f final_grades.sql -f finance.sql -f telegram.sql"
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
echo "== 4c. zavuch, class teacher, weekly tests online (test_school.sql) ==";
dropdb --if-exists maktab_t4 >/dev/null; createdb maktab_t4
psql -q -X -v ON_ERROR_STOP=1 -d maktab_t4 $LOAD >/dev/null
run maktab_t4 test_school.sql
echo "== 4d. AI: topic reviews, budget (test_ai.sql) ==";
dropdb --if-exists maktab_t5 >/dev/null; createdb maktab_t5
psql -q -X -v ON_ERROR_STOP=1 -d maktab_t5 $LOAD >/dev/null
run maktab_t5 test_ai.sql
echo "== 4e. quarter + yearly grades (test_final.sql) ==";
dropdb --if-exists maktab_t6 >/dev/null; createdb maktab_t6
psql -q -X -v ON_ERROR_STOP=1 -d maktab_t6 $LOAD >/dev/null
run maktab_t6 test_final.sql
echo "== 4f. fees, payments, accountant (test_finance.sql) ==";
dropdb --if-exists maktab_t7 >/dev/null; createdb maktab_t7
psql -q -X -v ON_ERROR_STOP=1 -d maktab_t7 $LOAD >/dev/null
run maktab_t7 test_finance.sql
echo "== 4g. school setup from Excel (test_setup.sql) ==";
dropdb --if-exists maktab_t8 >/dev/null; createdb maktab_t8
psql -q -X -v ON_ERROR_STOP=1 -d maktab_t8 $LOAD -f auth_local.sql -f school_setup.sql >/dev/null
run maktab_t8 test_setup.sql
echo "== 4h. accounts: first password, office reset, school/center (test_accounts.sql) ==";
dropdb --if-exists maktab_t9 >/dev/null; createdb maktab_t9
psql -q -X -v ON_ERROR_STOP=1 -d maktab_t9 $LOAD -f auth_local.sql -f school_setup.sql -f accounts.sql >/dev/null
run maktab_t9 test_accounts.sql
echo "== 5. AI budget race, 2 connections ==";           PGDATABASE=maktab_t2 ./test_api_race.sh || FAILED=1

if [ "$FAILED" = 0 ]; then echo "ALL TEST FILES GREEN"; else echo "SOMETHING FAILED (see above)"; exit 1; fi
