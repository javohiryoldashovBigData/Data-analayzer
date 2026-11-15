-- ============================================================================
-- MAKTAB+ — test_v3.sql : ATTACK tests (Perplexity review, brief v2 §11.1)
--
-- STATUS: written by Perplexity against v2; ADAPTED TO V3 by Claude (marked
-- "V3-ADAPT"): super admin = seed user c001, answer key lives in
-- test_answer_keys, app.ai_check returns a row (allowed, reason, …).
-- Run AFTER test_rls.sql on the same database.
--
-- Usage (after the normal suite):
--   psql -v ON_ERROR_STOP=1 -f local_compat.sql -f schema.sql -f seed.sql \
--        -f test_rls.sql -f test_v3.sql
--
-- Style: same helpers as test_rls.sql (test.asuser / test.count / test.error).
-- Difference: attacks are RECORDED, not aborted on first failure, so one run
-- shows every hole. The script raises at the end if anything failed.
--
-- Every test is phrased "attack X is BLOCKED". PASS = secure.
-- Expected result on v2: many FAILs (that is the point — each one is a real
-- hole found by reading the v2 policies). On v3 every line must PASS.
--
-- Index (hole → where in v2):
--   A1  parent files absence report for someone else's child
--       (absence_reports_insert: `g.student_id = student_id` resolves to
--        g.student_id = g.student_id → always true; school_id unchecked)
--   A2  teacher re-points own attendance row to another school's student
--       (attendance_update: `marked_by = auth.uid()` alone passes WITH CHECK)
--   A3  student reads the answer key (test_questions.correct_index)
--   A4  student self-scores: attempt with score, answers with is_correct,
--       attempt on another school's / unpublished test
--   A5  teacher enters or upgrades to a FINAL grade (decision §9.3)
--   A6  zavuch grants self director / school_admin, or deactivates director
--   A7  any zavuch in the country marks a library item 'checked'
--   A8  platform super admin reads children's data (decision §9.2)
--   A9  district admin of a GOVERNMENT school reads names (numbers only)
--   A10 lesson card with spoofed school_id leaks to another school
--   A11 parent reads teacher phone number (decision §9.1: names only)
--   A12 parent still sees a soft-deleted grade
--   A13 manager posts announcement under someone else's name
--   A14 user writes own AI usage / quota (resets the AI budget)
--   A15 app.ai_check: Standard school student uses AI; cross-school check
--   A16 parent approves own absence report (regression)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Result collector (owner-side)
-- ---------------------------------------------------------------------------
reset role;
create schema if not exists test;
create table if not exists test.results (name text, ok boolean, note text);
truncate test.results;
grant usage on schema test to authenticated;
grant insert, select on test.results to authenticated;

create or replace function test.attack(p_name text, p_blocked boolean, p_note text default null)
returns void language plpgsql as $$
begin
  insert into test.results values (p_name, p_blocked, p_note);
  if p_blocked then raise notice 'PASS  %', p_name;
  else              raise warning 'FAIL  %  %', p_name, coalesce(p_note, ''); end if;
end $$;

-- true → statement was rejected OR affected 0 rows (attack blocked)
create or replace function test.blocked(p_sql text)
returns boolean language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n = 0;
exception when others then
  return true;
end $$;

-- true → query errored (e.g. column privilege revoked) or returned 0
create or replace function test.zero_or_denied(p_sql text)
returns boolean language plpgsql as $$
declare c bigint;
begin
  execute p_sql into c;
  return coalesce(c, 0) = 0;
exception when others then
  return true;
end $$;

grant execute on all functions in schema test to authenticated;

-- ---------------------------------------------------------------------------
-- Extra fixtures (owner / service role)
-- ---------------------------------------------------------------------------
-- V3-ADAPT: the super admin already exists in the v3 seed (c001).
insert into auth.users (id, email) values
 ('aaaa0000-0000-4000-8000-00000000b0dd', 'dadminB@maktab.test'),
 ('aaaa0000-0000-4000-8000-00000000b005', 'parentB@maktab.test')
on conflict do nothing;

insert into user_school_roles (user_id, role, school_id, district_id, region_id) values
 ('aaaa0000-0000-4000-8000-00000000b0dd', 'district_admin', null, 202,  null),   -- gov school B's district
 ('aaaa0000-0000-4000-8000-00000000b005', 'parent', 'bbbb0000-0000-4000-8000-00000000b001', null, null);

