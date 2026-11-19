-- ============================================================================
-- MAKTAB+ — tests for family_api.sql (step 3). Fresh database with
--   local_compat, schema, seed, api_phase1, family_api   then this file.
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

-- a lesson card with a topic AND a private ask-first note, on Monday 2026-11-09
insert into lesson_cards (school_id, class_id, subject_id, teacher_id, lesson_date, period, topic, questions)
values ('bbbb0000-0000-4000-8000-00000000a001','dddd0000-0000-4000-8000-00000000a001',1,
        'cccc0000-0000-4000-8000-00000000a001','2026-11-09',1,'Kasrlarni qo''shish',
        '{"ask_first":["Malika: no homework"]}');

set role authenticated;

select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA (child in 5-A)
select test.check('F1 parent sees the diary week of the child''s class with the lesson topic',
  test.count($q$ select count(*) from jsonb_array_elements(api.class_week('dddd0000-0000-4000-8000-00000000a001', '2026-11-09')) l
               where l->>'topic' = 'Kasrlarni qo''shish' and l->>'subject' = 'Matematika' $q$) = 1);
select test.check('F2 the diary never contains the private ask-first notes',
  test.count($q$ select count(*) from jsonb_array_elements(api.class_week('dddd0000-0000-4000-8000-00000000a001', '2026-11-09')) l
               where l::text like '%Malika%' or l ? 'questions' $q$) = 0);
select test.check('F3 parent CANNOT read the diary of another school''s class',
  test.error($q$ select api.class_week('dddd0000-0000-4000-8000-00000000b001', '2026-11-09') $q$));

select test.asuser('aaaa0000-0000-4000-8000-00000000a006');  -- studA1
select test.check('F4 student sees own class diary',
  test.count($q$ select jsonb_array_length(api.class_week('dddd0000-0000-4000-8000-00000000a001', '2026-11-09')) $q$) >= 1);

select test.asuser('aaaa0000-0000-4000-8000-00000000b002');  -- teachB (school B)
select test.check('F5 teacher of another school CANNOT read the diary',
  test.error($q$ select api.class_week('dddd0000-0000-4000-8000-00000000a001', '2026-11-09') $q$));

-- accepted absence report → teacher's "absent" becomes "excused", no absence alert
select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
insert into parent_absence_reports (school_id, student_id, parent_user_id, absence_date, reason)
values ('bbbb0000-0000-4000-8000-00000000a001','eeee0000-0000-4000-8000-00000000a001',
        'aaaa0000-0000-4000-8000-00000000a005', current_date, 'shifokor');
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA = class teacher of 5-A
select test.check('F6 class teacher accepts the parent''s absence report',
  test.rows($q$ update parent_absence_reports set status = 'accepted',
     reviewed_by = 'aaaa0000-0000-4000-8000-00000000a004', reviewed_at = now()
     where student_id = 'eeee0000-0000-4000-8000-00000000a001' $q$));
reset role;
delete from notification_outbox;
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');
insert into attendance_logs (student_id, class_id, date, period, subject_id, teacher_id, status, marked_by)
values ('eeee0000-0000-4000-8000-00000000a001','dddd0000-0000-4000-8000-00000000a001', current_date, 1, 1,
        'cccc0000-0000-4000-8000-00000000a001','absent','aaaa0000-0000-4000-8000-00000000a004');
reset role;
select test.check('F7 the mark is stored as EXCUSED, not absent',
  (select status::text from attendance_logs where student_id = 'eeee0000-0000-4000-8000-00000000a001'
     and date = current_date and period = 1) = 'excused');
select test.check('F8 no "your child is absent" alert went to the parent who reported it',
  (select count(*) from notification_outbox where payload->>'kind' = 'absence') = 0);
insert into attendance_logs (student_id, class_id, date, period, subject_id, teacher_id, status, marked_by)
values ('eeee0000-0000-4000-8000-00000000a002','dddd0000-0000-4000-8000-00000000a001', current_date, 1, 1,
        'cccc0000-0000-4000-8000-00000000a001','absent','aaaa0000-0000-4000-8000-00000000a004');
select test.check('F9 a child WITHOUT a report is still marked absent',
  (select status::text from attendance_logs where student_id = 'eeee0000-0000-4000-8000-00000000a002'
         and date = current_date and period = 1) = 'absent');

do $$
declare p int := current_setting('test.passed')::int; f int := current_setting('test.failed')::int;
begin
  if f > 0 then raise exception 'FAMILY RESULT: % passed, % FAILED', p, f; end if;
  raise notice 'FAMILY RESULT: all % scenarios passed', p;
end $$;
