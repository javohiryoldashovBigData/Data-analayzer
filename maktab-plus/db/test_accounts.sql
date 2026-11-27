-- ============================================================================
-- MAKTAB+ — tests for accounts.sql (step 9). Fresh database: full stack +
-- seed.sql + auth_local.sql + school_setup.sql + accounts.sql.
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

-- logins made by a trusted script (like the demo seed): no "must change"
select app.set_password('aaaa0000-0000-4000-8000-00000000a001', '+998901000001', 'adminA-pass1');   -- school admin
select app.set_password('aaaa0000-0000-4000-8000-00000000a002', '+998901000002', 'director-pass1'); -- director
select app.set_password('aaaa0000-0000-4000-8000-00000000a004', '+998901000004', 'teacher-pass1');  -- teacher
select test.check('A1 logins made by trusted scripts keep working as they are',
  (select bool_and(not must_change) from auth.credentials));

-- the school admin imports a new teacher → a first password that must be changed
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a001');
select set_config('test.imp', api.import_school('{"teachers":[{"row":2,"last_name":"Yangi","first_name":"Ustoz","phone":"+998 90 777 66 55"}]}', true)::text, false);
reset role;
select set_config('test.pw', current_setting('test.imp')::jsonb->'logins'->0->>'password', false);
select test.check('A2 an imported person must change the first password',
  (select must_change from auth.credentials where login = '+998907776655'));
select test.check('A3 the login tells the server "must change"',
  (select must_change from app.password_login('school-a', '+998907776655', current_setting('test.pw'))));

select set_config('test.newuser', (select user_id::text from auth.credentials where login = '+998907776655'), false);
set role authenticated;
select test.asuser(current_setting('test.newuser')::uuid);
select test.check('A4 the old password must be right',
  test.err($q$ select api.change_my_password('nope-nope', 'Yaxshi-parol-1') $q$) = 'wrong_password');
select test.check('A5 a too short or the same password is refused',
  test.err(format($q$ select api.change_my_password(%L, 'qisqa') $q$, current_setting('test.pw'))) = 'password_too_short'
  and test.err(format($q$ select api.change_my_password(%L, %L) $q$, current_setting('test.pw'), current_setting('test.pw'))) = 'password_same');
select test.check('A6 the phone number or 12345678 as a password is refused',
  test.err(format($q$ select api.change_my_password(%L, '907776655') $q$, current_setting('test.pw'))) = 'password_weak'
  and test.err(format($q$ select api.change_my_password(%L, '12345678') $q$, current_setting('test.pw'))) = 'password_weak');
select test.check('A7 a good new password works',
  test.err(format($q$ select api.change_my_password(%L, 'Bahor-2026-yaxshi') $q$, current_setting('test.pw'))) = 'no error');
reset role;
select test.check('A8 … the "must change" mark is gone; old password no longer works, new one does',
  not (select must_change from auth.credentials where login = '+998907776655')
  and (select count(*) from app.password_login('school-a', '+998907776655', current_setting('test.pw'))) = 0
  and (select count(*) from app.password_login('school-a', '+998907776655', 'Bahor-2026-yaxshi')) = 1);

-- ---- the office resets a forgotten password ----
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
select test.check('A9 a zavuch cannot reset passwords',
  test.err($q$ select api.reset_password('aaaa0000-0000-4000-8000-00000000a004') $q$) = 'not_allowed');
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('A10 … nor can a teacher',
  test.err($q$ select api.reset_password('aaaa0000-0000-4000-8000-00000000a005') $q$) = 'not_allowed');
select test.asuser('aaaa0000-0000-4000-8000-00000000a001');  -- adminA
select set_config('test.reset', api.reset_password('aaaa0000-0000-4000-8000-00000000a004')::text, false);
select test.check('A11 the school admin gives the teacher a new first password',
  current_setting('test.reset')::jsonb->>'login' = '+998901000004' and length(current_setting('test.reset')::jsonb->>'password') = 8);
select test.check('A12 not for themselves, not for the director (higher), not for another school',
  test.err($q$ select api.reset_password('aaaa0000-0000-4000-8000-00000000a001') $q$) = 'not_yourself'
  and test.err($q$ select api.reset_password('aaaa0000-0000-4000-8000-00000000a002') $q$) = 'rank_too_low'
  and test.err($q$ select api.reset_password('aaaa0000-0000-4000-8000-00000000b002') $q$) = 'not_found');
select test.check('A13 a parent without a login gets one (their phone) on reset',
  test.val($q$ select api.reset_password('aaaa0000-0000-4000-8000-00000000a005')->>'login' $q$) = '+998901000005');
select test.check('A14 the people list finds by name and by phone, and says who may be reset',
  test.val($q$ select jsonb_array_length(api.school_people('Karim')) $q$) = '1'
  and test.val($q$ select api.school_people('1000004')->0->>'name' $q$) = 'Karimov Bekzod'
  and test.val($q$ select api.school_people('Sattorova')->0->>'can_reset' $q$) = 'false');
reset role;
select test.check('A15 after a reset: must change again; the old password is dead; the reset is in the audit log',
  (select must_change from auth.credentials where user_id = 'aaaa0000-0000-4000-8000-00000000a004')
  and (select count(*) from app.password_login('school-a', '+998901000004', 'teacher-pass1')) = 0
  and (select count(*) from audit_log where action = 'password_reset') = 2);
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000b001');  -- adminB
select test.check('A16 another school''s admin cannot see these people',
  test.val($q$ select count(*) from jsonb_array_elements(api.school_people('')) x where x->>'phone' = '+998901000004' $q$) = '0');
reset role;

-- ---- school or learning center ----
select test.check('A17 every organisation is a school unless set as a learning center',
  app.org_kind('school-a') = 'school' and test.err($q$ update schools set org_kind = 'kafe' where slug = 'school-a' $q$) <> 'no error');
set role anon;
select test.check('A18 the login page may read the kind (public, like name and colour)',
  test.err($q$ select app.org_kind('school-a') $q$) = 'no error');
reset role;

do $$
declare p int := current_setting('test.passed')::int; f int := current_setting('test.failed')::int;
begin
  if f > 0 then raise exception 'ACCOUNTS RESULT: % passed, % FAILED', p, f; end if;
  raise notice 'ACCOUNTS RESULT: all % scenarios passed', p;
end $$;