insert into guardians (parent_user_id, student_id, relation, is_primary) values
 ('aaaa0000-0000-4000-8000-00000000b005', 'eeee0000-0000-4000-8000-00000000b001', 'father', true);

-- published weekly test in 5-A (school A) and in 5-B (school B), plus a draft in 5-A
insert into weekly_tests (id, school_id, class_id, subject_id, teacher_id, term_id, test_date, topic, status) values
 ('77770000-0000-4000-8000-00000000a001', 'bbbb0000-0000-4000-8000-00000000a001',
  'dddd0000-0000-4000-8000-00000000a001', 1, 'cccc0000-0000-4000-8000-00000000a001',
  'ffff0000-0000-4000-8000-00000000a001', current_date, 'Kasrlar', 'published'),
 ('77770000-0000-4000-8000-00000000a002', 'bbbb0000-0000-4000-8000-00000000a001',
  'dddd0000-0000-4000-8000-00000000a001', 1, 'cccc0000-0000-4000-8000-00000000a001',
  'ffff0000-0000-4000-8000-00000000a001', current_date + 7, 'Draft', 'draft'),
 ('77770000-0000-4000-8000-00000000b001', 'bbbb0000-0000-4000-8000-00000000b001',
  'dddd0000-0000-4000-8000-00000000b001', 1, 'cccc0000-0000-4000-8000-00000000b001',
  'ffff0000-0000-4000-8000-00000000a001', current_date, 'Kasrlar B', 'published');

insert into test_questions (id, test_id, question_text, options, points, position) values
 ('78880000-0000-4000-8000-00000000a001', '77770000-0000-4000-8000-00000000a001',
  '1/2 + 1/4 = ?', '["3/4","2/6","1/8","1"]', 1, 1);
insert into test_answer_keys (question_id, correct_index) values ('78880000-0000-4000-8000-00000000a001', 0);  -- V3-ADAPT

insert into library_items (id, subject_id, grade_level, topic, kind, title, status, author_user_id, origin_school_id) values
 ('79990000-0000-4000-8000-00000000a001', 1, 5, 'Kasrlar', 'quiz', 'AI quiz', 'ai_made',
  'aaaa0000-0000-4000-8000-00000000b002', 'bbbb0000-0000-4000-8000-00000000b001');   -- authored in school B

-- a current grade by teachA that will be soft-deleted (A12)
insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, created_by, deleted_at)
values ('eeee0000-0000-4000-8000-00000000a001', 1, 'ffff0000-0000-4000-8000-00000000a001',
        'current', 2, 'cccc0000-0000-4000-8000-00000000a001',
        'aaaa0000-0000-4000-8000-00000000a004', now());

-- ===========================================================================
set role authenticated;
-- ===========================================================================

-- ---- A1 parent → someone else's child --------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA (child sA1)
select test.attack('A1a parent cannot file absence report for a child in ANOTHER school',
  test.blocked($q$ insert into parent_absence_reports (school_id, student_id, parent_user_id, absence_date, reason)
    values ('bbbb0000-0000-4000-8000-00000000b001', 'eeee0000-0000-4000-8000-00000000b001',
            'aaaa0000-0000-4000-8000-00000000a005', current_date + 1, 'kasal') $q$),
  'v2: ambiguous student_id in policy subquery → always true');
select test.attack('A1b parent cannot file report for a NON-own child in same school',
  test.blocked($q$ insert into parent_absence_reports (school_id, student_id, parent_user_id, absence_date, reason)
    values ('bbbb0000-0000-4000-8000-00000000a001', 'eeee0000-0000-4000-8000-00000000a002',
            'aaaa0000-0000-4000-8000-00000000a005', current_date + 1, 'kasal') $q$));
select test.attack('A1c parent cannot file report with school_id ≠ child''s school',
  test.blocked($q$ insert into parent_absence_reports (school_id, student_id, parent_user_id, absence_date, reason)
    values ('bbbb0000-0000-4000-8000-00000000b001', 'eeee0000-0000-4000-8000-00000000a001',
            'aaaa0000-0000-4000-8000-00000000a005', current_date + 1, 'kasal') $q$),
  'denormalised school_id must match students.school_id');

