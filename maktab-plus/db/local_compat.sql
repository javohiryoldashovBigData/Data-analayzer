-- ============================================================================
-- MAKTAB+ — local compatibility shim for plain PostgreSQL 15/16 testing
--
-- Run this FIRST (before schema.sql) when you are NOT on Supabase.
-- On self-hosted Supabase, skip this file: auth.users and auth.uid() exist.
--
-- It fakes the two Supabase primitives the schema relies on:
--   auth.users  — identity table
--   auth.uid()  — current user id, driven by the app.current_user_id GUC
--                 (test scripts switch users with set_config)
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then   -- V3: not-logged-in visitor
    create role anon nologin;
  end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key,
  email text unique
);

create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

-- V3: Supabase lets logged-in users call auth.uid(); do the same here.
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
