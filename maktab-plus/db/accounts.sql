-- ============================================================================
-- MAKTAB+ — step 9: safe accounts for pilots + "school or learning center"
-- Load after auth_local.sql and school_setup.sql.
--
--  A. First passwords (from the Excel import or an office reset) must be
--     changed at the first login. The API server lets such a session do
--     nothing else until it is done.
--  B. Forgot your password? The school office (school admin / director)
--     gives a new first password — only to people below them in their own
--     school, never to themselves; every reset is in the audit log.
--  C. Every organisation is a "school" or a "center" (learning center).
--     One codebase; screens and words follow the kind.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A. "must change" on the login
-- ---------------------------------------------------------------------------
alter table auth.credentials add column if not exists must_change boolean not null default false;

-- Same body as auth_local.sql + must_change in the result.
drop function if exists app.password_login(text, text, text);
create function app.password_login(p_slug text, p_login text, p_password text)
returns table (user_id uuid, first_name text, last_name text, roles text[], must_change boolean)
language sql volatile security definer set search_path = public, extensions as $$
  select c.user_id, p.first_name, p.last_name,
         array_agg(r.role::text order by app.role_order(r.role)), c.must_change
  from auth.credentials c
  join profiles p on p.user_id = c.user_id
  join user_school_roles r on r.user_id = c.user_id and r.is_active
  join schools s on s.id = r.school_id and s.slug = lower(p_slug) and s.is_active
  where c.login = app.normalize_login(p_login)
    and c.password_hash = crypt(p_password, c.password_hash)
  group by c.user_id, p.first_name, p.last_name, c.must_change
$$;
revoke execute on function app.password_login(text, text, text) from public;
grant execute on function app.password_login(text, text, text) to anon;

-- people created by the Excel import start with must_change = true
create or replace function app.mark_first_password()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and auth.uid() is not null then new.must_change := true; end if;
  return new;
end $$;
drop trigger if exists credentials_first_password on auth.credentials;
create trigger credentials_first_password before insert on auth.credentials
  for each row execute function app.mark_first_password();
-- (seed scripts run without a logged-in user → demo logins stay as they are)

-- the logged-in person changes their own password
create or replace function api.change_my_password(p_old text, p_new text)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare c auth.credentials%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into c from auth.credentials where user_id = auth.uid() for update;
  if c.user_id is null or c.password_hash <> crypt(coalesce(p_old, ''), c.password_hash) then
    raise exception 'wrong_password' using errcode = '22023';
  end if;
  if length(coalesce(p_new, '')) < 8 or length(p_new) > 72 then raise exception 'password_too_short' using errcode = '22023'; end if;
  if p_new = p_old then raise exception 'password_same' using errcode = '22023'; end if;
  if p_new ~ '^\d+$' and (right(regexp_replace(c.login, '\D', '', 'g'), 9) like '%' || right(p_new, 6) || '%'
                          or p_new ~ '^(\d)\1+$' or p_new in ('12345678','123456789','1234567890','87654321')) then
    raise exception 'password_weak' using errcode = '22023';
  end if;
  update auth.credentials set password_hash = crypt(p_new, gen_salt('bf', 10)), must_change = false, changed_at = now()
   where user_id = auth.uid();
end $$;
revoke execute on function api.change_my_password(text, text) from public;
grant execute on function api.change_my_password(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- B. The office: people list + "give a new first password"
-- ---------------------------------------------------------------------------
create or replace function app.my_admin_school()
returns uuid language sql stable security definer set search_path = public as $$
  select r.school_id from user_school_roles r join schools s on s.id = r.school_id and s.is_active
  where r.user_id = auth.uid() and r.is_active and r.role in ('school_admin','director') limit 1
$$;

-- name, roles, login of everyone with a role in my school (search by name or phone)
create or replace function api.school_people(p_q text default '')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_school uuid := app.my_admin_school(); v_q text := lower(btrim(coalesce(p_q, '')));
begin
  if v_school is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x->>'name') from (
    select jsonb_build_object('user_id', p.user_id, 'name', p.last_name || ' ' || p.first_name, 'phone', p.phone,
             'roles', array_agg(distinct r.role::text), 'has_login', c.user_id is not null,
             'must_change', coalesce(c.must_change, false),
             'can_reset', p.user_id <> auth.uid() and max(app.role_rank(r.role)) < app.my_rank_at(v_school)) as x
    from user_school_roles r join profiles p on p.user_id = r.user_id
    left join auth.credentials c on c.user_id = p.user_id
    where r.school_id = v_school and r.is_active
      and (v_q = '' or lower(p.last_name || ' ' || p.first_name) like '%' || v_q || '%'
           or regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') like '%' || regexp_replace(v_q, '\D', '', 'g') || '%' and v_q ~ '\d')
    group by p.user_id, p.last_name, p.first_name, p.phone, c.user_id, c.must_change
    limit 50) y), '[]'::jsonb);
end $$;

create or replace function api.reset_password(p_user uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_school uuid := app.my_admin_school(); v_rank int; v_login text; v_pw text := app.temp_password(); v_phone text;
begin
  if v_school is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'not_yourself' using errcode = '42501'; end if;
  select max(app.role_rank(r.role)) into v_rank from user_school_roles r
   where r.user_id = p_user and r.school_id = v_school and r.is_active;
  if v_rank is null then raise exception 'not_found' using errcode = '22023'; end if;            -- not in my school
  if v_rank >= app.my_rank_at(v_school) then raise exception 'rank_too_low' using errcode = '42501'; end if;
  select login into v_login from auth.credentials where user_id = p_user;
  if v_login is null then
    select phone into v_phone from profiles where user_id = p_user;
    if v_phone is null then raise exception 'no_phone' using errcode = '22023'; end if;
    v_login := v_phone;
  end if;
  perform app.set_password(p_user, v_login, v_pw);
  update auth.credentials set must_change = true where user_id = p_user;
  insert into audit_log (user_id, school_id, table_name, row_id, action, new_value)
  values (auth.uid(), v_school, 'credentials', p_user::text, 'password_reset', jsonb_build_object('login', app.normalize_login(v_login)));
  return jsonb_build_object('login', app.normalize_login(v_login), 'password', v_pw);
end $$;
revoke execute on function api.school_people(text), api.reset_password(uuid), app.my_admin_school() from public;
grant execute on function api.school_people(text), api.reset_password(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- C. School or learning center
-- ---------------------------------------------------------------------------
alter table schools add column if not exists org_kind text not null default 'school' check (org_kind in ('school','center'));

-- the login page needs it before anyone logs in (public, like the school's name and colour)
create or replace function app.org_kind(p_slug text)
returns text language sql stable security definer set search_path = public as $$
  select org_kind from schools where slug = lower(p_slug) and is_active
$$;
grant execute on function app.org_kind(text) to anon, authenticated;
