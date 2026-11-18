-- ============================================================================
-- MAKTAB+ — login for our own API server (local / self-hosted)
--
-- 1. authenticator: the role the API server connects as. It has NO table
--    rights of its own (NOINHERIT): for every request the server must
--    SET LOCAL ROLE `authenticated` (logged-in user) or `anon` (visitor), so
--    RLS always applies — even if the server code has a bug.
-- 2. Passwords: bcrypt hashes in auth.credentials. Nobody can read that table
--    (not even logged-in users); the only door is app.password_login().
--    Login = phone number (+998…) or a short login name given by the school
--    (for children without a phone).
-- 3. You log in to ONE school window: password_login() only succeeds if you
--    have an active role in that (open) school. Your roles come from the
--    database; the person never "chooses" a role they do not have.
-- If we move to Supabase Auth later, this file is replaced; RLS stays.
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'dev-only-change-me';
  end if;
end $$;
grant anon, authenticated to authenticator;

create table if not exists auth.credentials (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  login         text not null unique check (login = lower(login) and length(login) between 3 and 40),
  password_hash text not null,
  changed_at    timestamptz not null default now()
);
revoke all on auth.credentials from public, anon, authenticated;

-- "+998 90 000-01-11" / "998900000111" / "900000111" → "+998900000111"; other logins → lower-case
create or replace function app.normalize_login(p_login text)
returns text language sql immutable as $$
  select case
    when regexp_replace(p_login, '[^0-9+]', '', 'g') ~ '^\+?(998)?[0-9]{9}$'
      then '+998' || right(regexp_replace(p_login, '[^0-9]', '', 'g'), 9)
    else lower(btrim(p_login)) end
$$;

-- Set or change a password (school office / onboarding, run by the service role).
create or replace function app.set_password(p_user_id uuid, p_login text, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(p_password) < 8 then raise exception 'password_too_short' using errcode = '22023'; end if;
  insert into auth.credentials (user_id, login, password_hash)
  values (p_user_id, app.normalize_login(p_login), crypt(p_password, gen_salt('bf', 10)))
  on conflict (user_id) do update
    set login = excluded.login, password_hash = excluded.password_hash, changed_at = now();
end $$;
revoke execute on function app.set_password(uuid, text, text) from public, anon, authenticated;

create or replace function app.role_order(p_role user_role)
returns int language sql immutable as $$
  select array_position(array['director','school_admin','zavuch','teacher','parent','student']::text[], p_role::text)
$$;

-- The only way in. Returns the user and their roles IN THIS SCHOOL, or nothing.
-- Same answer (nothing) for "no such login", "wrong password" and "not in this
-- school", so it can't be used to discover who has an account.
create or replace function app.password_login(p_slug text, p_login text, p_password text)
returns table (user_id uuid, first_name text, last_name text, roles text[])
language sql volatile security definer set search_path = public, extensions as $$
  select c.user_id, p.first_name, p.last_name,
         array_agg(r.role::text order by app.role_order(r.role))
  from auth.credentials c
  join profiles p on p.user_id = c.user_id
  join user_school_roles r on r.user_id = c.user_id and r.is_active
  join schools s on s.id = r.school_id and s.slug = lower(p_slug) and s.is_active
  where c.login = app.normalize_login(p_login)
    and c.password_hash = crypt(p_password, c.password_hash)
  group by c.user_id, p.first_name, p.last_name
$$;
revoke execute on function app.password_login(text, text, text) from public;
grant execute on function app.password_login(text, text, text) to anon;
