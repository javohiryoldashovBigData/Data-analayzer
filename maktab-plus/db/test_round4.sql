-- ============================================================================
-- MAKTAB+ — test_round4.sql : tests for round-4 SQL
--   R*  role-grant guard          (round4_roles_signals.sql)
--   W*  weekly test generator     (weekly_tests_gen.sql)
--   C*  curriculum next topics    (curriculum.sql)
--   Q*  quiet hours               (quiet_hours.sql)
-- Order:
--   local_compat → schema(v3) → seed → api_phase1 → round4_roles_signals
--   → weekly_tests_gen → curriculum → quiet_hours → test_rls → test_perplexity
--   → test_round4   (this file; runs in ONE transaction and rolls back)
-- Uses test.asuser / test.attack / test.blocked from test_rls.sql + test_perplexity.sql.
-- STATUS: NOT RUN (no PostgreSQL here). Parse-checked with pglast.
-- V3-ADAPT: test_questions without correct_index; keys in test_answer_keys.
-- Dates are FIXED (Nov 2026) and inside seed term 1 (2026-09-01..2026-11-15).
-- ============================================================================
begin;
reset role;
select set_config('app.current_user_id', '', false);   -- no JWT = trusted owner
truncate test.results;

-- true → statement ran and touched ≥ 1 row
create or replace function test.ok(p_sql text)
returns boolean language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n > 0;
exception when others then
  raise notice 'test.ok error: %', sqlerrm;
  return false;
