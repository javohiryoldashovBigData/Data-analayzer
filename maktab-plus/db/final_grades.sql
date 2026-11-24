-- ============================================================================
-- MAKTAB+ — step 6: quarter grades and yearly (final) grades
-- Load after school_api.sql. api.* = SECURITY INVOKER (RLS decides),
-- app.* helpers = SECURITY DEFINER.
--
-- Decisions (user, Nov 2026):
--   * the subject teacher sets QUARTER grades; the system only SUGGESTS
--     (rounded average of current grades, needs at least 3 grades);
--   * YEARLY grades: the teacher PROPOSES, the zavuch or director CONFIRMS.
--     Only a confirmed yearly grade becomes a real grade (grade_type 'final')
--     and only then do parents and students see it;
--   * a grade 1+ point away from the suggestion needs a short reason
--     (fairness, and the zavuch can see why) — it never blocks the teacher;
--   * no rankings anywhere.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------
-- app.class_school(class) comes from schema.sql (not redefined here)

-- suggested grade from an average: normal rounding (3.5 → 4), 1..5
create or replace function app.suggest_grade(p_avg numeric)
returns smallint language sql immutable as $$
  select case when p_avg is null then null else least(5, greatest(1, round(p_avg)))::smallint end
$$;

-- the caller may work on this class + subject: its teacher, or school leadership
create or replace function app.can_grade_sheet(p_class_id uuid, p_subject_id smallint)
returns boolean language sql stable security definer set search_path = public as $$
  select app.teaches_class(p_class_id, p_subject_id) or app.manages_school(app.class_school(p_class_id))
$$;

create or replace function app.in_class(p_class_id uuid, p_student_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from class_members cm where cm.class_id = p_class_id
                 and cm.student_id = p_student_id and cm.status = 'active')
$$;

-- yearly suggestion: rounded average of this year's quarter (+ exam) grades
create or replace function app.year_suggestion(p_student_id uuid, p_subject_id smallint, p_year smallint)
returns smallint language sql stable security definer set search_path = public as $$
  select app.suggest_grade(avg(g.value)) from grades g join terms t on t.id = g.term_id
  where g.student_id = p_student_id and g.subject_id = p_subject_id and g.grade_type in ('quarter','exam')
    and g.deleted_at is null and t.academic_year_id = p_year
$$;

-- ---------------------------------------------------------------------------
-- 1. Window for yearly grades (opened and closed by the zavuch / director)
-- ---------------------------------------------------------------------------
create table if not exists final_grade_windows (
  school_id        uuid not null references schools(id) on delete cascade,
  academic_year_id smallint not null references academic_years(id) on delete cascade,
  opened_by        uuid references auth.users(id),
  opened_at        timestamptz not null default now(),
  closed_at        timestamptz,
  primary key (school_id, academic_year_id)
);
alter table final_grade_windows enable row level security;
drop policy if exists fgw_read on final_grade_windows;
create policy fgw_read on final_grade_windows for select to authenticated using (app.is_staff_at(school_id));
drop policy if exists fgw_write on final_grade_windows;
create policy fgw_write on final_grade_windows for all to authenticated
  using (app.manages_school(school_id)) with check (app.manages_school(school_id) and opened_by = auth.uid());
grant select, insert, update on final_grade_windows to authenticated;

create or replace function app.final_window_open(p_school_id uuid, p_year smallint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from final_grade_windows w
                 where w.school_id = p_school_id and w.academic_year_id = p_year and w.closed_at is null)
$$;

-- ---------------------------------------------------------------------------
-- 2. Yearly grade proposals (teacher proposes → leadership confirms)
-- ---------------------------------------------------------------------------
create table if not exists final_grade_proposals (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references schools(id) on delete cascade,
  academic_year_id smallint not null references academic_years(id),
  class_id         uuid not null references classes(id) on delete cascade,
  subject_id       smallint not null references subjects(id),
  student_id       uuid not null references students(id) on delete cascade,
  teacher_id       uuid not null references teachers(id),
  suggested        smallint check (suggested between 1 and 5),
  proposed         smallint not null check (proposed between 1 and 5),
  note             text check (length(note) <= 500),
  status           text not null default 'proposed' check (status in ('proposed','confirmed')),
  confirmed_value  smallint check (confirmed_value between 1 and 5),
  change_reason    text check (length(change_reason) <= 500),
  confirmed_by     uuid references auth.users(id),
  confirmed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (student_id, subject_id, academic_year_id)
);
create index if not exists fgp_class_idx on final_grade_proposals(class_id, subject_id);
alter table final_grade_proposals enable row level security;

