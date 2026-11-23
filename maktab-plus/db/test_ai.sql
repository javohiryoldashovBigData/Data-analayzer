-- ============================================================================
-- MAKTAB+ — tests for ai_api.sql (step 5). Fresh database with the full stack
-- (local_compat … school_api, ai_api) + seed.sql, then this file.
-- ============================================================================
create schema if not exists test;
select set_config('test.passed', '0', false), set_config('test.failed', '0', false);
create or replace function test.asuser(p_user uuid) returns void language plpgsql as $$
begin perform set_config('app.current_user_id', p_user::text, false); end $$;
create or replace function test.count(p_sql text) returns bigint language plpgsql as $$
declare c bigint; begin execute p_sql into c; return c; end $$;
create or replace function test.error(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function test.rows(p_sql text) returns boolean language plpgsql as $$
declare n bigint; begin execute p_sql; get diagnostics n = row_count; return n > 0;
exception when others then return false; end $$;
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

-- a lesson where Jasur (sA1) didn't get the exit check
insert into lesson_cards (id, school_id, class_id, subject_id, teacher_id, lesson_date, period, topic, status)
values ('c4000000-0000-4000-8000-000000000001','bbbb0000-0000-4000-8000-00000000a001','dddd0000-0000-4000-8000-00000000a001',1,
        'cccc0000-0000-4000-8000-00000000a001', current_date, 1, 'Kasrlar', 'approved');
insert into exit_checks (card_id, school_id, questions, not_got, recorded_at)
values ('c4000000-0000-4000-8000-000000000001','bbbb0000-0000-4000-8000-00000000a001','["a","b","c"]',
        '{eeee0000-0000-4000-8000-00000000a001}', now());

select test.check('AI-R1 the night worker finds 1 review job (class + topic)',
  (select count(*) from app.ai_review_jobs()) = 1);
select test.check('AI-R2 the job carries topic and grade only — no student names',
  (select count(*) from app.ai_review_jobs() j where j.topic = 'Kasrlar' and j.grade_level = 5) = 1
  and (select to_jsonb(j)::text from app.ai_review_jobs() j limit 1) not like '%Jasur%');

set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('AI-R3 logged-in users CANNOT call the worker functions',
  test.error('select * from app.ai_review_jobs()')
  and test.error($q$ select app.ai_store_topic_review(gen_random_uuid(), '{}') $q$));
-- the worker reserves in the teacher's name (same budget checks as everyone)
select set_config('test.res', app.ai_reserve('bbbb0000-0000-4000-8000-00000000a001', 'topic_review', 1,
                  '{"kind":"review","card_id":"c4000000-0000-4000-8000-000000000001"}')::text, false);
reset role;
select test.check('AI-R4 a reserved job is not picked twice',
  (select count(*) from app.ai_review_jobs()) = 0);
select app.ai_store_topic_review(current_setting('test.res')::uuid,
  '{"title":"Kasrlar — takrorlash","steps":["1","2","3","4","5"],"example":"1/2 + 1/4 = 3/4","try_it":"1/3 + 1/3 = ?"}');
select test.check('AI-R5 review stored once for the class + topic, for the students who didn''t get it',
  (select count(*) from topic_reviews where topic = 'Kasrlar' and student_ids = '{eeee0000-0000-4000-8000-00000000a001}') = 1);
select test.check('AI-R6 the student got a "review ready" alert',
  (select count(*) from notification_outbox where payload->>'event' = 'topic_review_ready'
     and recipient_id = 'aaaa0000-0000-4000-8000-00000000a006') = 1);

set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a006');  -- studA1 (Jasur)
select test.check('AI-R7 the student who didn''t get it sees the review',
  test.count($q$ select jsonb_array_length(api.my_reviews()) $q$) = 1);
select test.check('AI-R8 … but cannot change it',
  not test.rows($q$ update topic_reviews set content = '{}' $q$));
select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA (Jasur's mother)
select test.check('AI-R9 the parent sees it too',
  test.count('select count(*) from topic_reviews') = 1);
select test.asuser('aaaa0000-0000-4000-8000-00000000b002');  -- teachB
select test.check('AI-R10 another school sees nothing',
  test.count('select count(*) from topic_reviews') = 0);
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('AI-R11 the teacher can correct the AI text',
  test.rows($q$ update topic_reviews set content = content || '{"title":"Kasrlar — ustoz tuzatgan"}' $q$));
select test.check('AI-R12 teacher sees own budget; school totals hidden from teachers',
  test.count($q$ select count(*) from (select api.ai_budget() b) x where b ? 'my_remaining_cents' and b->'school' = 'null'::jsonb $q$) = 1);
select test.asuser('aaaa0000-0000-4000-8000-00000000a001');  -- adminA
select test.check('AI-R13 school admin sees the school cap and spend',
  test.count($q$ select count(*) from (select api.ai_budget() b) x where (b->'school'->>'cap_cents')::numeric = 500 $q$) = 1);

reset role;
do $$
declare p int := current_setting('test.passed')::int; f int := current_setting('test.failed')::int;
begin
  if f > 0 then raise exception 'AI RESULT: % passed, % FAILED', p, f; end if;
  raise notice 'AI RESULT: all % scenarios passed', p;
end $$;
