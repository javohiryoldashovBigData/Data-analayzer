-- ============================================================================
-- MAKTAB+ — tests for signup.sql (step 11). Fresh database: full stack + seed +
-- auth_local + school_setup + accounts + centers + signup.
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
grant usage on schema test to authenticated, anon;
grant execute on all functions in schema test to authenticated, anon;
select app.set_password('aaaa0000-0000-4000-8000-00000000a001', '+998901000001', 'adminA-pass1');

set role anon;
select set_config('app.current_user_id', '', false);
select test.check('S1 the sign-up page lists all 14 regions',
  test.val('select jsonb_array_length(api.signup_regions())') = '14');
select test.check('S2 web address: reserved, too short and taken ones are refused; a new one is free',
  not api.slug_free('demo') and not api.slug_free('ab') and not api.slug_free('school-a') and not api.slug_free('-bad-') and api.slug_free('yangi-markaz'));
create temp table good as select '{"kind":"center","org_name":"Yangi Bilim markazi","slug":"yangi-markaz","region_id":"6",
  "first_name":"Dilshod","last_name":"Rahmonov","phone":"+998 97 123 45 67","password":"Markaz-2026!"}'::jsonb as p;
select test.check('S3 a bad phone, a phone that already has an account, a weak password, a taken address → each refused',
  test.err($q$ select api.signup_org((select p from good) || '{"phone":"123"}') $q$) = 'bad_phone'
  and test.err($q$ select api.signup_org((select p from good) || '{"phone":"+998901000001"}') $q$) = 'phone_taken'
  and test.err($q$ select api.signup_org((select p from good) || '{"password":"971234567"}') $q$) = 'password_weak'
  and test.err($q$ select api.signup_org((select p from good) || '{"slug":"school-a"}') $q$) = 'slug_taken'
  and test.err($q$ select api.signup_org((select p from good) || '{"kind":"kafe"}') $q$) = 'bad_kind');
select test.check('S4 a correct sign-up creates the center',
  test.val($q$ select api.signup_org((select p from good))->>'slug' $q$) = 'yangi-markaz');
reset role;
select test.check('S5 … as a learning center, in Samarqand, with 8 lesson times and its director',
  (select org_kind from schools where slug = 'yangi-markaz') = 'center'
  and (select d.region_id from schools s join districts d on d.id = s.district_id where s.slug = 'yangi-markaz') = 6
  and (select count(*) from bell_periods bp join schools s on s.id = bp.school_id where s.slug = 'yangi-markaz') = 8
  and exists (select 1 from user_school_roles r join schools s on s.id = r.school_id join profiles p on p.user_id = r.user_id
              where s.slug = 'yangi-markaz' and r.role = 'director' and p.phone = '+998971234567'));
select test.check('S6 the director logs in with the password they chose (no "change it" step)',
  (select not must_change from app.password_login('yangi-markaz', '+998971234567', 'Markaz-2026!')));
select test.check('S7 the same address cannot be taken twice',
  test.err($q$ select api.signup_org((select p from good) || '{"phone":"+998971234500"}') $q$) = 'slug_taken');
select set_config('test.dir', (select user_id::text from profiles where phone = '+998971234567'), false);
select set_config('test.t', (select user_id::text from profiles where phone = '+998901000004'), false);

set role authenticated;
select test.asuser(current_setting('test.dir')::uuid);
select test.check('S8 first steps start at zero',
  test.val($q$ select (api.first_steps()->>'teachers') || '|' || (api.first_steps()->>'classes') || '|' || (api.first_steps()->>'students') $q$) = '0|0|0');
select test.check('S9 the new director can add a teacher (Excel import, one row)',
  test.val($q$ select api.import_school('{"teachers":[{"row":2,"last_name":"Yangi","first_name":"Ustoz","phone":"+998 97 555 00 11"}]}', true)->>'committed' $q$) = 'true');
select test.check('S10 … and create a group',
  test.err($q$ select api.save_group(jsonb_build_object('name','IELTS boshlang''ich','subject_id',2,
     'teacher_id',(select id from teachers where school_id = (select id from schools where slug = 'yangi-markaz')),
     'schedule','[{"day":1,"period":3}]'::jsonb)) $q$) = 'no error');
select test.check('S11 the new director sees nothing of other schools',
  test.val($q$ select count(*) from students $q$) = '0'
  and test.err($q$ select api.reset_password('aaaa0000-0000-4000-8000-00000000a004') $q$) = 'not_found');
select test.asuser('aaaa0000-0000-4000-8000-00000000a001');  -- adminA (school A)
select test.check('S12 the sign-up exception cannot be used elsewhere, even with the mark set by hand',
  test.err($q$ insert into user_school_roles (user_id, role, school_id) values ('aaaa0000-0000-4000-8000-00000000a008', 'director', 'bbbb0000-0000-4000-8000-00000000a001') $q$) = 'director_change_platform_only'
  and test.err($q$ select set_config('app.signup_director', 'aaaa0000-0000-4000-8000-00000000a008|bbbb0000-0000-4000-8000-00000000a001', true);
                   insert into user_school_roles (user_id, role, school_id) values ('aaaa0000-0000-4000-8000-00000000a008', 'director', 'bbbb0000-0000-4000-8000-00000000a001') $q$) = 'director_change_platform_only');
select test.check('S13 logged-in users cannot call sign-up (website visitors only)',
  test.err($q$ select api.signup_org((select p from good) || '{"slug":"boshqa-markaz","phone":"+998971234599"}') $q$) like '%permission denied%');
reset role;
select test.check('S15 a website visitor can run exactly 3 things: regions, "is the address free", sign up',
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and has_function_privilege('anon', p.oid, 'execute')) = array['signup_org','signup_regions','slug_free']);
select test.check('S14 every sign-up is recorded (platform list + audit log)',
  (select count(*) from org_signups) = 1 and (select count(*) from audit_log where action = 'signup' and table_name = 'schools') = 1);

do $$
declare p int := current_setting('test.passed')::int; f int := current_setting('test.failed')::int;
begin
  if f > 0 then raise exception 'SIGNUP RESULT: % passed, % FAILED', p, f; end if;
  raise notice 'SIGNUP RESULT: all % scenarios passed', p;
end $$;