-- ---- A16 parent approves own report (regression) ----------------------------
select test.attack('A16 parent cannot set own absence report to accepted',
  test.blocked($q$ update parent_absence_reports set status = 'accepted',
                   reviewed_by = 'aaaa0000-0000-4000-8000-00000000a005'
                   where parent_user_id = 'aaaa0000-0000-4000-8000-00000000a005' $q$));

-- ---- A2 attendance hijack ----------------------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
insert into attendance_logs (student_id, class_id, date, period, subject_id, teacher_id, status, marked_by)
values ('eeee0000-0000-4000-8000-00000000a001', 'dddd0000-0000-4000-8000-00000000a001',
        current_date, 5, 1, 'cccc0000-0000-4000-8000-00000000a001', 'present',
        'aaaa0000-0000-4000-8000-00000000a004');
select test.attack('A2a teacher cannot move own attendance row onto school B student',
  test.blocked($q$ update attendance_logs
                   set student_id = 'eeee0000-0000-4000-8000-00000000b001',
                       class_id   = 'dddd0000-0000-4000-8000-00000000b001',
                       status     = 'absent'
                   where marked_by = 'aaaa0000-0000-4000-8000-00000000a004'
                     and date = current_date and period = 5 $q$),
  'v2: WITH CHECK accepts marked_by = me for any new student → fake absence alert to a stranger');
-- V3 TEAM DECISION (Claude): NOT enforced. Timetables change and substitutions
-- are often entered late; blocking the teacher would break rule 3 ("work ends
-- at school"). Authority is still checked (teaches this class + subject), and
-- every mark is in attendance_logs with marked_by for the zavuch.
-- The test therefore checks the mark is ALLOWED. Perplexity: object if you disagree.
select test.attack('A2b DECISION: teacher of the class may mark a period outside the timetable',
  not test.blocked($q$ insert into attendance_logs (student_id, class_id, date, period, subject_id, teacher_id, status, marked_by)
    values ('eeee0000-0000-4000-8000-00000000a002', 'dddd0000-0000-4000-8000-00000000a001',
            current_date, 7, 1, 'cccc0000-0000-4000-8000-00000000a001', 'absent',
            'aaaa0000-0000-4000-8000-00000000a004') $q$),
  'period 7 is not in timetable_slots/substitutions for teachA — decide if v3 enforces this');

-- ---- A5 final grades (decision §9.3) -----------------------------------------
select test.attack('A5a teacher cannot enter a FINAL grade',
  test.blocked($q$ insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, created_by)
    values ('eeee0000-0000-4000-8000-00000000a001', 1, 'ffff0000-0000-4000-8000-00000000a001',
            'final', 5, 'cccc0000-0000-4000-8000-00000000a001', 'aaaa0000-0000-4000-8000-00000000a004') $q$),
  'final = zavuch/director only');
select test.attack('A5b teacher cannot upgrade own current grade to final',
  test.blocked($q$ update grades set grade_type = 'final'
                   where teacher_id = 'cccc0000-0000-4000-8000-00000000a001'
                     and grade_type = 'current' and deleted_at is null $q$));
select test.attack('A5c teacher cannot re-point own grade to another school''s student',
  test.blocked($q$ update grades set student_id = 'eeee0000-0000-4000-8000-00000000b001'
                   where teacher_id = 'cccc0000-0000-4000-8000-00000000a001' $q$));

-- ---- A10 lesson-card school spoof ---------------------------------------------
select test.attack('A10 teacher cannot create lesson card with school_id of another school',
  test.blocked($q$ insert into lesson_cards (school_id, class_id, subject_id, teacher_id, lesson_date, period, topic)
    values ('bbbb0000-0000-4000-8000-00000000b001', 'dddd0000-0000-4000-8000-00000000a001', 1,
            'cccc0000-0000-4000-8000-00000000a001', current_date, 1, 'spoof') $q$),
  'cards_select uses member_at(school_id) → card becomes visible in school B');

