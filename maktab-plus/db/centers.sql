-- ============================================================================
-- MAKTAB+ — step 10: learning centers — groups
-- Load after accounts.sql. A GROUP is a row in `classes` with a name, so all
-- the school features (attendance, lesson cards, tests, grades, Telegram
-- alerts, AI help) work for groups too. Students: any age — a child is
-- reached through the parent, an adult (or a teen with a phone) directly.
-- One student can be in several groups.
-- ============================================================================
alter type member_status add value if not exists 'left';

alter table classes add column if not exists course     text check (length(course) <= 80);
alter table classes add column if not exists subject_id smallint references subjects(id);
alter table classes add column if not exists starts_on  date;
alter table classes add column if not exists ends_on    date;
alter table classes add column if not exists capacity   smallint check (capacity between 1 and 200);
alter table classes add column if not exists archived   boolean not null default false;

-- the caller manages a LEARNING CENTER → its id
create or replace function app.my_center()
returns uuid language sql stable security definer set search_path = public as $$
  select r.school_id from user_school_roles r join schools s on s.id = r.school_id and s.is_active and s.org_kind = 'center'
  where r.user_id = auth.uid() and r.is_active and r.role in ('school_admin','director','zavuch') limit 1
$$;
create or replace function app.center_or_fail()
returns uuid language plpgsql stable security invoker set search_path = public as $$
declare v uuid := app.my_center();
begin
  if v is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Groups list (center leaders)
-- ---------------------------------------------------------------------------
create or replace function api.center_groups()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_center uuid := app.center_or_fail();
begin
  return coalesce((select jsonb_agg(x order by x->>'archived', x->>'name') from (
    select jsonb_build_object(
      'id', c.id, 'name', c.name, 'course', c.course, 'subject_id', c.subject_id, 'subject', sub.name_uz,
      'teacher_id', c.class_teacher_id, 'teacher', p.first_name || ' ' || p.last_name,
      'starts_on', c.starts_on, 'ends_on', c.ends_on, 'capacity', c.capacity, 'archived', c.archived,
      'students', (select count(*) from class_members cm where cm.class_id = c.id and cm.status = 'active'),
      'schedule', coalesce((select jsonb_agg(jsonb_build_object('day', ts.day_of_week, 'period', ts.period,
                     'start', bp.start_time, 'end', bp.end_time) order by ts.day_of_week, ts.period)
                   from timetable_slots ts left join bell_periods bp on bp.school_id = c.school_id and bp.number = ts.period
                   where ts.class_id = c.id and ts.effective_to is null), '[]'::jsonb)) as x
    from classes c
    left join subjects sub on sub.id = c.subject_id
    left join teachers t on t.id = c.class_teacher_id left join profiles p on p.user_id = t.user_id
    where c.school_id = v_center and c.name is not null) y), '[]'::jsonb);
end $$;

-- what the "new group" form offers: teachers, subjects, lesson times
create or replace function api.center_options()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_center uuid := app.center_or_fail();
begin
  return jsonb_build_object(
    'teachers', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', p.first_name || ' ' || p.last_name) order by p.last_name)
                 from teachers t join profiles p on p.user_id = t.user_id where t.school_id = v_center and t.status = 'active'), '[]'::jsonb),
    'subjects', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name_uz) order by name_uz) from subjects), '[]'::jsonb),
    'periods',  coalesce((select jsonb_agg(jsonb_build_object('number', number, 'start', start_time, 'end', end_time) order by number)
                 from bell_periods where school_id = v_center), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Create / edit a group: {id?, name, course, subject_id, teacher_id, starts_on,
-- ends_on, capacity, schedule:[{day 1-6, period}]}. The schedule replaces the
-- group's lessons from today. A teacher cannot be in two groups at once.
-- DEFINER with an explicit center check (writes classes + timetable + assignments).
-- ---------------------------------------------------------------------------
create or replace function api.save_group(p jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_center uuid := app.center_or_fail(); v_year smallint; v_id uuid; v_teacher uuid; v_subject smallint;
        v_name text := btrim(coalesce(p->>'name', '')); s jsonb;
begin
  select id into v_year from academic_years where is_current;
  if length(v_name) not between 2 and 80 then raise exception 'bad_name' using errcode = '22023'; end if;
  v_teacher := nullif(p->>'teacher_id', '')::uuid;
  if v_teacher is null or not exists (select 1 from teachers where id = v_teacher and school_id = v_center) then
    raise exception 'bad_teacher' using errcode = '22023';
  end if;
  v_subject := nullif(p->>'subject_id', '')::smallint;
  if v_subject is null or not exists (select 1 from subjects where id = v_subject) then raise exception 'bad_subject' using errcode = '22023'; end if;
  if (p->>'starts_on') is not null and (p->>'ends_on') is not null and (p->>'ends_on')::date < (p->>'starts_on')::date then
    raise exception 'bad_dates' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p->'schedule', '[]')) <> 'array' or jsonb_array_length(coalesce(p->'schedule', '[]')) > 20 then
    raise exception 'bad_schedule' using errcode = '22023';
  end if;
  for s in select * from jsonb_array_elements(coalesce(p->'schedule', '[]')) loop
    if (s->>'day')::int not between 1 and 6 or (s->>'period')::int not between 1 and 9 then raise exception 'bad_schedule' using errcode = '22023'; end if;
  end loop;

  if nullif(p->>'id', '') is null then
    insert into classes (school_id, academic_year_id, name, course, subject_id, class_teacher_id, starts_on, ends_on, capacity)
    values (v_center, v_year, v_name, nullif(btrim(p->>'course'), ''), v_subject, v_teacher,
            nullif(p->>'starts_on', '')::date, nullif(p->>'ends_on', '')::date, nullif(p->>'capacity', '')::smallint)
    returning id into v_id;
  else
    update classes set name = v_name, course = nullif(btrim(p->>'course'), ''), subject_id = v_subject, class_teacher_id = v_teacher,
           starts_on = nullif(p->>'starts_on', '')::date, ends_on = nullif(p->>'ends_on', '')::date,
           capacity = nullif(p->>'capacity', '')::smallint, archived = coalesce((p->>'archived')::boolean, archived)
     where id = (p->>'id')::uuid and school_id = v_center and name is not null
    returning id into v_id;
    if v_id is null then raise exception 'not_found' using errcode = '22023'; end if;
  end if;

  -- the teacher teaches this subject to this group (lesson cards, grades, tests…)
  insert into teacher_assignments (teacher_id, class_id, subject_id, academic_year_id)
  values (v_teacher, v_id, v_subject, v_year) on conflict do nothing;

  -- schedule: replace from today
  if p ? 'schedule' then
    if exists (select 1 from jsonb_array_elements(p->'schedule') s2
               join timetable_slots ts on ts.teacher_id = v_teacher and ts.effective_to is null and ts.class_id <> v_id
                 and ts.day_of_week = (s2->>'day')::smallint and ts.period = (s2->>'period')::smallint) then
      raise exception 'teacher_busy' using errcode = '22023';
    end if;
    delete from timetable_slots where class_id = v_id and effective_from >= current_date;
    update timetable_slots set effective_to = current_date - 1 where class_id = v_id and effective_to is null;
    insert into timetable_slots (class_id, day_of_week, period, subject_id, teacher_id, effective_from)
    select distinct v_id, (s2->>'day')::smallint, (s2->>'period')::smallint, v_subject, v_teacher, current_date
    from jsonb_array_elements(p->'schedule') s2;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'name_taken' using errcode = '22023';