end $$;
-- error message of a statement (null = no error)
create or replace function test.err(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;
grant execute on function test.ok(text), test.err(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures (owner = trusted)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
 ('aaaa0000-0000-4000-8000-0000000000f1', 'newA1@maktab.test'),
 ('aaaa0000-0000-4000-8000-0000000000f2', 'newA2@maktab.test'),
 ('aaaa0000-0000-4000-8000-0000000000f3', 'newA3@maktab.test')
on conflict do nothing;

-- R8 trusted onboarding may create a director (platform action)
select test.attack('R8 trusted onboarding (no JWT) can grant director',
  test.ok($q$ insert into user_school_roles (user_id, role, school_id)
    values ('aaaa0000-0000-4000-8000-0000000000f3', 'director', 'bbbb0000-0000-4000-8000-00000000a001') $q$));

-- weekly-test history for 5-A math
insert into weekly_tests (id, school_id, class_id, subject_id, teacher_id, term_id, test_date, topic, status) values
 ('77770000-0000-4000-8000-0000000000c1', 'bbbb0000-0000-4000-8000-00000000a001', 'dddd0000-0000-4000-8000-00000000a001',
  1, 'cccc0000-0000-4000-8000-00000000a001', 'ffff0000-0000-4000-8000-00000000a001', '2026-10-17', 'Natural sonlar', 'closed'),
 ('77770000-0000-4000-8000-0000000000c2', 'bbbb0000-0000-4000-8000-00000000a001', 'dddd0000-0000-4000-8000-00000000a001',
  1, 'cccc0000-0000-4000-8000-00000000a001', 'ffff0000-0000-4000-8000-00000000a001', '2026-11-07', 'Geometriya', 'closed'),
 ('77770000-0000-4000-8000-0000000000c3', 'bbbb0000-0000-4000-8000-00000000a001', 'dddd0000-0000-4000-8000-00000000a001',
  1, 'cccc0000-0000-4000-8000-00000000a001', 'ffff0000-0000-4000-8000-00000000a001', '2026-11-12', 'Ulushlar', 'closed');

insert into test_questions (id, test_id, question_text, options, points, position, topic) values   -- V3-ADAPT
 ('78880000-0000-4000-8000-0000000000c1', '77770000-0000-4000-8000-0000000000c1', '12+30=?', '["42","32"]', 1, 1, 'Natural sonlar'),
 ('78880000-0000-4000-8000-0000000000c2', '77770000-0000-4000-8000-0000000000c1', '9*3=?',   '["27","21"]', 1, 2, 'Natural sonlar'),
 ('78880000-0000-4000-8000-0000000000c3', '77770000-0000-4000-8000-0000000000c2', 'Uchburchak burchaklari yig‘indisi?', '["180","360"]', 1, 1, 'Geometriya'),
 ('78880000-0000-4000-8000-0000000000c4', '77770000-0000-4000-8000-0000000000c2', 'Kvadrat tomonlari soni?', '["4","3"]', 1, 2, 'Geometriya'),
 ('78880000-0000-4000-8000-0000000000c5', '77770000-0000-4000-8000-0000000000c3', '1/2 ulush?', '["yarim","chorak"]', 1, 1, 'Ulushlar');
insert into test_answer_keys (question_id, correct_index)
select q.id, 0 from test_questions q where q.id::text like '78880000-0000-4000-8000-0000000000c%';

-- answers: Natural sonlar 50% (weak), Geometriya 100%, Ulushlar 100%
insert into test_attempts (id, test_id, student_id, submitted_at, score) values
 ('7aaa0000-0000-4000-8000-0000000000c1', '77770000-0000-4000-8000-0000000000c1', 'eeee0000-0000-4000-8000-00000000a001', '2026-10-17 10:00+05', 50),
 ('7aaa0000-0000-4000-8000-0000000000c2', '77770000-0000-4000-8000-0000000000c2', 'eeee0000-0000-4000-8000-00000000a001', '2026-11-07 10:00+05', 100),
 ('7aaa0000-0000-4000-8000-0000000000c3', '77770000-0000-4000-8000-0000000000c3', 'eeee0000-0000-4000-8000-00000000a001', '2026-11-12 10:00+05', 100);
insert into attempt_answers (attempt_id, question_id, position, answer, is_correct) values
 ('7aaa0000-0000-4000-8000-0000000000c1', '78880000-0000-4000-8000-0000000000c1', 1, '0', true),
 ('7aaa0000-0000-4000-8000-0000000000c1', '78880000-0000-4000-8000-0000000000c2', 2, '1', false),
 ('7aaa0000-0000-4000-8000-0000000000c2', '78880000-0000-4000-8000-0000000000c3', 1, '0', true),
 ('7aaa0000-0000-4000-8000-0000000000c2', '78880000-0000-4000-8000-0000000000c4', 2, '0', true),
 ('7aaa0000-0000-4000-8000-0000000000c3', '78880000-0000-4000-8000-0000000000c5', 1, '0', true);

-- bank: 10 checked questions for this week (school A), 2 AI-made (must NOT be used),
-- 3 checked Library variants of the weak old topic
insert into question_bank (id, school_id, subject_id, grade_level, topic, question_text, options, status, source, created_by)
select ('79990000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid,
       'bbbb0000-0000-4000-8000-00000000a001', 1, 5, 'Kasrlarni qo‘shish',
       format('1/%s + 1/%s = ?', i + 1, i + 1), '["a","b","c"]', 'checked', 'teacher',
       'aaaa0000-0000-4000-8000-00000000a004'
from generate_series(1, 10) i;
insert into question_bank (id, school_id, subject_id, grade_level, topic, question_text, options, status, source) values
 ('79990000-0000-4000-8000-000000000201', 'bbbb0000-0000-4000-8000-00000000a001', 1, 5, 'Kasrlarni qo‘shish', 'AI q1', '["a","b"]', 'ai_made', 'ai'),
 ('79990000-0000-4000-8000-000000000202', 'bbbb0000-0000-4000-8000-00000000a001', 1, 5, '  kasrlarni   QO‘SHISH ', 'AI q2', '["a","b"]', 'ai_made', 'ai'),
 ('79990000-0000-4000-8000-000000000301', null, 1, 5, 'Natural sonlar', '15+15=?', '["30","25"]', 'checked', 'library'),
 ('79990000-0000-4000-8000-000000000302', null, 1, 5, 'Natural sonlar', '7*8=?',   '["56","54"]', 'checked', 'library'),
 ('79990000-0000-4000-8000-000000000303', null, 1, 5, 'Natural sonlar', '100-1=?', '["99","98"]', 'checked', 'library');
insert into question_bank_keys (question_id, correct_index)
select q.id, 0 from question_bank q where q.id::text like '79990000-0000-4000-8000-0000000%';

-- curriculum (FAKE topics for the test only)
insert into curriculum_topics (subject_id, grade_level, language, seq, term_no, hours, topic) values
 (1, 5, 'uz', 1, 1, 2, 'Natural sonlar'),
 (1, 5, 'uz', 2, 1, 1, 'Geometriya'),
 (1, 5, 'uz', 3, 2, 3, 'Kasrlarni qo‘shish');
insert into lesson_cards (school_id, class_id, subject_id, teacher_id, lesson_date, period, topic, status) values
 ('bbbb0000-0000-4000-8000-00000000a001', 'dddd0000-0000-4000-8000-00000000a001', 1,
  'cccc0000-0000-4000-8000-00000000a001', '2026-09-07', 1, 'Natural sonlar', 'approved'),
 ('bbbb0000-0000-4000-8000-00000000a001', 'dddd0000-0000-4000-8000-00000000a001', 1,
  'cccc0000-0000-4000-8000-00000000a001', '2026-09-08', 1, 'natural  sonlar', 'approved');

-- quiet-hours fixtures
insert into timetable_slots (class_id, day_of_week, period, subject_id, teacher_id, effective_from) values
 ('dddd0000-0000-4000-8000-00000000a001', 1, 2, 2, 'cccc0000-0000-4000-8000-00000000a001', '2026-09-01');  -- Mon p2 ends 09:40
insert into school_days_off (school_id, day, name) values (null, '2026-11-11', 'TEST day off');
insert into guardians (parent_user_id, student_id, relation, is_primary) values
 ('aaaa0000-0000-4000-8000-00000000a004', 'eeee0000-0000-4000-8000-00000000a002', 'father', true);   -- teachA is also a parent

-- ===========================================================================
-- R: role grants (as users)
-- ===========================================================================
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a001');  -- adminA (school_admin)
select test.attack('R1a school admin cannot grant SELF director',
  test.blocked($q$ insert into user_school_roles (user_id, role, school_id)
    values ('aaaa0000-0000-4000-8000-00000000a001', 'director', 'bbbb0000-0000-4000-8000-00000000a001') $q$));
select test.attack('R1b school admin cannot grant SELF even a lower role (zavuch)',
  test.blocked($q$ insert into user_school_roles (user_id, role, school_id)
    values ('aaaa0000-0000-4000-8000-00000000a001', 'zavuch', 'bbbb0000-0000-4000-8000-00000000a001') $q$));
select test.attack('R1c school admin cannot re-point a role row to self',
  test.blocked($q$ update user_school_roles set user_id = 'aaaa0000-0000-4000-8000-00000000a001'
    where user_id = 'aaaa0000-0000-4000-8000-00000000a003' and role = 'zavuch' $q$));
select test.attack('R2a school admin cannot grant school_admin (same rank)',
  test.blocked($q$ insert into user_school_roles (user_id, role, school_id)
    values ('aaaa0000-0000-4000-8000-0000000000f1', 'school_admin', 'bbbb0000-0000-4000-8000-00000000a001') $q$));
select test.attack('R2b school admin cannot upgrade zavuch row to director',
  test.blocked($q$ update user_school_roles set role = 'director'
    where user_id = 'aaaa0000-0000-4000-8000-00000000a003' and role = 'zavuch' $q$));
select test.attack('R4a school admin cannot switch off the director',
  test.blocked($q$ update user_school_roles set is_active = false
    where user_id = 'aaaa0000-0000-4000-8000-00000000a002' and role = 'director' $q$));
select test.attack('R4b school admin cannot delete the director',
  test.blocked($q$ delete from user_school_roles
    where user_id = 'aaaa0000-0000-4000-8000-00000000a002' and role = 'director' $q$));
select test.attack('R2c (positive) school admin CAN grant teacher to someone else',
  test.ok($q$ insert into user_school_roles (user_id, role, school_id, granted_by)
    values ('aaaa0000-0000-4000-8000-0000000000f1', 'teacher', 'bbbb0000-0000-4000-8000-00000000a001',
            'aaaa0000-0000-4000-8000-00000000a002') $q$));          -- tries to blame the director
reset role;
select set_config('app.current_user_id', '', false);
select test.attack('R5 granted_by is the real caller, not the spoofed value',
  (select r.granted_by from user_school_roles r
    where r.user_id = 'aaaa0000-0000-4000-8000-0000000000f1' and r.role = 'teacher')
  = 'aaaa0000-0000-4000-8000-00000000a001'::uuid);

set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a002');  -- directorA
select test.attack('R3a director cannot grant director (platform only)',
  test.blocked($q$ insert into user_school_roles (user_id, role, school_id)
    values ('aaaa0000-0000-4000-8000-0000000000f2', 'director', 'bbbb0000-0000-4000-8000-00000000a001') $q$));
select test.attack('R3b (positive) director CAN grant school_admin',
  test.ok($q$ insert into user_school_roles (user_id, role, school_id)
    values ('aaaa0000-0000-4000-8000-0000000000f2', 'school_admin', 'bbbb0000-0000-4000-8000-00000000a001') $q$));
select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
select test.attack('R2d zavuch grants nothing (v3 policy + rank)',
  test.blocked($q$ insert into user_school_roles (user_id, role, school_id)
    values ('aaaa0000-0000-4000-8000-0000000000f2', 'teacher', 'bbbb0000-0000-4000-8000-00000000a001') $q$));
reset role;
select set_config('app.current_user_id', '', false);
select test.attack('R6 leader-role grant is audited and announced to leaders',
  exists (select 1 from audit_log a where a.table_name = 'user_school_roles'
          and a.new_value->>'user_id' = 'aaaa0000-0000-4000-8000-0000000000f2'
          and a.new_value->>'role' = 'school_admin')
  and exists (select 1 from notification_outbox o
          where o.recipient_id = 'aaaa0000-0000-4000-8000-00000000a001'
            and o.payload->>'event' = 'leader_role_changed'
            and o.payload->>'target_user' = 'aaaa0000-0000-4000-8000-0000000000f2'));

-- ===========================================================================
-- W: weekly test generator
-- ===========================================================================
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
create temp table _w1 as
  select api.generate_weekly_test('dddd0000-0000-4000-8000-00000000a001', 1::smallint,
         'Kasrlarni qo‘shish', '2026-11-14', 8, 4, true, 'uz') as r;
select test.attack('W1 8 new questions picked', (select (r->>'new_count')::int from _w1) = 8);
select test.attack('W2 4 review questions from due old topics', (select (r->>'review_count')::int from _w1) = 4);
select test.attack('W3 review topics = weak + overdue ones, not the fresh one',
  (select r->'review_topics' from _w1) @> '["Natural sonlar","Geometriya"]'
  and not (select r->'review_topics' from _w1) @> '["Ulushlar"]');
select test.attack('W4 AI-made (unchecked) questions are never used',
  not exists (select 1 from test_questions tq
              where tq.test_id = (select (r->>'test_id')::uuid from _w1)
                and tq.bank_question_id in ('79990000-0000-4000-8000-000000000201','79990000-0000-4000-8000-000000000202')));
select test.attack('W5 every question has exactly one answer key',
  (select count(*) from test_questions tq where tq.test_id = (select (r->>'test_id')::uuid from _w1))
  = (select count(*) from test_answer_keys k join test_questions tq on tq.id = k.question_id
     where tq.test_id = (select (r->>'test_id')::uuid from _w1)));
select test.attack('W6 positions are 1..12 without gaps',
  (select array_agg(tq.position order by tq.position) from test_questions tq
    where tq.test_id = (select (r->>'test_id')::uuid from _w1))
  = (select array_agg(i::smallint order by i) from generate_series(1, 12) i));
select test.attack('W7 at most 2 questions per review topic',
  not exists (select 1 from test_questions tq where tq.test_id = (select (r->>'test_id')::uuid from _w1)
              and tq.is_review group by tq.topic having count(*) > 2));
select test.attack('W8 test is a DRAFT (teacher publishes — rule 1)',
  (select wt.status from weekly_tests wt where wt.id = (select (r->>'test_id')::uuid from _w1)) = 'draft');

create temp table _w2 as
  select api.generate_weekly_test('dddd0000-0000-4000-8000-00000000a001', 1::smallint,
         'kasrlarni qo‘shish', '2026-11-14', 8, 4, false, 'uz') as r;
select test.attack('W9 mix off → new block first, review block after',
  not exists (select 1 from test_questions a join test_questions b on a.test_id = b.test_id
              where a.test_id = (select (r->>'test_id')::uuid from _w2)
                and a.is_review and not b.is_review and a.position < b.position));
select test.attack('W10 unseen questions are preferred (the 2 not used in W1 are in W2)',
  (select count(*) from test_questions tq where tq.test_id = (select (r->>'test_id')::uuid from _w2)
     and tq.bank_question_id in (select q.id from question_bank q where q.status = 'checked'
                                 and q.topic_key = app.topic_key('Kasrlarni qo‘shish')
                                 and q.id not in (select t1.bank_question_id from test_questions t1
                                                  where t1.test_id = (select (r->>'test_id')::uuid from _w1)
                                                    and t1.bank_question_id is not null))) = 2);
select test.attack('W11 per-student order is stable and differs between students',
  (select array_agg(question_id order by student_position) from app.student_question_order(
      (select (r->>'test_id')::uuid from _w1), 'eeee0000-0000-4000-8000-00000000a001'))
  = (select array_agg(question_id order by student_position) from app.student_question_order(
      (select (r->>'test_id')::uuid from _w1), 'eeee0000-0000-4000-8000-00000000a001'))
  and (select array_agg(question_id order by student_position) from app.student_question_order(
      (select (r->>'test_id')::uuid from _w1), 'eeee0000-0000-4000-8000-00000000a001'))
  <> (select array_agg(question_id order by student_position) from app.student_question_order(
      (select (r->>'test_id')::uuid from _w1), 'eeee0000-0000-4000-8000-00000000a002')));
select test.attack('W12 no term for the date → no_term_for_date',
  coalesce(test.err($q$ select api.generate_weekly_test('dddd0000-0000-4000-8000-00000000a001', 1::smallint,
         'Kasrlar', '2027-07-01', 5, 0, true, 'uz') $q$), '') like '%no_term_for_date%');

select test.asuser('aaaa0000-0000-4000-8000-00000000a008');  -- teachA2, no assignment
select test.attack('W13 teacher without this class cannot generate',
  coalesce(test.err($q$ select api.generate_weekly_test('dddd0000-0000-4000-8000-00000000a001', 1::smallint,
         'Kasrlar', '2026-11-14', 5, 0, true, 'uz') $q$), '') like '%not_your_class%');
select test.asuser('aaaa0000-0000-4000-8000-00000000b002');  -- teachB, other school
select test.attack('W14 other school''s teacher cannot see school A bank',
  test.zero_or_denied($q$ select count(*) from question_bank where school_id = 'bbbb0000-0000-4000-8000-00000000a001' $q$));
select test.attack('W15 other school''s teacher CAN see checked platform Library questions',
  not test.zero_or_denied($q$ select count(*) from question_bank where school_id is null $q$));
select test.asuser('aaaa0000-0000-4000-8000-00000000a006');  -- student sA1
select test.attack('W16 student cannot read the bank',
  test.zero_or_denied($q$ select count(*) from question_bank $q$));
select test.attack('W17 student cannot read bank answer keys',
  test.zero_or_denied($q$ select count(*) from question_bank_keys $q$));
select test.attack('W18 student cannot add a bank question',
  test.blocked($q$ insert into question_bank (school_id, subject_id, grade_level, topic, question_text, options, status, created_by)
    values ('bbbb0000-0000-4000-8000-00000000a001', 1, 5, 'x', 'x', '["a","b"]', 'checked',
            'aaaa0000-0000-4000-8000-00000000a006') $q$));

-- ===========================================================================
-- C: curriculum — next topics continue after approved cards
-- ===========================================================================
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.attack('C1 next topics: Natural sonlar done (2h used) → Geometriya, then Kasrlar ×3',
  (select array_agg(n.topic order by n.lesson_no)
     from api.next_topics('dddd0000-0000-4000-8000-00000000a001', 1::smallint, 4) n)
  = array['Geometriya','Kasrlarni qo‘shish','Kasrlarni qo‘shish','Kasrlarni qo‘shish']);
select test.asuser('aaaa0000-0000-4000-8000-00000000a006');  -- student
select test.attack('C2 students do not read curriculum rows (staff only)',
  test.zero_or_denied($q$ select count(*) from curriculum_topics $q$));

-- ===========================================================================
-- Q: quiet hours (pure rule, explicit times, Asia/Tashkent = +05)
-- ===========================================================================
reset role;
select set_config('app.current_user_id', '', false);
select test.attack('Q1 gate alert to parent at 23:00 is immediate',
  (select deliver_at from app.deliver_after('aaaa0000-0000-4000-8000-00000000a005', 'gate_in',
     'bbbb0000-0000-4000-8000-00000000a001', 'eeee0000-0000-4000-8000-00000000a001',
     '2026-11-12 23:00+05')) is null);
select test.attack('Q2 grade to parent at 22:00 → 07:00 next day',
  (select deliver_at from app.deliver_after('aaaa0000-0000-4000-8000-00000000a005', 'grade_posted',
     'bbbb0000-0000-4000-8000-00000000a001', 'eeee0000-0000-4000-8000-00000000a001',
     '2026-11-12 22:00+05')) = '2026-11-13 07:00+05'::timestamptz);
select test.attack('Q3 work message to teacher at 19:00 Thu → Fri 07:30 (first bell 08:00 − 30 min)',
  (select deliver_at from app.deliver_after('aaaa0000-0000-4000-8000-00000000a004', 'announcement',
     'bbbb0000-0000-4000-8000-00000000a001', null, '2026-11-12 19:00+05')) = '2026-11-13 07:30+05'::timestamptz);
select test.attack('Q4 work message to teacher at 10:00 on a school day is immediate',
  (select deliver_at from app.deliver_after('aaaa0000-0000-4000-8000-00000000a004', 'announcement',
     'bbbb0000-0000-4000-8000-00000000a001', null, '2026-11-12 10:00+05')) is null);
insert into teacher_day_closures (teacher_id, day, school_id)
values ('cccc0000-0000-4000-8000-00000000a001', '2026-11-12', 'bbbb0000-0000-4000-8000-00000000a001');
select test.attack('Q5 after close_day the same 15:00 message waits for tomorrow 07:30',
  (select (deliver_at, reason)::text from app.deliver_after('aaaa0000-0000-4000-8000-00000000a004', 'announcement',
     'bbbb0000-0000-4000-8000-00000000a001', null, '2026-11-12 15:00+05'))
  = ('2026-11-13 07:30+05'::timestamptz, 'day_closed')::text);
select test.attack('Q6 Sunday 10:00 → Monday 07:30',
  (select deliver_at from app.deliver_after('aaaa0000-0000-4000-8000-00000000a004', 'announcement',
     'bbbb0000-0000-4000-8000-00000000a001', null, '2026-11-08 10:00+05')) = '2026-11-09 07:30+05'::timestamptz);
select test.attack('Q7 national day off 10:00 → next school day 07:30',
  (select deliver_at from app.deliver_after('aaaa0000-0000-4000-8000-00000000a004', 'announcement',
     'bbbb0000-0000-4000-8000-00000000a001', null, '2026-11-11 10:00+05')) = '2026-11-12 07:30+05'::timestamptz);
select test.attack('Q8 homework to student during lessons (Mon 08:30) → after last bell 09:40',
  (select deliver_at from app.deliver_after('aaaa0000-0000-4000-8000-00000000a006', 'homework',
     'bbbb0000-0000-4000-8000-00000000a001', 'eeee0000-0000-4000-8000-00000000a001',
     '2026-11-09 08:30+05')) = '2026-11-09 09:40+05'::timestamptz);
select test.attack('Q9 teacher who is ALSO a parent: own child''s grade at 19:00 is family, not work → immediate',
  (select deliver_at from app.deliver_after('aaaa0000-0000-4000-8000-00000000a004', 'grade_posted',
     'bbbb0000-0000-4000-8000-00000000a001', 'eeee0000-0000-4000-8000-00000000a002',
     '2026-11-12 19:00+05')) is null);
select test.attack('Q10 teacher before work (06:50) → 07:30 same day',
  (select deliver_at from app.deliver_after('aaaa0000-0000-4000-8000-00000000a004', 'problem',
     'bbbb0000-0000-4000-8000-00000000a001', null, '2026-11-13 06:50+05')) = '2026-11-13 07:30+05'::timestamptz);

-- trigger + worker
insert into notification_outbox (recipient_id, payload, created_at) values
 ('aaaa0000-0000-4000-8000-00000000a004', '{"kind":"announcement","school_id":"bbbb0000-0000-4000-8000-00000000a001","t":"held"}', now()),
 ('aaaa0000-0000-4000-8000-00000000a005', '{"kind":"gate_in","student_id":"eeee0000-0000-4000-8000-00000000a001","t":"now"}', now());
-- force the first one into the future regardless of today's real clock
update notification_outbox set deliver_after = now() + interval '3 hours', held_reason = 'test'
 where payload->>'t' = 'held';
select test.attack('Q11 trigger fills school_id from the student',
  (select o.school_id from notification_outbox o where o.payload->>'t' = 'now')
  = 'bbbb0000-0000-4000-8000-00000000a001'::uuid);
select test.attack('Q12 gate alert is never held by the trigger',
  (select o.deliver_after from notification_outbox o where o.payload->>'t' = 'now') is null);
create temp table _claim as select * from app.outbox_claim(1000);
select test.attack('Q13 worker takes due rows and skips held ones',
  exists (select 1 from _claim c where c.payload->>'t' = 'now')
  and not exists (select 1 from _claim c where c.payload->>'t' = 'held'));

-- ===========================================================================
reset role;
select name, case when ok then 'PASS' else 'FAIL' end as result, note
from test.results order by name;
do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from test.results;
  if f > 0 then raise exception 'test_round4: % of % checks FAILED', f, t; end if;
  raise notice 'test_round4: all % checks passed', t;
end $$;
rollback;