-- ---- A3 / A4 student vs. weekly test -------------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a006');  -- studA1
select test.attack('A3  student cannot read answer key (correct_index)',
  -- V3-ADAPT: only the key of THIS published test; keys of CLOSED tests are visible by design ("see answers")
  test.zero_or_denied($q$ select count(*) from test_answer_keys where question_id = '78880000-0000-4000-8000-00000000a001' $q$),
  'serve questions through a view/RPC without correct_index; revoke column');
select test.attack('A4a student cannot create an attempt with a score already set',
  test.blocked($q$ insert into test_attempts (test_id, student_id, score, submitted_at)
    values ('77770000-0000-4000-8000-00000000a001', 'eeee0000-0000-4000-8000-00000000a001', 100, now()) $q$),
  'score/submitted_at must be server-set (RPC start_attempt / submit_attempt)');
select test.attack('A4b student cannot start attempt on another school''s test',
  test.blocked($q$ insert into test_attempts (test_id, student_id)
    values ('77770000-0000-4000-8000-00000000b001', 'eeee0000-0000-4000-8000-00000000a001') $q$));
select test.attack('A4c student cannot start attempt on a DRAFT test',
  test.blocked($q$ insert into test_attempts (test_id, student_id)
    values ('77770000-0000-4000-8000-00000000a002', 'eeee0000-0000-4000-8000-00000000a001') $q$));
-- legit attempt (as owner) so we can attack answers
reset role;
insert into test_attempts (id, test_id, student_id)
values ('7aaa0000-0000-4000-8000-00000000a001', '77770000-0000-4000-8000-00000000a001',
        'eeee0000-0000-4000-8000-00000000a001');
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a006');
select test.attack('A4d student cannot write is_correct = true on own answer',
  test.blocked($q$ insert into attempt_answers (attempt_id, question_id, position, answer, is_correct)
    values ('7aaa0000-0000-4000-8000-00000000a001', '78880000-0000-4000-8000-00000000a001', 1,
            '{"choice":3}', true) $q$),
  'scoring belongs on the server (brief: answer key hidden, scoring on server)');

-- ---- A6 role escalation ----------------------------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
select test.attack('A6a zavuch cannot grant self director',
  test.blocked($q$ insert into user_school_roles (user_id, role, school_id)
    values ('aaaa0000-0000-4000-8000-00000000a003', 'director', 'bbbb0000-0000-4000-8000-00000000a001') $q$),
  'v2 roles_write = manages_school → zavuch can mint any school role');
select test.attack('A6b zavuch cannot grant self school_admin',
  test.blocked($q$ insert into user_school_roles (user_id, role, school_id)
    values ('aaaa0000-0000-4000-8000-00000000a003', 'school_admin', 'bbbb0000-0000-4000-8000-00000000a001') $q$));
select test.attack('A6c zavuch cannot deactivate the director',
  test.blocked($q$ update user_school_roles set is_active = false
                   where user_id = 'aaaa0000-0000-4000-8000-00000000a002' $q$));
select test.asuser('aaaa0000-0000-4000-8000-00000000a001');  -- adminA
select test.attack('A6d school admin cannot grant a role in ANOTHER school',
  test.blocked($q$ insert into user_school_roles (user_id, role, school_id)
    values ('aaaa0000-0000-4000-8000-00000000a001', 'school_admin', 'bbbb0000-0000-4000-8000-00000000b001') $q$));

-- ---- A7 library ----------------------------------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
select test.attack('A7  zavuch of school A cannot mark a platform library item as checked',
  test.blocked($q$ update library_items set status = 'checked',
                   methodologist_id = 'aaaa0000-0000-4000-8000-00000000a003'
                   where id = '79990000-0000-4000-8000-00000000a001' $q$),
  'needs a methodologist role; school staff may only submit for review');

-- ---- A13 announcement author spoof ------------------------------------------------
select test.attack('A13 zavuch cannot publish an announcement as the director',
  test.blocked($q$ insert into announcements (school_id, author_id, title, body)
    values ('bbbb0000-0000-4000-8000-00000000a001', 'aaaa0000-0000-4000-8000-00000000a002',
            'Ertaga dars yo''q', 'spoof') $q$));

-- ---- A8 super admin vs. children's data (decision §9.2) -------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000c001');  -- super admin
select test.attack('A8a super admin cannot read students',
  test.zero_or_denied($q$ select count(*) from students $q$),
  'v2 manages_school() includes super_admin');