-- read: the subject teacher (own proposals) and school leadership.
-- Parents and students never see proposals — only confirmed grades.
drop policy if exists fgp_select on final_grade_proposals;
create policy fgp_select on final_grade_proposals for select to authenticated using (
  app.manages_school(school_id) or (teacher_id = app.my_teacher_id() and app.teaches_class(class_id, subject_id)));
-- teacher writes: only own class + subject, only while the window is open,
-- only as 'proposed', never the confirmation fields
drop policy if exists fgp_teacher_insert on final_grade_proposals;
create policy fgp_teacher_insert on final_grade_proposals for insert to authenticated with check (
  teacher_id = app.my_teacher_id() and app.teaches_class(class_id, subject_id)
  and school_id = app.class_school(class_id)
  and app.in_class(class_id, student_id)
  and app.final_window_open(school_id, academic_year_id)
  and status = 'proposed' and confirmed_value is null and confirmed_by is null and confirmed_at is null);
drop policy if exists fgp_teacher_update on final_grade_proposals;
create policy fgp_teacher_update on final_grade_proposals for update to authenticated
  using (teacher_id = app.my_teacher_id() and status = 'proposed' and app.teaches_class(class_id, subject_id))
  with check (teacher_id = app.my_teacher_id() and app.teaches_class(class_id, subject_id)
    and school_id = app.class_school(class_id) and app.in_class(class_id, student_id)
    and app.final_window_open(school_id, academic_year_id)
    and status = 'proposed' and confirmed_value is null and confirmed_by is null and confirmed_at is null);
-- leadership confirms (through api.confirm_final_grades)
drop policy if exists fgp_leader_update on final_grade_proposals;
create policy fgp_leader_update on final_grade_proposals for update to authenticated
  using (app.manages_school(school_id)) with check (app.manages_school(school_id) and school_id = app.class_school(class_id));
