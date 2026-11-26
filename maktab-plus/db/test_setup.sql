-- ============================================================================
-- MAKTAB+ — tests for school_setup.sql (step 8b: set up a school from Excel).
-- Fresh database: full stack + seed.sql + auth_local.sql + school_setup.sql.
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

create temp table bad_file as select $j${
 "teachers": [
   {"row":2,"last_name":"Karimova","first_name":"Aziza","phone":"12345"},
   {"row":3,"last_name":"Ahmedova","first_name":"Gulnora","phone":"+998901000010"},
   {"row":4,"last_name":"Rahimov","first_name":"Oybek","phone":"+998901000001"},
   {"row":5,"last_name":"Nazarov","first_name":"","phone":"+998 90 222 33 44","class_teacher_of":"13-A"}],
 "students": [
   {"row":2,"last_name":"Aliyev","first_name":"Ali","class":"6-A","birth_date":"31.02.2014"},
   {"row":3,"last_name":"Aliyev","first_name":"Ali","class":"6-A","birth_date":"31.02.2014"},
   {"row":4,"last_name":"Rasulov","first_name":"Sanjar","class":"6","parent_phone":"55"}],
 "timetable": [
   {"row":2,"class":"6-A","day":"Dushanba","period":"1","subject":"Kimyo","teacher_phone":"+998 90 222 33 44"},
   {"row":3,"class":"6-A","day":"Dushanba","period":"1","subject":"Matematika","teacher_phone":"+998 99 999 99 99"},
   {"row":4,"class":"6-B","day":"Yakshanba","period":"1","subject":"Matematika","teacher_phone":"+998 90 222 33 44"},
   {"row":5,"class":"6-C","day":"1","period":"1","subject":"Matematika","teacher_phone":"+998 90 222 33 44"}]
}$j$::jsonb as d;

create temp table good_file as select $j${
 "teachers": [
   {"row":2,"last_name":"Karimova","first_name":"Aziza","phone":"90 111 22 33","class_teacher_of":"6-A"},
   {"row":3,"last_name":"Karimov","first_name":"Bekzod","phone":"+998901000004"}],
 "students": [
   {"row":2,"last_name":"Aliyev","first_name":"Ali","class":"6-А","birth_date":"12.03.2014","gender":"o'g'il",
    "parent_last_name":"Aliyeva","parent_first_name":"Malika","parent_phone":"93 555 66 77","relation":"ona"},
   {"row":3,"last_name":"Aliyeva","first_name":"Laylo","class":"6a","birth_date":"2015-01-20","gender":"qiz",
    "parent_last_name":"Aliyeva","parent_first_name":"Malika","parent_phone":"+998935556677","relation":"ona"},
   {"row":4,"last_name":"Rasulov","first_name":"Sanjar","class":"6-A"},
   {"row":5,"last_name":"Usmonov","first_name":"Timur","class":"6-A","parent_phone":"+998901000004","relation":"ota"}],
 "timetable": [
   {"row":2,"class":"6-A","day":"Dushanba","period":"1","subject":"Matematika","teacher_phone":"901112233"},
   {"row":3,"class":"6-A","day":"Seshanba","period":"2","subject":"Ingliz tili","teacher_phone":"+998901000004"}]
}$j$::jsonb as d;
grant select on bad_file, good_file to authenticated;

set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
select test.check('I1 only the school admin / director may import (zavuch refused)',
  test.err($q$ select api.import_school((select d from good_file), false) $q$) = 'not_allowed');
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('I2 … teacher refused too',
  test.err($q$ select api.import_school((select d from good_file), false) $q$) = 'not_allowed');

select test.asuser('aaaa0000-0000-4000-8000-00000000a001');  -- adminA
select set_config('test.bad', (select api.import_school((select d from bad_file), true))::text, false);
select test.check('I3 a bad file: every problem is found (row + field + simple code)',
  (select array_agg(distinct e->>'code' order by e->>'code') from jsonb_array_elements(current_setting('test.bad')::jsonb->'errors') e)
  = array['bad_class','bad_date','bad_day','bad_phone','class_clash','duplicate_student','is_you','missing_name',
          'teacher_clash','teacher_other_school','unknown_subject','unknown_teacher']);
select test.check('I4 the bad-phone error points at teachers row 2',
  exists (select 1 from jsonb_array_elements(current_setting('test.bad')::jsonb->'errors') e
          where e->>'sheet' = 'teachers' and (e->>'row')::int = 2 and e->>'code' = 'bad_phone'));
reset role;
select test.check('I5 … and NOTHING was saved, even though "commit" was asked',
  (select count(*) from classes) = 2 and (select count(*) from students) = 3 and (select count(*) from profiles) = 10);
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a001');

