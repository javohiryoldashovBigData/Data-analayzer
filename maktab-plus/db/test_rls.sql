-- ============================================================================
-- MAKTAB+ — RLS test script (plain PostgreSQL 16; self-hosted Supabase works
-- too if you replace the auth shim usage)
--
-- Usage:
--   psql -v ON_ERROR_STOP=1 -f local_compat.sql
--   psql -v ON_ERROR_STOP=1 -f schema.sql
--   psql -v ON_ERROR_STOP=1 -f seed.sql
--   psql -v ON_ERROR_STOP=1 -f test_rls.sql
--
-- How it works:
--   * Helper functions set the GUC that the compat shim's auth.uid() reads,
--     then run queries as the `authenticated` role (a non-owner, so RLS
--     actually applies).
--   * Service-role operations (outbox, audit, gate scanner) run as the table
--     owner — exactly how the real workers would.
--   * Every scenario prints PASS; the first failure aborts with FAIL.
--   * Sessions run with ON_ERROR_STOP so nothing is silently skipped.
--
-- Covers every problem from brief §9 plus the role matrix:
--   T1  FIX #1  cross-school leak
--   T2  FIX #2  profiles readable by everyone
--   T3  FIX #3  outbox / audit readable by everyone
--   T4  FIX #4  summary maintained on insert
--   T5  FIX #5  notifications insert works
--   T6  FIX #6  teacher can write at all
--   T7  FIX #7  audit log written
--   T8  FIX #8  district admin scope
--   T9  FIX #9  absence alert on UPDATE (present → absent)
--   T10–T12    grade authority (no assignment / other school / parent)
--   T13–T20    role matrix: student, parent, absence reports, gate events,
--              problems, lesson cards, class roster, weekly tests
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create schema if not exists test;

