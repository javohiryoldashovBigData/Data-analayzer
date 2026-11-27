-- ============================================================================
-- MAKTAB+ — tests for centers.sql (step 10: learning-center groups).
-- Fresh database: full stack + seed.sql + auth_local + school_setup + accounts + centers.
-- ============================================================================
create schema if not exists test;
select set_config('test.passed', '0', false), set_config('test.failed', '0', false);
create or replace function test.asuser(p_user uuid) returns void language plpgsql as $$
begin perform set_config('app.current_user_id', p_user::text, false); end $$;
create or replace function test.val(p_sql text) returns text language plpgsql as $$
declare v text; begin execute p_sql into v; return v; end $$;
create or replace function test.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'no error'; exception when others then return sqlerrm; end $$;
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

-- ---- a small learning center ----
insert into schools (id, district_id, name, mode, slug, brand_color, org_kind) values
 ('c0000000-0000-4000-8000-000000000c01', 101, 'Bilim markazi', 'private', 'center-c', '#b45309', 'center');
insert into auth.users (id, email) values
 ('c1000000-0000-4000-8000-000000000001', 'admC@t'), ('c1000000-0000-4000-8000-000000000011', 't1C@t'), ('c1000000-0000-4000-8000-000000000012', 't2C@t');
insert into profiles (user_id, first_name, last_name, phone) values
 ('c1000000-0000-4000-8000-000000000001', 'Kamol', 'Markaziy', '+998911000001'),
 ('c1000000-0000-4000-8000-000000000011', 'Nilufar', 'Ingliz', '+998911000011'),
 ('c1000000-0000-4000-8000-000000000012', 'Botir', 'Hisob', '+998911000012');
insert into user_school_roles (user_id, role, school_id) values
 ('c1000000-0000-4000-8000-000000000001', 'school_admin', 'c0000000-0000-4000-8000-000000000c01'),
 ('c1000000-0000-4000-8000-000000000011', 'teacher', 'c0000000-0000-4000-8000-000000000c01'),
 ('c1000000-0000-4000-8000-000000000012', 'teacher', 'c0000000-0000-4000-8000-000000000c01');
insert into teachers (id, school_id, user_id) values
 ('c2000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000c01', 'c1000000-0000-4000-8000-000000000011'),
 ('c2000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000c01', 'c1000000-0000-4000-8000-000000000012');
insert into bell_periods (school_id, number, start_time, end_time)
select 'c0000000-0000-4000-8000-000000000c01', n, time '09:00' + (n - 1) * interval '90 minutes', time '10:20' + (n - 1) * interval '90 minutes'
from generate_series(1, 8) n;

set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a001');  -- adminA of a SCHOOL
select test.check('C1 a school (not a center) cannot use the group screens',
  test.err($q$ select api.center_groups() $q$) = 'not_allowed');