select set_config('test.prev', (select api.import_school((select d from good_file), false))::text, false);
select test.check('I6 a good file: preview says what will happen (1 class, 1 new + 1 known teacher, 4 students, 1 new parent; the teacher-parent is counted once)',
  current_setting('test.prev')::jsonb->>'ok' = 'true'
  and current_setting('test.prev')::jsonb->'summary' @> '{"classes_new":1,"teachers_new":1,"teachers_existing":1,"students_new":4,"parents_new":1,"parents_existing":0,"timetable_rows":2}');
select test.check('I7 a warning (not an error) for the student without a parent phone',
  (select count(*) from jsonb_array_elements(current_setting('test.prev')::jsonb->'warnings') w where w->>'code' = 'no_parent_phone') = 1);

select set_config('test.done', (select api.import_school((select d from good_file), true))::text, false);
select test.check('I8 saved: 2 new logins with first passwords (new teacher + new parent)',
  current_setting('test.done')::jsonb->>'committed' = 'true'
  and jsonb_array_length(current_setting('test.done')::jsonb->'logins') = 2
  and (select bool_and(length(l->>'password') = 8) from jsonb_array_elements(current_setting('test.done')::jsonb->'logins') l));
reset role;
select test.check('I8b the mother''s login slip names both children',
  (select l->>'child' from jsonb_array_elements(current_setting('test.done')::jsonb->'logins') l where l->>'role' = 'parent') = 'Aliyev Ali, Aliyeva Laylo');
select test.check('I9 one class 6-A (Cyrillic "А" read as Latin), Aziza is its class teacher',
  (select count(*) from classes where grade_level = 6) = 1
  and (select p.first_name from classes c join teachers t on t.id = c.class_teacher_id join profiles p on p.user_id = t.user_id where c.grade_level = 6) = 'Aziza');
select test.check('I10 4 students in 6-A; the two siblings share their mother',
  (select count(*) from class_members cm join classes c on c.id = cm.class_id where c.grade_level = 6) = 4
  and (select count(*) from guardians g join profiles p on p.user_id = g.parent_user_id where p.phone = '+998935556677') = 2);
select test.check('I11 an existing teacher who is also a parent: role added, no new login',
  exists (select 1 from user_school_roles where user_id = 'aaaa0000-0000-4000-8000-00000000a004' and role = 'parent')
  and (select count(*) from guardians where parent_user_id = 'aaaa0000-0000-4000-8000-00000000a004') = 1
  and (select count(*) from auth.credentials where user_id = 'aaaa0000-0000-4000-8000-00000000a004') = 0);
select test.check('I12 timetable + teaching assignments created from it',
  (select count(*) from timetable_slots ts join classes c on c.id = ts.class_id where c.grade_level = 6) = 2
  and (select count(*) from teacher_assignments ta join classes c on c.id = ta.class_id where c.grade_level = 6) = 2);
select test.check('I13 the new teacher can log in with the printed first password',
  (select count(*) from app.password_login('school-a', '+998901112233',
     (select l->>'password' from jsonb_array_elements(current_setting('test.done')::jsonb->'logins') l where l->>'role' = 'teacher'))) > 0);
select test.check('I14 a birth date and gender were read in both formats',
  (select birth_date from students where first_name = 'Ali') = '2014-03-12'
  and (select gender from students where first_name = 'Laylo') = 'f');
select set_config('test.count', (select count(*) from students)::text || '|' || (select count(*) from profiles)::text
                                 || '|' || (select count(*) from guardians)::text, false);
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a001');
select set_config('test.again', (select api.import_school((select d from good_file), true))::text, false);
reset role;
select test.check('I15 importing the same file again creates nothing twice',
  current_setting('test.again')::jsonb->'summary' @> '{"classes_new":0,"teachers_new":0,"students_new":0,"parents_new":0}'
  and jsonb_array_length(current_setting('test.again')::jsonb->'logins') = 0
  and current_setting('test.count') = (select count(*) from students)::text || '|' || (select count(*) from profiles)::text
                                     || '|' || (select count(*) from guardians)::text);
select test.check('I16 every import is in the audit log',
  (select count(*) from audit_log where table_name = 'school_import') = 2);
select test.check('I17 everything went into the admin''s OWN school',
  (select count(*) from students where school_id <> 'bbbb0000-0000-4000-8000-00000000a001'
     and created_at > now() - interval '1 hour' and first_name in ('Ali','Laylo','Sanjar','Timur')) = 0);

do $$
declare p int := current_setting('test.passed')::int; f int := current_setting('test.failed')::int;
begin
  if f > 0 then raise exception 'SETUP RESULT: % passed, % FAILED', p, f; end if;
  raise notice 'SETUP RESULT: all % scenarios passed', p;
end $$;