grant select, insert, update on final_grade_proposals to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Quarter grades (teacher)
-- ---------------------------------------------------------------------------
-- One sheet: every active student of the class with their current grades in
-- this quarter, the suggestion and the quarter grade already given.
create or replace function api.quarter_sheet(p_class_id uuid, p_subject_id smallint, p_term_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_term terms%rowtype;
begin
  if not app.can_grade_sheet(p_class_id, p_subject_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select t.* into v_term from terms t join classes c on c.academic_year_id = t.academic_year_id
   where c.id = p_class_id and (t.id = p_term_id or (p_term_id is null and t.is_current));
  if v_term.id is null then raise exception 'no_term' using errcode = '22023'; end if;
  return jsonb_build_object(
    'term', jsonb_build_object('id', v_term.id, 'number', v_term.number, 'start_date', v_term.start_date, 'end_date', v_term.end_date),
    'students', coalesce((select jsonb_agg(x order by x->>'last_name', x->>'first_name') from (
      select jsonb_build_object(
        'student_id', s.id, 'first_name', s.first_name, 'last_name', s.last_name,
        'count', count(g.id), 'avg', round(avg(g.value), 2),
        'suggested', case when count(g.id) >= 3 then app.suggest_grade(avg(g.value)) end,
        'quarter', (select q.value from grades q where q.student_id = s.id and q.subject_id = p_subject_id
                     and q.term_id = v_term.id and q.grade_type = 'quarter' and q.deleted_at is null
                     order by q.created_at desc limit 1),
        'note', (select q.comment from grades q where q.student_id = s.id and q.subject_id = p_subject_id
                     and q.term_id = v_term.id and q.grade_type = 'quarter' and q.deleted_at is null
                     order by q.created_at desc limit 1)) as x
      from class_members cm join students s on s.id = cm.student_id
      left join grades g on g.student_id = s.id and g.subject_id = p_subject_id and g.term_id = v_term.id
                        and g.grade_type = 'current' and g.deleted_at is null
      where cm.class_id = p_class_id and cm.status = 'active'
      group by s.id) y), '[]'::jsonb));
end $$;

-- Save quarter grades: p_rows = [{student_id, value, note}]. One quarter grade
-- per student/subject/term (a change updates it; the audit log keeps history).
create or replace function api.save_quarter_grades(p_class_id uuid, p_subject_id smallint, p_term_id uuid, p_rows jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare r jsonb; v_student uuid; v_val smallint; v_note text; v_sugg smallint; v_cnt int; v_avg numeric;
        v_existing bigint; v_saved int := 0; v_teacher uuid := app.my_teacher_id();
begin
  if v_teacher is null or not app.teaches_class(p_class_id, p_subject_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from terms t join classes c on c.academic_year_id = t.academic_year_id
                 where c.id = p_class_id and t.id = p_term_id) then
    raise exception 'no_term' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 60 then raise exception 'bad_rows' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_student := (r->>'student_id')::uuid;
    v_val := (r->>'value')::smallint;
    v_note := nullif(btrim(coalesce(r->>'note', '')), '');
    if v_val is null or v_val not between 1 and 5 then raise exception 'bad_value' using errcode = '22023'; end if;
    if not exists (select 1 from class_members cm where cm.class_id = p_class_id and cm.student_id = v_student and cm.status = 'active') then
      raise exception 'not_in_class' using errcode = '42501';
    end if;
    select count(*), avg(value) into v_cnt, v_avg from grades g
     where g.student_id = v_student and g.subject_id = p_subject_id and g.term_id = p_term_id
       and g.grade_type = 'current' and g.deleted_at is null;
    v_sugg := case when v_cnt >= 3 then app.suggest_grade(v_avg) end;
    -- fairness: far from the suggestion (or no suggestion) → say why
    if (v_sugg is null or abs(v_val - v_sugg) >= 1) and v_note is null then
      raise exception 'reason_required' using errcode = '22023', detail = v_student::text;
    end if;
    select id into v_existing from grades g where g.student_id = v_student and g.subject_id = p_subject_id
       and g.term_id = p_term_id and g.grade_type = 'quarter' and g.deleted_at is null
     order by created_at desc limit 1;
    if v_existing is null then
      insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, comment, created_by)
      values (v_student, p_subject_id, p_term_id, 'quarter', v_val, v_teacher, v_note, auth.uid());
    else
      update grades set value = v_val, comment = v_note, updated_at = now() where id = v_existing;
      if not found then raise exception 'not_allowed' using errcode = '42501'; end if;
    end if;
    v_saved := v_saved + 1;
  end loop;
  return jsonb_build_object('saved', v_saved);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Yearly grades
-- ---------------------------------------------------------------------------
-- Sheet: Q1..Q4 quarter grades (+ exam if any), suggestion, proposal, status.
create or replace function api.year_sheet(p_class_id uuid, p_subject_id smallint)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_year smallint; v_school uuid;
begin
  if not app.can_grade_sheet(p_class_id, p_subject_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select academic_year_id, school_id into v_year, v_school from classes where id = p_class_id;
  return jsonb_build_object(
    'window_open', app.final_window_open(v_school, v_year),
    'students', coalesce((select jsonb_agg(x order by x->>'last_name', x->>'first_name') from (
      select jsonb_build_object(
        'student_id', s.id, 'first_name', s.first_name, 'last_name', s.last_name,
        'quarters', q.quarters, 'exam', q.exam,
        'missing_quarters', 4 - jsonb_array_length(jsonb_path_query_array(q.quarters, '$[*] ? (@ != null)')),
        'suggested', app.suggest_grade(q.avg_all),
        'proposal', (select jsonb_build_object('proposed', p.proposed, 'note', p.note, 'status', p.status,
                       'confirmed_value', p.confirmed_value, 'change_reason', p.change_reason)
                     from final_grade_proposals p where p.student_id = s.id and p.subject_id = p_subject_id
                       and p.academic_year_id = v_year),
        'final', (select g.value from grades g where g.student_id = s.id and g.subject_id = p_subject_id
                    and g.grade_type = 'final' and g.deleted_at is null
                    and g.term_id in (select id from terms where academic_year_id = v_year)
                  order by g.created_at desc limit 1)) as x
      from class_members cm join students s on s.id = cm.student_id
      cross join lateral (
        select jsonb_agg(qv order by t.number) as quarters,
               (select max(g.value) from grades g join terms t2 on t2.id = g.term_id where g.student_id = s.id
                  and g.subject_id = p_subject_id and g.grade_type = 'exam' and g.deleted_at is null
                  and t2.academic_year_id = v_year) as exam,
               (select avg(v) from (
                  select g.value as v from grades g join terms t3 on t3.id = g.term_id where g.student_id = s.id
                    and g.subject_id = p_subject_id and g.grade_type in ('quarter','exam') and g.deleted_at is null
                    and t3.academic_year_id = v_year) z) as avg_all
        from terms t
        cross join lateral (select (select g.value from grades g where g.student_id = s.id and g.subject_id = p_subject_id
                                      and g.term_id = t.id and g.grade_type = 'quarter' and g.deleted_at is null
                                    order by g.created_at desc limit 1) as qv) qq
        where t.academic_year_id = v_year) q
      where cm.class_id = p_class_id and cm.status = 'active') y), '[]'::jsonb));
end $$;

-- Teacher proposes: p_rows = [{student_id, value, note}] (window must be open).
create or replace function api.propose_final_grades(p_class_id uuid, p_subject_id smallint, p_rows jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare r jsonb; v_year smallint; v_school uuid; v_student uuid; v_val smallint; v_note text; v_sugg smallint;
        v_teacher uuid := app.my_teacher_id(); v_n int := 0;
begin
  if v_teacher is null or not app.teaches_class(p_class_id, p_subject_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select academic_year_id, school_id into v_year, v_school from classes where id = p_class_id;
  if not app.final_window_open(v_school, v_year) then raise exception 'window_closed' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 60 then raise exception 'bad_rows' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_student := (r->>'student_id')::uuid; v_val := (r->>'value')::smallint;
    v_note := nullif(btrim(coalesce(r->>'note', '')), '');
    if v_val is null or v_val not between 1 and 5 then raise exception 'bad_value' using errcode = '22023'; end if;
    v_sugg := app.year_suggestion(v_student, p_subject_id, v_year);
    if (v_sugg is null or abs(v_val - v_sugg) >= 1) and v_note is null then
      raise exception 'reason_required' using errcode = '22023', detail = v_student::text;
    end if;
    if exists (select 1 from final_grade_proposals p where p.student_id = v_student and p.subject_id = p_subject_id
                 and p.academic_year_id = v_year and p.status = 'confirmed') then
      raise exception 'already_confirmed' using errcode = '22023';
    end if;
    insert into final_grade_proposals (school_id, academic_year_id, class_id, subject_id, student_id, teacher_id, suggested, proposed, note)
    values (v_school, v_year, p_class_id, p_subject_id, v_student, v_teacher, v_sugg, v_val, v_note)
    on conflict (student_id, subject_id, academic_year_id) do update
      set proposed = excluded.proposed, note = excluded.note, suggested = excluded.suggested,
          teacher_id = excluded.teacher_id, updated_at = now()
      where final_grade_proposals.status = 'proposed';
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('proposed', v_n);
end $$;

-- Leadership: open / close the yearly-grades window for the current year.
create or replace function api.set_final_window(p_open boolean)
returns jsonb language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_school uuid; v_year smallint;
begin
  select r.school_id into v_school from user_school_roles r
   where r.user_id = auth.uid() and r.is_active and r.role in ('school_admin','director','zavuch') limit 1;
  if v_school is null or not app.manages_school(v_school) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select id into v_year from academic_years where is_current;
  if p_open then
    insert into final_grade_windows (school_id, academic_year_id, opened_by) values (v_school, v_year, auth.uid())
    on conflict (school_id, academic_year_id) do update set closed_at = null, opened_by = auth.uid(), opened_at = now();
  else
    update final_grade_windows set closed_at = now() where school_id = v_school and academic_year_id = v_year;
  end if;
  return jsonb_build_object('open', app.final_window_open(v_school, v_year));
end $$;

-- Leadership overview: per class + subject, quarter grades done this quarter,
-- yearly proposals and confirmations, and how many need a look.
create or replace function api.grades_overview()
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_school uuid; v_year smallint; v_term uuid; v_tnum smallint;
begin
  select r.school_id into v_school from user_school_roles r
   where r.user_id = auth.uid() and r.is_active and r.role in ('school_admin','director','zavuch') limit 1;
  if v_school is null or not app.manages_school(v_school) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select id into v_year from academic_years where is_current;
  select id, number into v_term, v_tnum from terms where academic_year_id = v_year and is_current;
  return jsonb_build_object(
    'window_open', app.final_window_open(v_school, v_year),
    'term_number', v_tnum,
    'rows', coalesce((select jsonb_agg(x order by x->>'grade_level', x->>'class', x->>'subject') from (
      select jsonb_build_object(
        'class_id', c.id, 'class', c.grade_level || '-' || c.letter, 'grade_level', lpad(c.grade_level::text, 2, '0'),
        'subject_id', ta.subject_id, 'subject', sub.name_uz,
        'teacher', p.first_name || ' ' || p.last_name,
        'students', st.n,
        'quarter_done', (select count(distinct g.student_id) from grades g join class_members cm on cm.student_id = g.student_id
                           and cm.class_id = c.id and cm.status = 'active'
                         where g.subject_id = ta.subject_id and g.term_id = v_term and g.grade_type = 'quarter' and g.deleted_at is null),
        'proposed', (select count(*) from final_grade_proposals f where f.class_id = c.id and f.subject_id = ta.subject_id and f.academic_year_id = v_year),
        'confirmed', (select count(*) from final_grade_proposals f where f.class_id = c.id and f.subject_id = ta.subject_id
                        and f.academic_year_id = v_year and f.status = 'confirmed'),
        'to_check', (select count(*) from final_grade_proposals f where f.class_id = c.id and f.subject_id = ta.subject_id
                        and f.academic_year_id = v_year and f.status = 'proposed'
                        and (f.note is not null or f.proposed is distinct from
                             app.year_suggestion(f.student_id, f.subject_id, v_year)))) as x
      from classes c
      join teacher_assignments ta on ta.class_id = c.id
      join subjects sub on sub.id = ta.subject_id
      join teachers t on t.id = ta.teacher_id
      join profiles p on p.user_id = t.user_id
      cross join lateral (select count(*) as n from class_members cm where cm.class_id = c.id and cm.status = 'active') st
      where c.school_id = v_school and c.academic_year_id = v_year) y), '[]'::jsonb));
end $$;

-- Notice to students + parents of a class after their yearly grades are
-- confirmed. DEFINER (the outbox is closed to users), so it is guarded: only
-- school leadership, and only right after THEY confirmed this class + subject.
create or replace function app.notify_final_confirmed(p_class_id uuid, p_subject_id smallint)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not app.manages_school(app.class_school(p_class_id)) or not exists (
       select 1 from final_grade_proposals f where f.class_id = p_class_id and f.subject_id = p_subject_id
         and f.status = 'confirmed' and f.confirmed_by = auth.uid() and f.confirmed_at > now() - interval '1 minute') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into notification_outbox (recipient_id, payload)
  select distinct u, jsonb_build_object('kind', 'system', 'event', 'final_grades_confirmed', 'subject_id', p_subject_id)
  from (select s.user_id as u from students s join class_members cm on cm.student_id = s.id
         where cm.class_id = p_class_id and cm.status = 'active' and s.user_id is not null
        union
        select g.parent_user_id from guardians g join class_members cm on cm.student_id = g.student_id
         where cm.class_id = p_class_id and cm.status = 'active') x;
end $$;
revoke execute on function app.notify_final_confirmed(uuid, smallint) from public;
grant execute on function app.notify_final_confirmed(uuid, smallint) to authenticated;

-- Leadership confirms a whole class + subject. p_changes = [{student_id, value, reason}]
-- for grades the zavuch changes (a reason is required). Every active student
-- must have a proposal first. Writes real 'final' grades (audited) and tells
-- parents and students.
create or replace function api.confirm_final_grades(p_class_id uuid, p_subject_id smallint, p_changes jsonb default '[]')
returns jsonb language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_year smallint; v_school uuid; v_term uuid; v_missing int; c jsonb; v_n int := 0; v_row record;
begin
  select academic_year_id, school_id into v_year, v_school from classes where id = p_class_id;
  if v_school is null or not app.manages_school(v_school) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select id into v_term from terms where academic_year_id = v_year order by number desc limit 1;   -- yearly grade lives in the last quarter
  select count(*) into v_missing from class_members cm where cm.class_id = p_class_id and cm.status = 'active'
     and not exists (select 1 from final_grade_proposals f where f.student_id = cm.student_id
                     and f.subject_id = p_subject_id and f.academic_year_id = v_year);
  if v_missing > 0 then raise exception 'proposals_missing' using errcode = '22023', detail = v_missing::text; end if;
  if jsonb_typeof(coalesce(p_changes, '[]')) <> 'array' then raise exception 'bad_rows' using errcode = '22023'; end if;
  for c in select * from jsonb_array_elements(coalesce(p_changes, '[]')) loop
    if (c->>'value')::smallint not between 1 and 5 then raise exception 'bad_value' using errcode = '22023'; end if;
    if nullif(btrim(coalesce(c->>'reason', '')), '') is null then raise exception 'reason_required' using errcode = '22023'; end if;
    update final_grade_proposals set confirmed_value = (c->>'value')::smallint, change_reason = btrim(c->>'reason')
     where class_id = p_class_id and subject_id = p_subject_id and academic_year_id = v_year
       and student_id = (c->>'student_id')::uuid and status = 'proposed';
    if not found then raise exception 'not_found' using errcode = '22023'; end if;
  end loop;
  for v_row in update final_grade_proposals
             set status = 'confirmed', confirmed_value = coalesce(confirmed_value, proposed),
                 confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now()
           where class_id = p_class_id and subject_id = p_subject_id and academic_year_id = v_year and status = 'proposed'
           returning * loop
    insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, comment, created_by)
    values (v_row.student_id, v_row.subject_id, v_term, 'final', v_row.confirmed_value, v_row.teacher_id, v_row.change_reason, auth.uid());
    v_n := v_n + 1;
  end loop;
  -- tell students and parents (a normal notice; quiet hours apply)
  if v_n > 0 then perform app.notify_final_confirmed(p_class_id, p_subject_id); end if;
  return jsonb_build_object('confirmed', v_n);
end $$;

-- Parent / student: quarter and confirmed yearly grades of one child.
create or replace function api.report_card(p_student_id uuid)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('subject_id', sub.id, 'subject', sub.name_uz,
            'quarters', (select jsonb_agg((select g.value from grades g where g.student_id = p_student_id
                                 and g.subject_id = sub.id and g.term_id = t.id and g.grade_type = 'quarter'
                                 and g.deleted_at is null order by g.created_at desc limit 1) order by t.number)
                         from terms t join academic_years y on y.id = t.academic_year_id and y.is_current),
            'final', (select g.value from grades g join terms t on t.id = g.term_id
                        join academic_years y on y.id = t.academic_year_id and y.is_current
                      where g.student_id = p_student_id and g.subject_id = sub.id and g.grade_type = 'final'
                        and g.deleted_at is null order by g.created_at desc limit 1))
          order by sub.name_uz), '[]'::jsonb)
  from subjects sub
  where app.can_see_student(p_student_id)
    and exists (select 1 from class_members cm join teacher_assignments ta on ta.class_id = cm.class_id
                where cm.student_id = p_student_id and cm.status = 'active' and ta.subject_id = sub.id)
$$;

revoke execute on function api.quarter_sheet(uuid, smallint, uuid), api.save_quarter_grades(uuid, smallint, uuid, jsonb),
  api.year_sheet(uuid, smallint), api.propose_final_grades(uuid, smallint, jsonb), api.set_final_window(boolean),
  api.grades_overview(), api.confirm_final_grades(uuid, smallint, jsonb), api.report_card(uuid) from public;
grant execute on function api.quarter_sheet(uuid, smallint, uuid), api.save_quarter_grades(uuid, smallint, uuid, jsonb),
  api.year_sheet(uuid, smallint), api.propose_final_grades(uuid, smallint, jsonb), api.set_final_window(boolean),
  api.grades_overview(), api.confirm_final_grades(uuid, smallint, jsonb), api.report_card(uuid) to authenticated;
grant execute on function app.in_class(uuid, uuid), app.year_suggestion(uuid, smallint, smallint), app.suggest_grade(numeric), app.can_grade_sheet(uuid, smallint),
  app.final_window_open(uuid, smallint) to authenticated;