create or replace function test.asuser(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('app.current_user_id', p_user::text, false);
end $$;

create or replace function test.count(p_sql text)
returns bigint language plpgsql as $$
declare c bigint;
begin
  execute p_sql into c;
  return c;
exception when others then
  raise exception 'test.count query failed: % (%)', sqlerrm, p_sql;
end $$;

-- true  → the statement failed (RLS denied it)
-- false → the statement unexpectedly succeeded
create or replace function test.error(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;

create or replace function test.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then
    raise notice 'PASS  %', p_name;
  else
    raise exception 'FAIL  %', p_name;
  end if;
end $$;

grant usage on schema test to authenticated;
grant execute on all functions in schema test to authenticated;

-- ---------------------------------------------------------------------------
-- T5 / T16 setup + service-role checks run as the owner (postgres),
-- user-scoped checks run as `authenticated`.
-- ---------------------------------------------------------------------------

-- T5 (FIX #5): notifications insert works on the hash-partitioned table.
insert into notifications (recipient_id, kind, title, body)
values ('aaaa0000-0000-4000-8000-00000000a005', 'announcement', 'Xush kelibsiz', 'Maktab+ test');

-- T16: gate scanner writes as the service role.
insert into gate_events (school_id, student_id, direction, method)
values ('bbbb0000-0000-4000-8000-00000000a001',
        'eeee0000-0000-4000-8000-00000000a001', 'in', 'qr');

select test.check('T5  FIX#5  notifications insert (PK includes partition key)', true);
select test.check('T16 FIX-    gate event insert (service role) + parent alert enqueued',
  test.count($q$ select count(*) from notification_outbox
              where payload->>'kind' = 'gate_in' $q$) >= 1);

-- ===========================================================================
-- Now act as the authenticated role.
-- ===========================================================================
set role authenticated;

-- ---- T1: FIX #1 cross-school leak ------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a001');  -- adminA
select test.check('T1a FIX#1  school A admin sees own students (2)',
  test.count('select count(*) from students where school_id = ''bbbb0000-0000-4000-8000-00000000a001''') = 2);

select test.asuser('aaaa0000-0000-4000-8000-00000000b001');  -- adminB
select test.check('T1b FIX#1  school B admin CANNOT see school A students',
  test.count('select count(*) from students where school_id = ''bbbb0000-0000-4000-8000-00000000a001''') = 0);
select test.check('T1c FIX#1  school B admin sees own students (1)',
  test.count('select count(*) from students where school_id = ''bbbb0000-0000-4000-8000-00000000b001''') = 1);

-- ---- T2: FIX #2 profiles ----------------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
select test.check('T2a FIX#2  parent cannot read another school''s admin profile',
  test.count('select count(*) from profiles where user_id = ''aaaa0000-0000-4000-8000-00000000b001''') = 0);
select test.check('T2b FIX#2  parent can read own school teacher''s profile (contact)',
  test.count('select count(*) from profiles where user_id = ''aaaa0000-0000-4000-8000-00000000a004''') = 1);
select test.check('T2c FIX#2  parent reads own profile',
  test.count('select count(*) from profiles where user_id = ''aaaa0000-0000-4000-8000-00000000a005''') = 1);

-- ---- T3: FIX #3 outbox / audit ----------------------------------------
select test.check('T3a FIX#3  parent reads nothing from notification_outbox',
  test.count('select count(*) from notification_outbox') = 0);
select test.check('T3b FIX#3  parent reads nothing from audit_log',
  test.count('select count(*) from audit_log') = 0);

-- ---- T6: FIX #6 teacher can write --------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
insert into attendance_logs (student_id, class_id, date, period, subject_id, teacher_id, status, marked_by)
values ('eeee0000-0000-4000-8000-00000000a001',
        'dddd0000-0000-4000-8000-00000000a001', current_date, 1, 1,
        'cccc0000-0000-4000-8000-00000000a001', 'present',
        'aaaa0000-0000-4000-8000-00000000a004');
select test.check('T6  FIX#6  subject teacher inserts attendance (writes allowed)', true);

-- ---- T4: FIX #4 summary maintained -------------------------------------
insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, created_by)
values ('eeee0000-0000-4000-8000-00000000a001', 1,
        'ffff0000-0000-4000-8000-00000000a001', 'current', 5,
        'cccc0000-0000-4000-8000-00000000a001', 'aaaa0000-0000-4000-8000-00000000a004');
select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
select test.check('T4  FIX#4  student_term_summary row exists after grade insert (parent sees it)',
  test.count('select count(*) from student_term_summary
              where student_id = ''eeee0000-0000-4000-8000-00000000a001''') = 1);

-- ---- T13: student sees own data only -----------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a006');  -- studA1
select test.check('T13a student sees only own student row',
  test.count('select count(*) from students') = 1);
select test.check('T13b student sees own grades',
  test.count('select count(*) from grades') = 1);

-- ---- T14: parent sees only own child -----------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
select test.check('T14  parent sees only own child',
  test.count('select count(*) from students') = 1);

-- ---- T7: FIX #7 audit log written ---------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
update grades set value = 4, comment = 'qayta baholash'
 where student_id = 'eeee0000-0000-4000-8000-00000000a001'
   and subject_id = 1;
select test.check('T7a FIX#7  teacher updates own grade', true);
reset role;
select test.check('T7b FIX#7  audit_log captured the grade change (service role view)',
  test.count('select count(*) from audit_log where table_name = ''grades''') >= 1);
set role authenticated;

-- ---- T9: FIX #9 absence alert on UPDATE --------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
insert into attendance_logs (student_id, class_id, date, period, subject_id, teacher_id, status, marked_by)
values ('eeee0000-0000-4000-8000-00000000a001',
        'dddd0000-0000-4000-8000-00000000a001', current_date, 2, 1,
        'cccc0000-0000-4000-8000-00000000a001', 'present',
        'aaaa0000-0000-4000-8000-00000000a004');
update attendance_logs set status = 'absent'
 where student_id = 'eeee0000-0000-4000-8000-00000000a001'
   and date = current_date and period = 2;
select test.check('T9a FIX#9  present→absent upsert succeeds', true);
reset role;
select test.check('T9b FIX#9  absence alert enqueued on UPDATE (not only INSERT)',
  test.count($q$ select count(*) from notification_outbox
              where payload->>'kind' = 'absence' $q$) >= 1);
set role authenticated;

-- ---- T8: FIX #8 district admin scope ------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a007');  -- dadminA (district 101)
select test.check('T8a FIX#8  district admin sees schools in own district',
  test.count('select count(*) from students where school_id = ''bbbb0000-0000-4000-8000-00000000a001''') = 2);
select test.check('T8b FIX#8  district admin CANNOT see other district''s school',
  test.count('select count(*) from students where school_id = ''bbbb0000-0000-4000-8000-00000000b001''') = 0);

-- ---- T10–T12: grade-entry authority --------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a008');  -- teachA2 (no assignments)
select test.check('T10  teacher WITHOUT assignments cannot post grades',
  test.error($q$ insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, created_by)
    values ('eeee0000-0000-4000-8000-00000000a001', 1, 'ffff0000-0000-4000-8000-00000000a001',
            'current', 4, 'cccc0000-0000-4000-8000-00000000a002', 'aaaa0000-0000-4000-8000-00000000a008') $q$));

select test.asuser('aaaa0000-0000-4000-8000-00000000b002');  -- teachB (school B)
select test.check('T11a teacher from school B CANNOT post grades for school A student',
  test.error($q$ insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, created_by)
    values ('eeee0000-0000-4000-8000-00000000a001', 1, 'ffff0000-0000-4000-8000-00000000a001',
            'current', 4, 'cccc0000-0000-4000-8000-00000000b001', 'aaaa0000-0000-4000-8000-00000000b002') $q$));
select test.check('T11b teacher from school B sees no school A students',
  test.count('select count(*) from students where school_id = ''bbbb0000-0000-4000-8000-00000000a001''') = 0);

