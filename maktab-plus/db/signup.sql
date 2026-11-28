-- ============================================================================
-- MAKTAB+ — step 11: self sign-up from the website
-- Load after centers.sql. A director opens the website, chooses "school" or
-- "learning center", and creates the organisation + their own login in one
-- go. Called by the API server as the anonymous visitor; the server limits
-- how often one address may try.
-- What we cannot check yet: that the phone really belongs to this person (no
-- SMS / Telegram check in this step) — noted as an open item.
-- ============================================================================

-- all 14 regions; one "district not given" row per region for new sign-ups
insert into regions (id, name_uz, name_ru) values
 (1, 'Toshkent shahri', 'г. Ташкент'), (2, 'Toshkent viloyati', 'Ташкентская обл.'), (3, 'Andijon viloyati', 'Андижанская обл.'),
 (4, 'Farg''ona viloyati', 'Ферганская обл.'), (5, 'Namangan viloyati', 'Наманганская обл.'), (6, 'Samarqand viloyati', 'Самаркандская обл.'),
 (7, 'Buxoro viloyati', 'Бухарская обл.'), (8, 'Navoiy viloyati', 'Навоийская обл.'), (9, 'Qashqadaryo viloyati', 'Кашкадарьинская обл.'),
 (10, 'Surxondaryo viloyati', 'Сурхандарьинская обл.'), (11, 'Jizzax viloyati', 'Джизакская обл.'), (12, 'Sirdaryo viloyati', 'Сырдарьинская обл.'),
 (13, 'Xorazm viloyati', 'Хорезмская обл.'), (14, 'Qoraqalpog''iston Respublikasi', 'Республика Каракалпакстан')
on conflict (id) do nothing;
insert into districts (id, region_id, name_uz, name_ru)
select 9000 + id, id, 'Tuman ko''rsatilmagan', 'Район не указан' from regions where id between 1 and 14
on conflict (id) do nothing;

create table if not exists org_signups (
  id         bigint generated always as identity primary key,
  school_id  uuid references schools(id) on delete set null,
  org_kind   text not null,
  region_id  smallint,
  phone      text,
  created_at timestamptz not null default now()
);
alter table org_signups enable row level security;    -- platform staff only (no policies)

create or replace function api.signup_regions()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'uz', name_uz, 'ru', name_ru) order by id), '[]'::jsonb)
  from regions where id between 1 and 14
$$;

-- is this web address free? (used while typing)
create or replace function api.slug_free(p_slug text)
returns boolean language sql stable security definer set search_path = public as $$
  select lower(p_slug) ~ '^[a-z0-9][a-z0-9-]{2,30}[a-z0-9]$'
     and lower(p_slug) not in ('demo','demo-markaz','www','api','app','admin','maktab','maktabplus','school','center','markaz','live','test','help','support')
     and not exists (select 1 from schools where slug = lower(p_slug))
$$;

-- Role guard from round4_roles_signals.sql, unchanged except rule R0 below.
create or replace function app.guard_role_grant()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_trusted boolean := auth.uid() is null
                       and coalesce(nullif(current_setting('role', true), ''), 'none')
                           not in ('authenticated','anon');
  v_school  uuid;
