#!/usr/bin/env bash
# MAKTAB+ — 2-connection race test for the AI budget (Perplexity A15d / doc 07 §8.5).
# Two sessions ask for 150 cents at the same moment; the limit is 200.
# Exactly ONE must succeed. Needs a database loaded with schema + seed + api_phase1.
# Usage: PGDATABASE=mydb ./test_api_race.sh
set -u
SQL="set role authenticated;
select set_config('app.current_user_id','aaaa0000-0000-4000-8000-00000000a004',false);
begin;
select app.ai_reserve('bbbb0000-0000-4000-8000-00000000a001','test_build',150);
select pg_sleep(2);   -- hold the transaction open so the other session overlaps
commit;"
psql -q -X -c "update ai_reservations set status='released' where feature='test_build'" >/dev/null
psql -q -X -c "$SQL" >/tmp/race1.out 2>&1 &
sleep 0.3
psql -q -X -c "$SQL" >/tmp/race2.out 2>&1 &
wait
ok=$(grep -L "ERROR" /tmp/race1.out /tmp/race2.out | wc -l)
limited=$(grep -l "limit_reached" /tmp/race1.out /tmp/race2.out | wc -l)
if [ "$ok" = 1 ] && [ "$limited" = 1 ]; then
  echo "PASS  RACE: two parallel 150-cent reservations at limit 200 → exactly one passes"
else
  echo "FAIL  RACE: $ok succeeded, $limited got limit_reached"; cat /tmp/race1.out /tmp/race2.out; exit 1
fi
