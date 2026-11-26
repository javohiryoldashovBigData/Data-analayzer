-- ============================================================================
-- MAKTAB+ — step 8b: set up a school from one Excel file
-- Load after auth_local.sql (uses app.set_password) and telegram.sql.
--
-- The browser reads the Excel file (the server never opens uploaded files)
-- and sends plain rows. This function checks EVERY row and either
--   * preview (p_commit = false): returns all problems + what would be created
--   * commit  (p_commit = true):  saves everything in one go, or nothing.
-- Safe to run again with the same file: existing classes, people, students
-- and links are found and reused, never duplicated.
-- Only the school admin or director may import, and only into their own
-- school: no id from the file is ever trusted.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Small parsers (immutable, no data access)
-- ---------------------------------------------------------------------------
-- phone → "+998XXXXXXXXX" (Uzbek mobile) or null
create or replace function app.norm_phone(p text)
returns text language sql immutable as $$
  select case when regexp_replace(coalesce(p, ''), '\D', '', 'g') ~ '^(998)?[0-9]{9}$'
              then '+998' || right(regexp_replace(p, '\D', '', 'g'), 9) end
$$;

-- "5-A" / "5A" / "5 a" / "5-А" (Cyrillic) → grade 5, letter "A"
create or replace function app.parse_class(p text, out grade smallint, out letter text)
language plpgsql immutable as $$
declare m text[];
begin
  m := regexp_match(upper(btrim(coalesce(p, ''))), '^([0-9]{1,2})\s*[-–\s]?\s*([A-ZА-ЯЎҚҒҲ])$');
  if m is null or m[1]::int not between 1 and 11 then return; end if;
  grade := m[1]::smallint;
  letter := translate(m[2], 'АБВГДЕЖЗИКЛМНОПРСТУФХЎҚҒҲ', 'ABVGDEJZIKLMNOPRSTUFXOQGH');
end $$;

-- 1..6, or Uzbek / Russian day names
create or replace function app.parse_day(p text)
returns smallint language sql immutable as $$
  select case
    when btrim(p) ~ '^[1-6]$' then btrim(p)::smallint
    when lower(btrim(p)) in ('dushanba','душанба','понедельник','пн','du') then 1
    when lower(btrim(p)) in ('seshanba','сешанба','вторник','вт','se') then 2
    when lower(btrim(p)) in ('chorshanba','чоршанба','среда','ср','ch') then 3
    when lower(btrim(p)) in ('payshanba','пайшанба','четверг','чт','pa') then 4
    when lower(btrim(p)) in ('juma','жума','пятница','пт','ju') then 5
    when lower(btrim(p)) in ('shanba','шанба','суббота','сб','sh') then 6 end
$$;

-- "2014-05-21" or "21.05.2014" → date (null if not a real date)
create or replace function app.parse_date(p text)
returns date language plpgsql immutable as $$
declare d date;
begin
  if p is null or btrim(p) = '' then return null; end if;
  if btrim(p) ~ '^\d{4}-\d{2}-\d{2}$' then d := btrim(p)::date;
  elsif btrim(p) ~ '^\d{1,2}[./]\d{1,2}[./]\d{4}$' then d := to_date(replace(btrim(p), '/', '.'), 'DD.MM.YYYY');
  end if;
  if d is null or d < date '1990-01-01' or d > current_date then return null; end if;
  if to_char(d, 'FMDD.FMMM.YYYY') <> regexp_replace(replace(btrim(p), '/', '.'), '^0?(\d+)\.0?(\d+)\.', '\1.\2.')
     and btrim(p) !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;              -- 31.02 etc.
  return d;
exception when others then return null;
end $$;

create or replace function app.parse_relation(p text)
returns guardian_relation language sql immutable as $$
  select (case
    when lower(btrim(coalesce(p, ''))) in ('ona','она','мать','mother','onasi') then 'mother'
    when lower(btrim(coalesce(p, ''))) in ('ota','ота','отец','father','otasi') then 'father'
    when lower(btrim(coalesce(p, ''))) in ('buvi','бувиси','бабушка','grandmother','buvisi') then 'grandmother'
    when lower(btrim(coalesce(p, ''))) in ('bobo','бобоси','дедушка','grandfather','bobosi') then 'grandfather'
    when lower(btrim(coalesce(p, ''))) in ('aka','брат','brother','akasi') then 'brother'
    when lower(btrim(coalesce(p, ''))) in ('opa','сестра','sister','opasi') then 'sister'
    else 'other' end)::guardian_relation
