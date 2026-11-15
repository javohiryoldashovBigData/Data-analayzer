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