end $$;

-- ---------------------------------------------------------------------------
-- Students of a group, everyone in the center (for "add to group"), enrolling
-- ---------------------------------------------------------------------------
create or replace function api.group_students(p_group uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_center uuid := app.center_or_fail();
begin
  if not exists (select 1 from classes where id = p_group and school_id = v_center) then raise exception 'not_found' using errcode = '22023'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('student_id', s.id, 'name', s.last_name || ' ' || s.first_name,
            'own_phone', ps.phone, 'enrolled_at', cm.enrolled_at,
            'parent', (select pp.first_name || ' ' || pp.last_name || coalesce(' · ' || pp.phone, '') from guardians g
                       join profiles pp on pp.user_id = g.parent_user_id where g.student_id = s.id order by g.is_primary desc limit 1))
          order by s.last_name, s.first_name)
    from class_members cm join students s on s.id = cm.student_id left join profiles ps on ps.user_id = s.user_id
    where cm.class_id = p_group and cm.status = 'active'), '[]'::jsonb);
end $$;

create or replace function api.center_students(p_q text default '')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_center uuid := app.center_or_fail(); v_q text := lower(btrim(coalesce(p_q, '')));
begin
  return coalesce((select jsonb_agg(x order by x->>'name') from (
    select jsonb_build_object('student_id', s.id, 'name', s.last_name || ' ' || s.first_name,
             'groups', (select coalesce(jsonb_agg(c.label order by c.label), '[]'::jsonb) from class_members cm
                        join classes c on c.id = cm.class_id where cm.student_id = s.id and cm.status = 'active')) as x
    from students s where s.school_id = v_center
      and (v_q = '' or lower(s.last_name || ' ' || s.first_name) like '%' || v_q || '%')
    limit 50) y), '[]'::jsonb);
end $$;

create or replace function api.set_enrollment(p_group uuid, p_student uuid, p_active boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_center uuid := app.center_or_fail(); v_cap smallint;
begin
  select capacity into v_cap from classes where id = p_group and school_id = v_center and name is not null and not archived;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  if not exists (select 1 from students where id = p_student and school_id = v_center) then raise exception 'not_found' using errcode = '22023'; end if;
  if p_active then
    if v_cap is not null and (select count(*) from class_members where class_id = p_group and status = 'active' and student_id <> p_student) >= v_cap then
      raise exception 'group_full' using errcode = '22023';
    end if;
    insert into class_members (class_id, student_id) values (p_group, p_student)
    on conflict (class_id, student_id) do update set status = 'active', enrolled_at = current_date;
  else
    update class_members set status = 'left' where class_id = p_group and student_id = p_student and status = 'active';
  end if;
  insert into audit_log (user_id, school_id, table_name, row_id, action, new_value)
  values (auth.uid(), v_center, 'class_members', p_group::text, case when p_active then 'enroll' else 'leave' end,
          jsonb_build_object('student_id', p_student));
end $$;

revoke execute on function app.my_center(), api.center_groups(), api.center_options(), api.save_group(jsonb),
  api.group_students(uuid), api.center_students(text), api.set_enrollment(uuid, uuid, boolean) from public;
grant execute on function app.my_center(), app.center_or_fail(), api.center_groups(), api.center_options(), api.save_group(jsonb),
  api.group_students(uuid), api.center_students(text), api.set_enrollment(uuid, uuid, boolean) to authenticated;
