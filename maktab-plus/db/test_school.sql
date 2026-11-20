-- ============================================================================
-- MAKTAB+ — tests for school_api.sql (step 4). Fresh database:
--   local_compat, schema, seed, api_phase1, family_api, round4_roles_signals,
--   weekly_tests_gen, curriculum, quiet_hours, school_api   then this file.
-- ============================================================================
create schema if not exists test;
select set_config('test.passed', '0', false), set_config('test.failed', '0', false);
create or replace function test.asuser(p_user uuid) returns void language plpgsql as $$
begin perform set_config('app.current_user_id', p_user::text, false); end $$;
create or replace function test.count(p_sql text) returns bigint language plpgsql as $$
declare c bigint; begin execute p_sql into c; return c; end $$;
create or replace function test.error(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
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

-- ---- weekly test: teacher builds it from the school's own question bank ----
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA (maths 5-A)
select api.save_bank_question(1::smallint, 5::smallint, 'Kasrlar', '1/2 + 1/4 = ?', '["3/4","2/6","1/8","1"]', 0::smallint);
select api.save_bank_question(1::smallint, 5::smallint, 'Kasrlar', '2/3 − 1/3 = ?', '["1/3","1","0","2/3"]', 0::smallint);
select api.save_bank_question(1::smallint, 5::smallint, 'Kasrlar', '3/4 ning yarmi?', '["3/8","3/2","1/4","6/4"]', 0::smallint);
select set_config('test.t', (api.generate_weekly_test('dddd0000-0000-4000-8000-00000000a001', 1::smallint, 'Kasrlar',
                    '2026-11-12', 3, 0, true, 'uz')->>'test_id'), false);
select test.check('S1 generator made a DRAFT test with 3 questions from the bank',
  test.count(format($q$ select count(*) from test_questions where test_id = %L $q$, current_setting('test.t'))) = 3);

select test.asuser('aaaa0000-0000-4000-8000-00000000a006');  -- studA1
select test.check('S2 student does NOT see the draft',
  test.count($q$ select jsonb_array_length(api.my_tests()) $q$) = 0);

select test.asuser('aaaa0000-0000-4000-8000-00000000a004');
update weekly_tests set status = 'published' where id = current_setting('test.t')::uuid;

select test.asuser('aaaa0000-0000-4000-8000-00000000a006');  -- studA1
select test.check('S3 student sees the published test',
  test.count($q$ select jsonb_array_length(api.my_tests()) $q$) = 1);
select set_config('test.a', (api.start_test(current_setting('test.t')::uuid)->>'attempt_id'), false);
select test.check('S4 start_test gives 3 questions and NO answer keys',
  test.count(format($q$ select jsonb_array_length(api.start_test(%L)->'questions') $q$, current_setting('test.t'))) = 3
  and test.count(format($q$ select count(*) from (select api.start_test(%L)::text j) x where j like '%%correct%%' $q$, current_setting('test.t'))) = 0);
-- answer: all three "0" (the right option is always index 0 in this fixture)
select api.save_answer(current_setting('test.a')::uuid, q.id, 0)
from test_questions q where q.test_id = current_setting('test.t')::uuid;
select test.check('S5 server scores the test: 3/3 = 100',
  test.count(format($q$ select app.submit_attempt(%L)::bigint $q$, current_setting('test.a'))) = 100);
select test.check('S6 answers are locked after submitting',
  test.error(format($q$ select api.save_answer(%L, (select id from test_questions where test_id = %L limit 1), 1) $q$,
                    current_setting('test.a'), current_setting('test.t'))));

select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
select test.check('S7 a parent cannot take the test for the child',
  test.error(format($q$ select api.start_test(%L) $q$, current_setting('test.t'))));

select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('S8 teacher sees results: topic Kasrlar 100%% correct',
  test.count(format($q$ select (api.test_results(%L)->'topics'->0->>'correct_pct')::bigint $q$, current_setting('test.t'))) = 100);
select test.check('S9 teacher''s list shows 1 submitted',
  test.count($q$ select (api.teacher_tests()->0->>'submitted')::bigint $q$) = 1);
select test.asuser('aaaa0000-0000-4000-8000-00000000b002');  -- teachB (school B)
select test.check('S10 teacher of another school cannot read the results',
  test.error(format($q$ select api.test_results(%L) $q$, current_setting('test.t'))));

-- ---- class teacher: My class ----
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA = class teacher 5-A
select test.check('S11 class teacher sees own class (5-A, 2 students)',
  test.count($q$ select jsonb_array_length(api.my_class_overview()->'students') $q$) = 2
  and test.count($q$ select count(*) from (select api.my_class_overview()->>'class' c) x where c = '5-A' $q$) = 1);
select test.check('S12 My class never contains money / payment data',
  test.count($q$ select count(*) from (select api.my_class_overview()::text j) x where j ~* 'invoice|debt|payment|fee' $q$) = 0);
select test.asuser('aaaa0000-0000-4000-8000-00000000a008');  -- teachA2 (no class)
select test.check('S13 a teacher without a class gets nothing',
  test.error($q$ select api.my_class_overview() $q$));

-- ---- zavuch: today's check ----
select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
select test.check('S14 zavuch sees every teacher of the school (2)',
  test.count($q$ select jsonb_array_length(api.school_day_check('2026-11-09')) $q$) = 2);
select test.check('S15 Monday: teachA has 1 lesson in the timetable',
  test.count($q$ select count(*) from jsonb_array_elements(api.school_day_check('2026-11-09')) x
               where x->>'teacher_id' = 'cccc0000-0000-4000-8000-00000000a001' and (x->>'lessons')::int = 1 $q$) = 1);
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('S16 a teacher cannot see the zavuch check',
  test.error($q$ select api.school_day_check('2026-11-09') $q$));
select test.asuser('aaaa0000-0000-4000-8000-00000000b001');  -- adminB
select test.check('S17 school B admin sees only school B teachers (1)',
  test.count($q$ select jsonb_array_length(api.school_day_check('2026-11-09')) $q$) = 1);

reset role;
do $$
declare p int := current_setting('test.passed')::int; f int := current_setting('test.failed')::int;
begin
  if f > 0 then raise exception 'SCHOOL RESULT: % passed, % FAILED', p, f; end if;
  raise notice 'SCHOOL RESULT: all % scenarios passed', p;
end $$;
