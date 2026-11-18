-- ============================================================================
-- MAKTAB+ — server connection role + DEMO login (development / demo only)
--
-- authenticator: the role our API server connects as. It has NO table rights
-- of its own (NOINHERIT): for every request the server must SET LOCAL ROLE
-- to `authenticated` (logged-in user) or `anon` (visitor), so RLS always
-- applies — even if the server code has a bug. Same model as Supabase.
--
-- app.demo_login_user(): one-tap login for the PUBLIC DEMO SCHOOL only
-- (slug 'demo'). It returns nothing for any other school. Real schools log
-- in with Supabase Auth / phone OTP (later step) — never with this.
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'dev-only-change-me';
  end if;
end $$;
grant anon, authenticated to authenticator;

create or replace function app.demo_login_user(p_slug text, p_role user_role)
returns table (user_id uuid, first_name text, last_name text)
language sql stable security definer set search_path = public as $$
  select r.user_id, p.first_name, p.last_name
  from user_school_roles r
  join schools s on s.id = r.school_id and s.slug = 'demo' and s.is_active
  join profiles p on p.user_id = r.user_id
  where p_slug = 'demo' and r.role = p_role and r.is_active
  order by r.user_id
  limit 1
$$;
revoke execute on function app.demo_login_user(text, user_role) from public;
grant execute on function app.demo_login_user(text, user_role) to anon;