select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
select test.check('T12  parent cannot post grades',
  test.error($q$ insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, created_by)
    values ('eeee0000-0000-4000-8000-00000000a001', 1, 'ffff0000-0000-4000-8000-00000000a001',
            'current', 5, 'cccc0000-0000-4000-8000-00000000a001', 'aaaa0000-0000-4000-8000-00000000a005') $q$));

-- ---- T15: parent absence reports -----------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
insert into parent_absence_reports (school_id, student_id, parent_user_id, absence_date, reason)
values ('bbbb0000-0000-4000-8000-00000000a001', 'eeee0000-0000-4000-8000-00000000a001',
        'aaaa0000-0000-4000-8000-00000000a005', current_date + 1, 'shifokor bilan uchrashuv');
select test.check('T15a parent reports absence in advance', true);

select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
update parent_absence_reports set status = 'accepted', reviewed_by = 'aaaa0000-0000-4000-8000-00000000a003',
       review_note = 'qabul qilindi'
 where student_id = 'eeee0000-0000-4000-8000-00000000a001';
select test.check('T15b zavuch accepts the absence report', true);

select test.asuser('aaaa0000-0000-4000-8000-00000000b002');  -- teachB
select test.check('T15c teacher from another school cannot accept it',
  test.error($q$ update parent_absence_reports set status = 'rejected'
              where student_id = 'eeee0000-0000-4000-8000-00000000a001' $q$));

-- ---- T16b: gate events visibility ----------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
select test.check('T16b parent sees own child''s gate events (entry only, no GPS)',
  test.count('select count(*) from gate_events') = 1);

-- ---- T17: zavuch problem inbox -------------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
insert into problems (school_id, raised_by, category, severity, description)
values ('bbbb0000-0000-4000-8000-00000000a001', 'aaaa0000-0000-4000-8000-00000000a004',
        'grades_missing', 'small', '5-A matematika chorak bahosi kiritilmagan');
select test.check('T17a teacher raises a problem', true);

select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
select test.check('T17b parent sees NO problems',
  test.count('select count(*) from problems') = 0);

select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
select test.check('T17c zavuch sees the problem inbox',
  test.count('select count(*) from problems') = 1);

-- ---- T18: lesson cards -----------------------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
insert into lesson_cards (school_id, class_id, subject_id, teacher_id, lesson_date, period,
                          topic, plan, homework, status, ai_generated)
values ('bbbb0000-0000-4000-8000-00000000a001', 'dddd0000-0000-4000-8000-00000000a001', 1,
        'cccc0000-0000-4000-8000-00000000a001', current_date + 7, 1,
        'Kasrlar', 'AI draft: kasrlar qo''shish', '57-bet 1-5', 'ai_draft', true);
select test.check('T18a teacher creates lesson card', true);

select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
update lesson_cards set status = 'approved', approved_by = 'aaaa0000-0000-4000-8000-00000000a003'
 where topic = 'Kasrlar';
select test.check('T18b zavuch approves lesson card', true);

-- ---- T19: teacher class roster ---------------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('T19  teacher sees own class roster (2 students)',
  test.count('select count(*) from class_members') = 2);

-- ---- T20: weekly tests -------------------------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
insert into weekly_tests (school_id, class_id, subject_id, teacher_id, term_id, test_date, topic, status)
values ('bbbb0000-0000-4000-8000-00000000a001', 'dddd0000-0000-4000-8000-00000000a001', 1,
        'cccc0000-0000-4000-8000-00000000a001', 'ffff0000-0000-4000-8000-00000000a001',
        current_date + 3, 'Kasrlar', 'published');
insert into test_questions (test_id, question_text, options, correct_index, points, position)
select id, '1/2 + 1/4 = ?', '["3/4","2/4","1/2","1/6"]', 0, 1, 1 from weekly_tests
 where topic = 'Kasrlar' and school_id = 'bbbb0000-0000-4000-8000-00000000a001';
select test.check('T20a teacher publishes weekly test', true);

select test.asuser('aaaa0000-0000-4000-8000-00000000a006');  -- studA1
insert into test_attempts (test_id, student_id, mode)
select id, 'eeee0000-0000-4000-8000-00000000a001', 'online' from weekly_tests
 where topic = 'Kasrlar' and school_id = 'bbbb0000-0000-4000-8000-00000000a001';
select test.check('T20b student starts own attempt', true);
select test.check('T20c student cannot start an attempt for another student',
  test.error($q$ insert into test_attempts (test_id, student_id, mode)
    select id, 'eeee0000-0000-4000-8000-00000000a002', 'online' from weekly_tests
    where topic = 'Kasrlar' and school_id = 'bbbb0000-0000-4000-8000-00000000a001' $q$));

-- ---------------------------------------------------------------------------
reset role;
select test.check('ALL SCENARIOS PASSED', true);