begin
  if v_trusted then
    if tg_op <> 'DELETE' then
      perform app.log_role_change(lower(tg_op), case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
      return new;
    end if;
    perform app.log_role_change('delete', to_jsonb(old), null);
    return old;
  end if;
  -- R0 (step 11): self sign-up creates exactly ONE director for the organisation
  -- it is creating, inside api.signup_org (which sets this mark for this row only).
  if tg_op = 'INSERT' and new.role = 'director'
     and current_setting('app.signup_director', true) = new.user_id::text || '|' || new.school_id::text
     -- the organisation was created in THIS transaction and has no director yet,
     -- so the mark can never be used on an existing school
     and exists (select 1 from schools s where s.id = new.school_id
                 and s.xmin::text = (pg_current_xact_id()::text::bigint % 4294967296)::text)
     and not exists (select 1 from user_school_roles r where r.school_id = new.school_id and r.role = 'director') then
    perform app.log_role_change('signup', null, to_jsonb(new));
    return new;
  end if;
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    if old.role = 'director' then                                    -- R4
      raise exception 'director_change_platform_only' using errcode = '42501';
    end if;
    if app.role_rank(old.role) >= app.my_rank_at(old.school_id) and not app.is_super() then  -- R2
      raise exception 'rank_too_low' using errcode = '42501';
    end if;
    perform app.log_role_change('delete', to_jsonb(old), null);
    return old;
  end if;

  v_school := new.school_id;
  -- R1: own rows. Only allowed change: switch your own row OFF.
  if new.user_id = auth.uid() then
    if tg_op = 'UPDATE' and old.user_id = auth.uid() and old.is_active and not new.is_active
       and (to_jsonb(new) - 'is_active') = (to_jsonb(old) - 'is_active') then
      perform app.log_role_change('resign', to_jsonb(old), to_jsonb(new));
      return new;
    end if;
    raise exception 'no_self_grant' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.user_id = auth.uid() then
    raise exception 'no_self_grant' using errcode = '42501';            -- moving own row to someone
  end if;

  -- R3 / R4
  if new.role = 'director' and not app.is_super() then
    raise exception 'director_change_platform_only' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.role = 'director' and not app.is_super() then
    raise exception 'director_change_platform_only' using errcode = '42501';
  end if;

  -- R2: school-scoped roles only (district/region rows are handled by v3 policies)
  if v_school is not null and not app.is_super() then
    if app.role_rank(new.role) >= app.my_rank_at(v_school)
       or (tg_op = 'UPDATE' and app.role_rank(old.role) >= app.my_rank_at(old.school_id)) then
      raise exception 'rank_too_low' using errcode = '42501';
    end if;
  end if;

  new.granted_by := auth.uid();                                        -- R5
  if tg_op = 'INSERT' then new.granted_at := now(); end if;
  perform app.log_role_change(lower(tg_op), case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;

-- p = {kind: school|center, org_name, slug, region_id, first_name, last_name, phone, password}
create or replace function api.signup_org(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_kind text := p->>'kind'; v_name text := btrim(coalesce(p->>'org_name', ''));
        v_slug text := lower(btrim(coalesce(p->>'slug', ''))); v_region smallint := nullif(p->>'region_id', '')::smallint;
        v_first text := btrim(coalesce(p->>'first_name', '')); v_last text := btrim(coalesce(p->>'last_name', ''));
        v_phone text := app.norm_phone(p->>'phone'); v_pw text := coalesce(p->>'password', '');
        v_school uuid := gen_random_uuid(); v_user uuid := gen_random_uuid(); v_year smallint;
begin
  -- a platform-wide brake against bots (real sign-ups are a few per day)
  if (select count(*) from org_signups where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too_many_attempts' using errcode = '22023';
  end if;
  if v_kind not in ('school','center') then raise exception 'bad_kind' using errcode = '22023'; end if;
  if length(v_name) not between 3 and 80 then raise exception 'bad_org_name' using errcode = '22023'; end if;
  if not api.slug_free(v_slug) then raise exception 'slug_taken' using errcode = '22023'; end if;
  if v_region is null or v_region not between 1 and 14 then raise exception 'bad_region' using errcode = '22023'; end if;
  if length(v_first) not between 2 and 40 or length(v_last) not between 2 and 40 then raise exception 'bad_person_name' using errcode = '22023'; end if;
  if v_phone is null then raise exception 'bad_phone' using errcode = '22023'; end if;
  if exists (select 1 from profiles where phone = v_phone) then raise exception 'phone_taken' using errcode = '22023'; end if;
  if length(v_pw) < 8 or length(v_pw) > 72 then raise exception 'password_too_short' using errcode = '22023'; end if;
  if v_pw ~ '^\d+$' and (right(regexp_replace(v_phone, '\D', '', 'g'), 9) like '%' || right(v_pw, 6) || '%'
                         or v_pw ~ '^(\d)\1+$' or v_pw in ('12345678','123456789','1234567890','87654321')) then
    raise exception 'password_weak' using errcode = '22023';
  end if;
  select id into v_year from academic_years where is_current;

  insert into schools (id, district_id, name, mode, slug, brand_color, plan, org_kind)
  values (v_school, 9000 + v_region, v_name, 'private', v_slug, case v_kind when 'center' then '#b45309' else '#0f766e' end, 'standard', v_kind);
  -- default lesson times (the director can change them later)
  insert into bell_periods (school_id, number, start_time, end_time)
  select v_school, n,
         case v_kind when 'center' then time '09:00' + (n - 1) * interval '90 minutes' else time '08:00' + (n - 1) * interval '55 minutes' end,
         case v_kind when 'center' then time '10:20' + (n - 1) * interval '90 minutes' else time '08:45' + (n - 1) * interval '55 minutes' end
  from generate_series(1, 8) n;
  insert into auth.users (id) values (v_user);
  insert into profiles (user_id, first_name, last_name, phone) values (v_user, v_first, v_last, v_phone);
  perform set_config('app.signup_director', v_user::text || '|' || v_school::text, true);
  insert into user_school_roles (user_id, role, school_id) values (v_user, 'director', v_school);
  perform set_config('app.signup_director', '', true);
  perform app.set_password(v_user, v_phone, v_pw);
  update auth.credentials set must_change = false where user_id = v_user;   -- they chose it themselves
  insert into org_signups (school_id, org_kind, region_id, phone) values (v_school, v_kind, v_region, v_phone);
  insert into audit_log (user_id, school_id, table_name, row_id, action, new_value)
  values (v_user, v_school, 'schools', v_school::text, 'signup', jsonb_build_object('kind', v_kind, 'slug', v_slug, 'name', v_name));
  return jsonb_build_object('slug', v_slug, 'login', v_phone);
end $$;

-- first steps for a new director: what is done, what is next (numbers only)
create or replace function api.first_steps()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_school uuid := app.my_admin_school(); v_kind text;
begin
  if v_school is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  select org_kind into v_kind from schools where id = v_school;
  return jsonb_build_object('kind', v_kind,
    'teachers', (select count(*) from teachers where school_id = v_school),
    'classes',  (select count(*) from classes where school_id = v_school and not archived),
    'students', (select count(*) from students where school_id = v_school),
    'timetable', (select count(*) from timetable_slots ts join classes c on c.id = ts.class_id where c.school_id = v_school and ts.effective_to is null),
    'telegram', exists (select 1 from telegram_links where user_id = auth.uid() and active));
end $$;

revoke execute on function api.signup_regions(), api.slug_free(text), api.signup_org(jsonb), api.first_steps() from public;
grant execute on function api.signup_regions(), api.slug_free(text), api.signup_org(jsonb) to anon;
-- website visitors may enter the api schema, but run ONLY the three sign-up
-- functions above; and from now on a new api function is closed to everyone
-- until it is granted on purpose.
grant usage on schema api to anon;
alter default privileges in schema api revoke execute on functions from public;
grant execute on function api.first_steps() to authenticated;