select test.attack('A8b super admin cannot read grades',
  test.zero_or_denied($q$ select count(*) from grades $q$));
select test.attack('A8c super admin cannot read attendance',
  test.zero_or_denied($q$ select count(*) from attendance_logs $q$));
select test.attack('A8d super admin cannot read gate events',
  test.zero_or_denied($q$ select count(*) from gate_events $q$));

-- ---- A9 district admin of a government school: numbers only ----------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000b0dd');  -- district 202 (gov school B)
select test.attack('A9a district admin cannot read student names',
  test.zero_or_denied($q$ select count(*) from students $q$),
  'NOTE: conflicts with v2 test T8a — decide and update T8a too');
select test.attack('A9b district admin cannot read individual grades',
  test.zero_or_denied($q$ select count(*) from grades $q$));

-- ---- A11 parent vs. teacher phone (decision §9.1) ---------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
select test.attack('A11 parent cannot read teacher phone number',
  test.zero_or_denied($q$ select count(phone) from profiles
                         where user_id = 'aaaa0000-0000-4000-8000-00000000a004' $q$),
  'expose a teacher_directory view (first/last name only)');

-- ---- A12 soft-deleted grades --------------------------------------------------------
select test.attack('A12 parent does not see a soft-deleted grade',
  test.zero_or_denied($q$ select count(*) from grades where deleted_at is not null $q$),
  'filter deleted_at in policy or in the parent-facing view');

-- ---- A14 AI budget tampering ---------------------------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.attack('A14a user cannot delete own AI usage rows',
  test.blocked($q$ delete from ai_usage_log where user_id = 'aaaa0000-0000-4000-8000-00000000a004' $q$)
  and test.zero_or_denied($q$ select count(*) from ai_usage_log
                             where user_id <> 'aaaa0000-0000-4000-8000-00000000a004' $q$));
select test.attack('A14b user cannot insert fake (negative-cost) AI usage',
  test.blocked($q$ insert into ai_usage_log (user_id, feature, model, cost_cents)
    values ('aaaa0000-0000-4000-8000-00000000a004', 'lesson_prep', 'x', -100000) $q$));
select test.attack('A14c user cannot raise own AI quota',
  test.blocked($q$ insert into ai_quotas (user_id, monthly_limit_cents)
    values ('aaaa0000-0000-4000-8000-00000000a004', 999999) $q$));

-- ---- A15 app.ai_check (v3 only — SKIPPED if the function does not exist) ------------
do $$
declare has_fn boolean;
begin
  select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'app' and p.proname = 'ai_check') into has_fn;
  if not has_fn then
    perform test.attack('A15 app.ai_check present', false, 'SKIP: v2 has no ai_check — run on v3');
    return;
  end if;
  -- student of school A (Standard plan assumed in v3 seed) asks for the tutor
  perform test.asuser('aaaa0000-0000-4000-8000-00000000a006');
  perform test.attack('A15a Standard plan: student AI feature is refused',
    not coalesce((select allowed from app.ai_check('bbbb0000-0000-4000-8000-00000000a001'::uuid, 'tutor')), false));
  -- teacher of school A asks on behalf of school B
  perform test.asuser('aaaa0000-0000-4000-8000-00000000a004');
  perform test.attack('A15b ai_check for a school you are not a member of is refused',
    not coalesce((select allowed from app.ai_check('bbbb0000-0000-4000-8000-00000000b001'::uuid, 'lesson_prep')), false));
  perform test.attack('A15c unknown feature name is refused (default deny)',
    not coalesce((select allowed from app.ai_check('bbbb0000-0000-4000-8000-00000000a001'::uuid, 'no_such_feature')), false));
end $$;
-- NOT testable in one session, must be a separate 2-connection test:
--   A15d two parallel ai_check calls at quota-1 must not BOTH pass
--        → use ai_reserve() that locks the quota row (select … for update)
--          and inserts a pending usage row in the same transaction.

-- ===========================================================================
reset role;
select name, case when ok then 'PASS' else 'FAIL' end as result, note
from test.results order by name;

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from test.results;
  if f > 0 then
    raise exception 'test_v3: % of % attacks NOT blocked', f, t;
  end if;
  raise notice 'test_v3: all % attacks blocked', t;
end $$;