$$;

create or replace function app.parse_gender(p text)
returns gender language sql immutable as $$
  select (case when lower(btrim(coalesce(p, ''))) in ('o''g''il','ogil','o‘g‘il','m','erkak','мальчик','м','boy','male') then 'm'
               when lower(btrim(coalesce(p, ''))) in ('qiz','f','ayol','девочка','ж','girl','female') then 'f' end)::gender
$$;

-- 8 characters, no look-alike letters (no 0/o, 1/l/i)
create or replace function app.temp_password()
returns text language sql volatile set search_path = public, extensions as $$
  select string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', (get_byte(b, i) % 31) + 1, 1), '')
  from (select gen_random_bytes(8) as b) x, generate_series(0, 7) i
$$;

-- ---------------------------------------------------------------------------
-- The import
-- ---------------------------------------------------------------------------
-- p_data = { teachers:  [{row, last_name, first_name, phone, class_teacher_of}],
--            students:  [{row, last_name, first_name, middle_name, class, birth_date, gender,
--                         parent_last_name, parent_first_name, parent_phone, relation}],
--            timetable: [{row, class, day, period, subject, teacher_phone}] }
-- DEFINER because it creates people (auth.users, logins). Guarded: caller must
-- be school admin / director of an open school; everything goes into THAT school.
create or replace function api.import_school(p_data jsonb, p_commit boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  v_school uuid; v_year smallint; v_me_phone text;
  v_err jsonb := '[]'; v_warn jsonb := '[]'; v_logins jsonb := '[]';
  r record; v_user uuid; v_teacher uuid; v_student uuid; v_class uuid; v_pw text; v_n int;
  c_classes_new int; c_t_new int; c_t_old int; c_s_new int; c_s_old int; c_p_new int; c_p_old int; c_slots int;
begin
  select r2.school_id into v_school from user_school_roles r2 join schools s on s.id = r2.school_id and s.is_active
   where r2.user_id = auth.uid() and r2.is_active and r2.role in ('school_admin','director') limit 1;
  if v_school is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  select id into v_year from academic_years where is_current;
  if v_year is null then raise exception 'no_current_year' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_data->'students', '[]')) > 3000 or jsonb_array_length(coalesce(p_data->'teachers', '[]')) > 300
     or jsonb_array_length(coalesce(p_data->'timetable', '[]')) > 5000 then
    raise exception 'file_too_big' using errcode = '22023';
  end if;
  select phone into v_me_phone from profiles where user_id = auth.uid();

  -- ---- stage the rows (parsed) ----
  perform set_config('client_min_messages', 'warning', true);
  drop table if exists imp_t, imp_s, imp_tt, imp_c;
  create temp table imp_t on commit drop as
  select (x->>'row')::int as row, nullif(btrim(x->>'last_name'), '') as last_name, nullif(btrim(x->>'first_name'), '') as first_name,
         x->>'phone' as phone_raw, app.norm_phone(x->>'phone') as phone,
         nullif(btrim(x->>'class_teacher_of'), '') as ct_raw, (app.parse_class(x->>'class_teacher_of')).*
  from jsonb_array_elements(coalesce(p_data->'teachers', '[]')) x;
  create temp table imp_s on commit drop as
  select (x->>'row')::int as row, nullif(btrim(x->>'last_name'), '') as last_name, nullif(btrim(x->>'first_name'), '') as first_name,
         nullif(btrim(x->>'middle_name'), '') as middle_name, x->>'class' as class_raw, (app.parse_class(x->>'class')).*,
         nullif(btrim(x->>'birth_date'), '') as birth_raw, app.parse_date(x->>'birth_date') as birth_date,
         app.parse_gender(x->>'gender') as gender,
         nullif(btrim(x->>'parent_last_name'), '') as p_last, nullif(btrim(x->>'parent_first_name'), '') as p_first,
         nullif(btrim(x->>'parent_phone'), '') as p_phone_raw, app.norm_phone(x->>'parent_phone') as p_phone,
         app.parse_relation(x->>'relation') as relation
  from jsonb_array_elements(coalesce(p_data->'students', '[]')) x;
  create temp table imp_tt on commit drop as
  select (x->>'row')::int as row, x->>'class' as class_raw, (app.parse_class(x->>'class')).*,
         x->>'day' as day_raw, app.parse_day(x->>'day') as day,
         case when btrim(x->>'period') ~ '^[1-9]$' then btrim(x->>'period')::smallint end as period,
         x->>'subject' as subject_raw,
         (select sb.id from subjects sb where lower(btrim(x->>'subject')) in (lower(sb.name_uz), lower(sb.name_ru), lower(sb.code)) limit 1) as subject_id,
         app.norm_phone(x->>'teacher_phone') as t_phone, x->>'teacher_phone' as t_phone_raw
  from jsonb_array_elements(coalesce(p_data->'timetable', '[]')) x;

  -- ---- check teachers ----
  v_err := v_err
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','teachers','row',row,'field','name','code','missing_name'))
                 from imp_t where last_name is null or first_name is null), '[]')
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','teachers','row',row,'field','phone','code','bad_phone','value',phone_raw))
                 from imp_t where phone is null), '[]')
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','teachers','row',row,'field','phone','code','duplicate_phone','value',phone))
                 from imp_t t where phone is not null and exists (select 1 from imp_t t2 where t2.phone = t.phone and t2.row < t.row)), '[]')
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','teachers','row',row,'field','class_teacher_of','code','bad_class','value',ct_raw))
                 from imp_t where ct_raw is not null and grade is null), '[]')
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','teachers','row',t.row,'field','phone','code','teacher_other_school','value',t.phone))
                 from imp_t t join profiles p on p.phone = t.phone join teachers te on te.user_id = p.user_id
                 where te.school_id <> v_school), '[]')
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','teachers','row',row,'field','phone','code','is_you','value',phone))
                 from imp_t where phone = v_me_phone), '[]');

  -- ---- check students ----
  v_err := v_err
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','students','row',row,'field','name','code','missing_name'))
                 from imp_s where last_name is null or first_name is null), '[]')
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','students','row',row,'field','class','code','bad_class','value',class_raw))
                 from imp_s where grade is null), '[]')
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','students','row',row,'field','birth_date','code','bad_date','value',birth_raw))
                 from imp_s where birth_raw is not null and birth_date is null), '[]')
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','students','row',row,'field','parent_phone','code','bad_phone','value',p_phone_raw))
                 from imp_s where p_phone_raw is not null and p_phone is null), '[]')
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','students','row',s.row,'field','name','code','duplicate_student'))
                 from imp_s s where exists (select 1 from imp_s s2 where s2.row < s.row and lower(s2.last_name) = lower(s.last_name)
                   and lower(s2.first_name) = lower(s.first_name) and s2.grade = s.grade and s2.letter = s.letter
                   and s2.birth_date is not distinct from s.birth_date)), '[]')
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','students','row',row,'field','parent_phone','code','is_you','value',p_phone))
                 from imp_s where p_phone = v_me_phone), '[]');
  v_warn := v_warn
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','students','row',row,'field','parent_phone','code','no_parent_phone'))
                 from imp_s where p_phone_raw is null), '[]');

  -- ---- check timetable ----
  v_err := v_err
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','timetable','row',row,'field','class','code','bad_class','value',class_raw))
                 from imp_tt where grade is null), '[]')
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','timetable','row',row,'field','day','code','bad_day','value',day_raw))
                 from imp_tt where day is null), '[]')
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','timetable','row',row,'field','period','code','bad_period'))
                 from imp_tt where period is null), '[]')
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','timetable','row',row,'field','subject','code','unknown_subject','value',subject_raw))
                 from imp_tt where subject_id is null), '[]')
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','timetable','row',tt.row,'field','teacher_phone','code','unknown_teacher','value',tt.t_phone_raw))
                 from imp_tt tt where tt.t_phone is null or not (
                   exists (select 1 from imp_t t where t.phone = tt.t_phone)
                   or exists (select 1 from profiles p join teachers te on te.user_id = p.user_id and te.school_id = v_school where p.phone = tt.t_phone))), '[]')
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','timetable','row',a.row,'field','period','code','class_clash'))
                 from imp_tt a where a.grade is not null and exists (select 1 from imp_tt b where b.row < a.row and b.grade = a.grade
                   and b.letter = a.letter and b.day = a.day and b.period = a.period)), '[]')
    || coalesce((select jsonb_agg(jsonb_build_object('sheet','timetable','row',a.row,'field','teacher_phone','code','teacher_clash'))
                 from imp_tt a where a.t_phone is not null and exists (select 1 from imp_tt b where b.row < a.row and b.t_phone = a.t_phone
                   and b.day = a.day and b.period = a.period)), '[]');

  -- ---- what would be created ----
  create temp table imp_c on commit drop as
  select distinct grade, letter from (select grade, letter from imp_s union select grade, letter from imp_tt union select grade, letter from imp_t) z
  where grade is not null;
  select count(*) into c_classes_new from imp_c c
   where not exists (select 1 from classes k where k.school_id = v_school and k.academic_year_id = v_year and k.grade_level = c.grade and k.letter = c.letter);
  select count(*) filter (where p.user_id is null), count(*) filter (where p.user_id is not null) into c_t_new, c_t_old
    from imp_t t left join profiles p on p.phone = t.phone where t.phone is not null;
  select count(*) filter (where ex.id is null), count(*) filter (where ex.id is not null) into c_s_new, c_s_old
    from imp_s s left join lateral (select st.id from students st join class_members cm on cm.student_id = st.id and cm.status = 'active'
        join classes k on k.id = cm.class_id and k.grade_level = s.grade and k.letter = s.letter and k.academic_year_id = v_year
        where st.school_id = v_school and lower(st.last_name) = lower(s.last_name) and lower(st.first_name) = lower(s.first_name)
          and st.birth_date is not distinct from s.birth_date limit 1) ex on true where s.grade is not null;
  select count(*) filter (where p.user_id is null), count(*) filter (where p.user_id is not null) into c_p_new, c_p_old
    from (select distinct p_phone from imp_s where p_phone is not null and p_phone not in (select phone from imp_t where phone is not null)) s
    left join profiles p on p.phone = s.p_phone;
  select count(*) into c_slots from imp_tt;

  if not p_commit or jsonb_array_length(v_err) > 0 then
    return jsonb_build_object('ok', jsonb_array_length(v_err) = 0, 'committed', false, 'errors', v_err, 'warnings', v_warn,
      'summary', jsonb_build_object('classes_new', c_classes_new, 'teachers_new', c_t_new, 'teachers_existing', c_t_old,
        'students_new', c_s_new, 'students_existing', c_s_old, 'parents_new', c_p_new, 'parents_existing', c_p_old, 'timetable_rows', c_slots));
  end if;

  -- ======================= COMMIT (all or nothing) =========================
  insert into classes (school_id, academic_year_id, grade_level, letter)
  select v_school, v_year, grade, letter from imp_c on conflict (school_id, academic_year_id, grade_level, letter) do nothing;

  -- people: one helper block for "find by phone or create with a first password"
  for r in select * from imp_t order by row loop
    select user_id into v_user from profiles where phone = r.phone;
    if v_user is null then
      v_user := gen_random_uuid(); v_pw := app.temp_password();
      insert into auth.users (id) values (v_user);
      insert into profiles (user_id, first_name, last_name, phone) values (v_user, r.first_name, r.last_name, r.phone);
      perform app.set_password(v_user, r.phone, v_pw);
      v_logins := v_logins || jsonb_build_object('name', r.last_name || ' ' || r.first_name, 'role', 'teacher', 'login', r.phone, 'password', v_pw);
    end if;
    insert into user_school_roles (user_id, role, school_id)
    select v_user, 'teacher', v_school where not exists (select 1 from user_school_roles x where x.user_id = v_user and x.role = 'teacher' and x.school_id = v_school);
    insert into teachers (school_id, user_id) values (v_school, v_user) on conflict (user_id) do nothing;
    if r.grade is not null then
      update classes set class_teacher_id = (select id from teachers where user_id = v_user)
       where school_id = v_school and academic_year_id = v_year and grade_level = r.grade and letter = r.letter;
    end if;
  end loop;

  for r in select * from imp_s order by row loop
    select id into v_class from classes where school_id = v_school and academic_year_id = v_year and grade_level = r.grade and letter = r.letter;
    select st.id into v_student from students st join class_members cm on cm.student_id = st.id and cm.class_id = v_class and cm.status = 'active'
     where st.school_id = v_school and lower(st.last_name) = lower(r.last_name) and lower(st.first_name) = lower(r.first_name)
       and st.birth_date is not distinct from r.birth_date limit 1;
    if v_student is null then
      insert into students (school_id, first_name, last_name, middle_name, gender, birth_date)
      values (v_school, r.first_name, r.last_name, r.middle_name, r.gender, r.birth_date) returning id into v_student;
      insert into class_members (class_id, student_id) values (v_class, v_student);
    end if;
    if r.p_phone is not null then
      select user_id into v_user from profiles where phone = r.p_phone;
      if v_user is null then
        v_user := gen_random_uuid(); v_pw := app.temp_password();
        insert into auth.users (id) values (v_user);
        insert into profiles (user_id, first_name, last_name, phone)
        values (v_user, coalesce(r.p_first, 'Ota-ona'), coalesce(r.p_last, r.last_name), r.p_phone);
        perform app.set_password(v_user, r.p_phone, v_pw);
        v_logins := v_logins || jsonb_build_object('name', coalesce(r.p_last, r.last_name) || ' ' || coalesce(r.p_first, ''),
                                 'role', 'parent', 'login', r.p_phone, 'password', v_pw, 'child', r.last_name || ' ' || r.first_name);
      end if;
      insert into user_school_roles (user_id, role, school_id)
      select v_user, 'parent', v_school where not exists (select 1 from user_school_roles x where x.user_id = v_user and x.role = 'parent' and x.school_id = v_school);
      insert into guardians (parent_user_id, student_id, relation, is_primary)
      values (v_user, v_student, r.relation, not exists (select 1 from guardians g where g.student_id = v_student))
      on conflict (parent_user_id, student_id) do nothing;
    end if;
  end loop;

  -- timetable: the file replaces the timetable of the classes it lists, from today
  if exists (select 1 from imp_tt) then
    delete from timetable_slots ts using classes k, imp_c c
     where ts.class_id = k.id and k.school_id = v_school and k.academic_year_id = v_year and k.grade_level = c.grade and k.letter = c.letter
       and exists (select 1 from imp_tt t where t.grade = c.grade and t.letter = c.letter) and ts.effective_from >= current_date;
    update timetable_slots ts set effective_to = current_date - 1 from classes k
     where ts.class_id = k.id and k.school_id = v_school and k.academic_year_id = v_year and ts.effective_to is null
       and exists (select 1 from imp_tt t where t.grade = k.grade_level and t.letter = k.letter);
    insert into timetable_slots (class_id, day_of_week, period, subject_id, teacher_id, effective_from)
    select k.id, t.day, t.period, t.subject_id, te.id, current_date
    from imp_tt t
    join classes k on k.school_id = v_school and k.academic_year_id = v_year and k.grade_level = t.grade and k.letter = t.letter
    join profiles p on p.phone = t.t_phone join teachers te on te.user_id = p.user_id and te.school_id = v_school;
    insert into teacher_assignments (teacher_id, class_id, subject_id, academic_year_id)
    select distinct te.id, k.id, t.subject_id, v_year from imp_tt t
    join classes k on k.school_id = v_school and k.academic_year_id = v_year and k.grade_level = t.grade and k.letter = t.letter
    join profiles p on p.phone = t.t_phone join teachers te on te.user_id = p.user_id and te.school_id = v_school
    on conflict do nothing;
  end if;

  -- a parent's slip lists ALL their children in this school (siblings)
  v_logins := coalesce((select jsonb_agg(case when l->>'role' = 'parent' then l || jsonb_build_object('child',
                 (select string_agg(st.last_name || ' ' || st.first_name, ', ' order by st.first_name)
                  from guardians g join students st on st.id = g.student_id and st.school_id = v_school
                  join profiles p on p.user_id = g.parent_user_id where p.phone = l->>'login')) else l end)
               from jsonb_array_elements(v_logins) l), '[]');

  insert into audit_log (user_id, school_id, table_name, row_id, action, new_value)
  values (auth.uid(), v_school, 'school_import', v_school::text, 'import',
          jsonb_build_object('classes_new', c_classes_new, 'teachers_new', c_t_new, 'students_new', c_s_new,
                             'parents_new', c_p_new, 'timetable_rows', c_slots, 'logins_created', jsonb_array_length(v_logins)));
  return jsonb_build_object('ok', true, 'committed', true, 'errors', '[]'::jsonb, 'warnings', v_warn, 'logins', v_logins,
    'summary', jsonb_build_object('classes_new', c_classes_new, 'teachers_new', c_t_new, 'teachers_existing', c_t_old,
      'students_new', c_s_new, 'students_existing', c_s_old, 'parents_new', c_p_new, 'parents_existing', c_p_old, 'timetable_rows', c_slots));
end $$;

revoke execute on function api.import_school(jsonb, boolean) from public;
grant execute on function api.import_school(jsonb, boolean) to authenticated;
grant execute on function app.norm_phone(text), app.parse_class(text), app.parse_day(text), app.parse_date(text),
  app.parse_relation(text), app.parse_gender(text) to authenticated;
revoke execute on function app.temp_password() from public, authenticated;
