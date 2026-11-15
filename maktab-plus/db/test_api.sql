-- ============================================================================
-- MAKTAB+ — tests for api_phase1.sql (the teacher's day)
-- Covers Perplexity's list in docs/07-api-phase1.md §8, plus the happy path.
--
--   psql -v ON_ERROR_STOP=1 -f local_compat.sql -f schema.sql -f seed.sql \
--        -f api_phase1.sql -f test_api.sql
--   ./test_api_race.sh        (the 2-connection AI budget race, §8.5)
--
-- Lesson used: Monday 2026-11-09, period 1, 5-A maths, teacher teachA
-- (seed timetable: Monday period 1). Inside term 1.
-- ============================================================================
create schema if not exists test;
select set_config('test.passed', '0', false), set_config('test.failed', '0', false);
create or replace function test.asuser(p_user uuid) returns void language plpgsql as $$
begin perform set_config('app.current_user_id', p_user::text, false); end $$;
create or replace function test.count(p_sql text) returns bigint language plpgsql as $$
declare c bigint; begin execute p_sql into c; return c; end $$;
create or replace function test.error(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function test.errcode(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'no_error'; exception when others then return sqlerrm; end $$;
create or replace function test.check(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then
    perform set_config('test.passed', (current_setting('test.passed')::int + 1)::text, false);
    raise notice 'PASS  %', p_name;
  else
    perform set_config('test.failed', (current_setting('test.failed')::int + 1)::text, false);
    raise warning 'FAIL  %', p_name;
  end if;
end $$;
grant usage on schema test to authenticated;
grant execute on all functions in schema test to authenticated;

set role authenticated;

-- ---- 1. My day -------------------------------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('API1a My day: teacher sees 1 lesson on Monday (5-A, maths, period 1, 08:00)',
  test.count($q$ select count(*) from jsonb_array_elements(api.my_day('2026-11-09')->'lessons') l
               where l->>'class' = '5-A' and (l->>'period')::int = 1 and l->>'start' = '08:00:00' $q$) = 1);
select test.check('API1b My day: no lessons on Sunday',
  test.count($q$ select jsonb_array_length(api.my_day('2026-11-15')->'lessons') $q$) = 0);

select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
select test.check('API1c (§8.4) parent calling My day gets no lessons',
  test.count($q$ select jsonb_array_length(api.my_day('2026-11-09')->'lessons') $q$) = 0);
select test.check('API1d parent calling ask_first gets nobody (list is teacher-only)',
  test.count($q$ select jsonb_array_length(api.ask_first('dddd0000-0000-4000-8000-00000000a001', 1::smallint, 3)) $q$) = 0);

-- ---- 2. Lesson card ----------------------------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('API2a teacher opens the lesson card (draft created)',
  test.count($q$ select count(*) from (select api.open_lesson_card('dddd0000-0000-4000-8000-00000000a001', 1::smallint,
                 '2026-11-09', 1::smallint)) x $q$) = 1
  and test.count('select count(*) from lesson_cards') = 1);
select test.check('API2b opening again returns the SAME card (one card per lesson)',
  test.count($q$ select count(*) from (select api.open_lesson_card('dddd0000-0000-4000-8000-00000000a001', 1::smallint,
                 '2026-11-09', 1::smallint)) x $q$) = 1
  and test.count('select count(*) from lesson_cards') = 1);
select api.save_lesson_card((select id from lesson_cards limit 1),
  '{"topic":"Kasrlarni qo''shish","plan":"1) takrorlash 2) yangi mavzu",
    "exit_questions":["1/2+1/4=?","2/3-1/3=?","Umumiy maxraj nima?"]}', true);
select test.check('API2c save + approve: topic saved, status approved, 3 exit questions stored with school A',
  test.count($q$ select count(*) from lesson_cards lc join exit_checks ec on ec.card_id = lc.id
               where lc.topic = 'Kasrlarni qo''shish' and lc.status = 'approved'
                 and jsonb_array_length(ec.questions) = 3
                 and ec.school_id = 'bbbb0000-0000-4000-8000-00000000a001' $q$) = 1);

select test.asuser('aaaa0000-0000-4000-8000-00000000b002');  -- teachB (school B)
select test.check('API2d teacher of school B CANNOT edit teacher A''s card',
  test.error($q$ select api.save_lesson_card('00000000-0000-0000-0000-000000000000'::uuid, '{}', false) $q$)
  and test.errcode(format($q$ select api.save_lesson_card(%L::uuid, '{"topic":"hack"}', false) $q$,
        (select id::text from (select id from public.lesson_cards limit 1) x)))
      like '%card_not_found_or_denied%');

-- ---- 3. After lesson -------------------------------------------------------------
select test.check('API3a (§8.1) teacher B CANNOT finish teacher A''s lesson',
  test.errcode($q$ select api.finish_lesson((select id from lesson_cards limit 1),
     '{"client_op_id":"11111111-1111-4111-8111-111111111111"}') $q$) like '%card_not_found_or_denied%');
reset role;
select test.check('API3a2 (owner view) the card is unchanged after teacher B''s attempts',
  test.count($q$ select count(*) from lesson_cards where topic = 'Kasrlarni qo''shish' $q$) = 1);
set role authenticated;

select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('API3b (§8.3-style) a grade for another school''s student makes the WHOLE call fail, nothing saved',
  test.error($q$ select api.finish_lesson((select id from lesson_cards limit 1),
     '{"client_op_id":"22222222-2222-4222-8222-222222222222",
       "grades":[{"student_id":"eeee0000-0000-4000-8000-00000000b001","value":5}]}') $q$)
  and test.count('select count(*) from attendance_logs') = 0);

select api.finish_lesson((select id from lesson_cards limit 1),
  '{"client_op_id":"33333333-3333-4333-8333-333333333333",
    "absent":["eeee0000-0000-4000-8000-00000000a002","eeee0000-0000-4000-8000-00000000b001"],
    "homework":{"description":"45-bet, 1-4"},
    "grades":[{"student_id":"eeee0000-0000-4000-8000-00000000a001","value":5,
               "comment":"Keyingi qadam: umumiy maxrajni tekshiring"}],
    "exit":{"results":[{"q":1,"got_it":1,"total":2}],"not_got":["eeee0000-0000-4000-8000-00000000a002"]},
    "note":"Malika bilan gaplashish"}');
select test.check('API3c after lesson: attendance for the whole roster (Jasur present, Malika absent)',
  test.count($q$ select count(*) from attendance_logs where date = '2026-11-09' and period = 1 $q$) = 2
  and test.count($q$ select count(*) from attendance_logs where status = 'absent'
                   and student_id = 'eeee0000-0000-4000-8000-00000000a002' $q$) = 1);
select test.check('API3d (§8.3) an "absent" id from another class is ignored (only the roster is written)',
  test.count($q$ select count(*) from attendance_logs where student_id = 'eeee0000-0000-4000-8000-00000000b001' $q$) = 0);
select test.check('API3e grade with a task + next-step comment saved; homework due next day; lesson marked done',
  test.count($q$ select count(*) from grades where value = 5 and comment like 'Keyingi qadam%' $q$) = 1
  and test.count($q$ select count(*) from homework where due_date = '2026-11-10' $q$) = 1
  and test.count('select count(*) from lesson_reports') = 1);
select test.check('API3f (§8.2) same client_op_id sent again (offline retry) → nothing doubled',
  test.count($q$ select count(*) from (select api.finish_lesson((select id from lesson_cards limit 1),
     '{"client_op_id":"33333333-3333-4333-8333-333333333333",
       "grades":[{"student_id":"eeee0000-0000-4000-8000-00000000a001","value":5}]}')) x $q$) = 1
  and test.count('select count(*) from grades') = 1
  and test.count('select count(*) from homework') = 1);
select test.check('API3g My day now shows attendance done + lesson done',
  test.count($q$ select count(*) from jsonb_array_elements(api.my_day('2026-11-09')->'lessons') l
               where (l->>'attendance_done')::boolean and (l->>'lesson_done')::boolean $q$) = 1);
select test.check('API3h who to ask first: Malika is first (didn''t get the exit check + absent)',
  test.count($q$ select count(*) from (select api.ask_first('dddd0000-0000-4000-8000-00000000a001', 1::smallint, 3)->0 as top) x
               where top->>'name' = 'Malika Q.' $q$) = 1);

select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
select test.check('API3i parent CANNOT read the exit check, lesson report or private note',
  test.count($q$ select (select count(*) from exit_checks) + (select count(*) from lesson_reports) $q$) = 0);

-- ---- 4. Finished for today ------------------------------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('API4a checklist: all of Monday''s items done',
  test.count($q$ select count(*) from (select api.day_checklist('2026-11-09') c) x
               where (c->>'done')::int = (c->>'total')::int and (c->>'total')::int >= 3 $q$) = 1);
select test.check('API4b (§8.7) closing a day WITH open items never blocks; open items are carried over',
  test.count($q$ select count(*) from (select api.close_day('2026-11-16') c) x where (c->>'closed')::boolean $q$) = 1
  and test.count($q$ select count(*) from teacher_day_closures where day = '2026-11-16'
                   and jsonb_array_length(open_items) >= 1 $q$) = 1);

-- ---- 5. AI budget: reserve → commit ------------------------------------------------------
-- school A is on Standard: teacher lesson_prep = 200 cents / month (placeholder)
select test.check('API5a teacher reserves budget for weekly prep (Standard plan allows it)',
  test.count($q$ select count(*) from (select app.ai_reserve('bbbb0000-0000-4000-8000-00000000a001', 'lesson_prep', 120)) x $q$) = 1);
select test.check('API5b a second reservation that would pass the limit (120 pending + 100 > 200) is refused',
  test.errcode($q$ select app.ai_reserve('bbbb0000-0000-4000-8000-00000000a001', 'lesson_prep', 100) $q$) like '%limit_reached%');
select test.check('API5c teacher CANNOT commit usage or store AI cards (service role only)',
  test.error($q$ select app.ai_commit((select id from ai_reservations limit 1), 'm', 1, 1, 0) $q$)
  and test.error($q$ select app.ai_store_lesson_cards((select id from ai_reservations limit 1), '[]') $q$));
select test.asuser('aaaa0000-0000-4000-8000-00000000a006');  -- studA1
select test.check('API5d (§8.5) student on a Standard school → plan_not_allowed',
  test.errcode($q$ select app.ai_reserve('bbbb0000-0000-4000-8000-00000000a001', 'tutor', 1) $q$) like '%plan_not_allowed%');
select test.asuser('aaaa0000-0000-4000-8000-00000000b002');  -- teachB
select test.check('API5e teacher of school B cannot reserve school A''s budget',
  test.errcode($q$ select app.ai_reserve('bbbb0000-0000-4000-8000-00000000a001', 'lesson_prep', 1) $q$) like '%not_member%');

reset role;
-- service role: the batch finished — store drafts, commit real cost
select test.check('API5f (§8.6) storing an AI card for a class the teacher does NOT teach → 0 cards',
  app.ai_store_lesson_cards((select id from ai_reservations limit 1),
    '[{"class_id":"dddd0000-0000-4000-8000-00000000b001","subject_id":1,"date":"2026-11-16","period":1,"topic":"x"}]') = 0);
select set_config('test.stored', app.ai_store_lesson_cards((select id from ai_reservations limit 1),
    '[{"class_id":"dddd0000-0000-4000-8000-00000000a001","subject_id":1,"date":"2026-11-16","period":1,
       "topic":"Kasrlarni ayirish","plan":"...","exit_questions":["a","b","c"]}]')::text, false);
select test.check('API5g storing a card for own class → 1 AI draft with exit questions',
  current_setting('test.stored') = '1'
  and (select count(*) from lesson_cards where status = 'ai_draft' and ai_generated) = 1
  and (select count(*) from exit_checks ec join lesson_cards lc on lc.id = ec.card_id
        where lc.status = 'ai_draft' and jsonb_array_length(ec.questions) = 3) = 1);
select app.ai_commit((select id from ai_reservations limit 1), 'sonnet-batch', 9000, 4000, 15);
select test.check('API5h commit: reservation closed, real cost (15) logged',
  (select count(*) from ai_reservations where status = 'committed') = 1
  and (select count(*) from ai_usage_log where cost_cents = 15 and feature = 'lesson_prep') = 1);
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('API5i budget left = 200 - 15 = 185 (the reservation no longer counts)',
  test.count($q$ select remaining_cents::bigint from app.ai_check('bbbb0000-0000-4000-8000-00000000a001','lesson_prep') $q$) = 185);
select test.check('API5j the AI draft appears in the teacher''s weekly view; the teacher must approve it',
  test.count($q$ select count(*) from lesson_cards where status = 'ai_draft' $q$) = 1);

-- ---------------------------------------------------------------------------
reset role;
do $$
declare p int := current_setting('test.passed')::int; f int := current_setting('test.failed')::int;
begin
  if f > 0 then raise exception 'API RESULT: % passed, % FAILED', p, f; end if;
  raise notice 'API RESULT: all % scenarios passed', p;
end $$;