select test.asuser('c1000000-0000-4000-8000-000000000001');  -- center admin
select set_config('test.g1', api.save_group('{"name":"IELTS 6.5 — kechki","course":"IELTS","subject_id":2,
  "teacher_id":"c2000000-0000-4000-8000-000000000001","capacity":2,"starts_on":"2026-11-02","ends_on":"2027-02-28",
  "schedule":[{"day":1,"period":7},{"day":3,"period":7},{"day":5,"period":7}]}')::text, false);
select test.check('C2 the center creates a group with a teacher and 3 lessons a week',
  test.val($q$ select jsonb_array_length(api.center_groups()->0->'schedule') $q$) = '3'
  and test.val($q$ select api.center_groups()->0->>'teacher' $q$) = 'Nilufar Ingliz');
select test.check('C3 the same group name twice is refused',
  test.err($q$ select api.save_group('{"name":"ielts 6.5 — KECHKI","subject_id":2,"teacher_id":"c2000000-0000-4000-8000-000000000002"}') $q$) = 'name_taken');
select test.check('C4 a teacher cannot be in two groups at the same time',
  test.err($q$ select api.save_group('{"name":"General English A2","subject_id":2,"teacher_id":"c2000000-0000-4000-8000-000000000001",
     "schedule":[{"day":1,"period":7}]}') $q$) = 'teacher_busy');
select set_config('test.g2', api.save_group('{"name":"Matematika DTM","subject_id":1,"teacher_id":"c2000000-0000-4000-8000-000000000002",
  "schedule":[{"day":2,"period":6},{"day":4,"period":6}]}')::text, false);
reset role;
select test.check('C5 a group is a class with a name (label = name, no grade/letter)',
  (select label from classes where id = current_setting('test.g1')::uuid) = 'IELTS 6.5 — kechki'
  and (select grade_level is null and letter is null from classes where id = current_setting('test.g1')::uuid));

-- ---- students into groups (the Excel import, center mode) ----
set role authenticated;
select test.asuser('c1000000-0000-4000-8000-000000000001');
select test.check('C6 a student row pointing at an unknown group is refused',
  exists (select 1 from jsonb_array_elements(api.import_school('{"students":[{"row":2,"last_name":"X","first_name":"Y","class":"Yo''q guruh"}]}', false)->'errors') e
          where e->>'code' = 'unknown_group'));
select set_config('test.imp', api.import_school($j${"students":[
   {"row":2,"last_name":"Karimov","first_name":"Sherzod","class":"IELTS 6.5 — kechki","birth_date":"12.04.1998","phone":"+998 93 111 22 33"},
   {"row":3,"last_name":"Aliyeva","first_name":"Zarina","class":"ielts 6.5 — kechki","birth_date":"03.03.2012","parent_first_name":"Gulnoza","parent_last_name":"Aliyeva","parent_phone":"+998 94 222 33 44","relation":"ona"},
   {"row":4,"last_name":"Aliyeva","first_name":"Zarina","class":"Matematika DTM","birth_date":"03.03.2012","parent_phone":"+998 94 222 33 44"}]}$j$::jsonb, true)::text, false);
select test.check('C7 saved: the adult gets his OWN login, the child''s mother gets one',
  current_setting('test.imp')::jsonb->>'committed' = 'true'
  and (select array_agg(l->>'role' order by l->>'role') from jsonb_array_elements(current_setting('test.imp')::jsonb->'logins') l) = array['parent','student']);
reset role;
select test.check('C8 one child in two groups is ONE student (not two)',
  (select count(*) from students where first_name = 'Zarina') = 1
  and (select count(*) from class_members cm join students s on s.id = cm.student_id where s.first_name = 'Zarina' and cm.status = 'active') = 2);
select test.check('C9 the adult is linked to his login and has the student role; no parent needed',
  (select s.user_id is not null from students s where s.first_name = 'Sherzod')
  and exists (select 1 from user_school_roles r join profiles p on p.user_id = r.user_id where p.phone = '+998931112233' and r.role = 'student')
  and (select count(*) from guardians g join students s on s.id = g.student_id where s.first_name = 'Sherzod') = 0);

-- ---- enrolling by hand ----
insert into students (id, school_id, first_name, last_name) values ('c3000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000c01', 'Ozod', 'Uchinchi');
set role authenticated;
select test.asuser('c1000000-0000-4000-8000-000000000001');
select test.check('C10 the group is full (capacity 2) → the third student is refused',
  test.err(format($q$ select api.set_enrollment(%L, 'c3000000-0000-4000-8000-000000000003', true) $q$, current_setting('test.g1'))) = 'group_full');
select test.check('C11 a student leaves the group → the place is free again',
  test.err(format($q$ select api.set_enrollment(%L, (select student_id from class_members cm join students s on s.id = cm.student_id where s.first_name = 'Sherzod'), false) $q$, current_setting('test.g1'))) = 'no error'
  and test.err(format($q$ select api.set_enrollment(%L, 'c3000000-0000-4000-8000-000000000003', true) $q$, current_setting('test.g1'))) = 'no error'
  and test.val(format($q$ select jsonb_array_length(api.group_students(%L)) $q$, current_setting('test.g1'))) = '2');
select test.check('C12 the "add a student" search shows each student''s groups',
  test.val($q$ select jsonb_array_length(api.center_students('Zarina')->0->'groups') $q$) = '2');
-- the teacher's day works for groups
select test.asuser('c1000000-0000-4000-8000-000000000011');  -- teacher Nilufar
select test.check('C13 the teacher''s Monday shows the group by its name and time',
  test.val($q$ select (api.my_day((date_trunc('week', current_date) + interval '7 days')::date)->'lessons'->0->>'class') $q$) = 'IELTS 6.5 — kechki');
-- Sherzod (adult) back in another group, gets a grade → the message goes to HIM
reset role;
update class_members set status = 'active' where student_id = (select id from students where first_name = 'Sherzod');
set role authenticated;
select test.asuser('c1000000-0000-4000-8000-000000000011');
insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, created_by)
select s.id, 2, (select id from terms where is_current limit 1), 'current', 5, 'c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011'
from students s where s.first_name = 'Sherzod';
reset role;
select test.check('C14 an adult student gets his grade notice himself',
  exists (select 1 from notification_outbox o join profiles p on p.user_id = o.recipient_id
          where p.phone = '+998931112233' and o.payload->>'kind' = 'grade_posted'));
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000b001');  -- adminB of another school
select test.check('C15 nobody outside the center sees its groups or students',
  test.err($q$ select api.center_students('') $q$) = 'not_allowed'
  and test.val($q$ select count(*) from students where school_id = 'c0000000-0000-4000-8000-000000000c01' $q$) = '0');
reset role;

do $$
declare p int := current_setting('test.passed')::int; f int := current_setting('test.failed')::int;
begin
  if f > 0 then raise exception 'CENTERS RESULT: % passed, % FAILED', p, f; end if;
  raise notice 'CENTERS RESULT: all % scenarios passed', p;
end $$;
