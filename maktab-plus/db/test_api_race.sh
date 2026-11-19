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

# V3.2: the same "after lesson" save sent twice at the same moment (offline
# queue + reconnect) → both calls succeed, nothing is written twice.
CARD=$(psql -q -X -At -c "select id from lesson_cards where teacher_id = 'cccc0000-0000-4000-8000-00000000a001' limit 1")
if [ -z "$CARD" ]; then
  psql -q -X -At -c "insert into lesson_cards (school_id, class_id, subject_id, teacher_id, lesson_date, period)
    values ('bbbb0000-0000-4000-8000-00000000a001','dddd0000-0000-4000-8000-00000000a001',1,'cccc0000-0000-4000-8000-00000000a001','2026-11-09',1)
    on conflict do nothing" >/dev/null
  CARD=$(psql -q -X -At -c "select id from lesson_cards where teacher_id = 'cccc0000-0000-4000-8000-00000000a001' limit 1")
fi
OP=$(python3 -c "import uuid;print(uuid.uuid4())")
SQL2="set role authenticated;
select set_config('app.current_user_id','aaaa0000-0000-4000-8000-00000000a004',false);
begin;
select (api.finish_lesson('$CARD', '{\"client_op_id\":\"$OP\",\"grades\":[{\"student_id\":\"eeee0000-0000-4000-8000-00000000a002\",\"value\":4}]}')->>'ok');
select pg_sleep(1);
commit;"
psql -q -X -c "$SQL2" >/tmp/dup1.out 2>&1 &
sleep 0.2
psql -q -X -c "$SQL2" >/tmp/dup2.out 2>&1 &
wait
n=$(psql -q -X -At -c "select count(*) from grades where student_id='eeee0000-0000-4000-8000-00000000a002' and value=4 and term_id is not null and created_at > now() - interval '1 minute'")
if ! grep -q ERROR /tmp/dup1.out /tmp/dup2.out && [ "$n" = 1 ]; then
  echo "PASS  RACE: the same save sent twice at once → both answered OK, 1 grade written"
else
  echo "FAIL  RACE: duplicate save ($n grades)"; cat /tmp/dup1.out /tmp/dup2.out; exit 1
fi
