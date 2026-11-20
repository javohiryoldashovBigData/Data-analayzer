-- ============================================================================
-- MAKTAB+ — Phase 1 "teacher's day" API layer
-- Designed by Perplexity (15 Nov 2026); wired to v3 and TESTED by Claude
-- (changes marked "V3.1:"; tests in test_api.sql).
--
-- Load AFTER schema.sql (and seed.sql for tests).
--
-- Principle: the client calls these RPCs through PostgREST with the user's
-- JWT. Functions in schema `api` are SECURITY INVOKER, so every read/write
-- inside them is still filtered by the RLS policies in schema.sql.
-- "All permission logic stays in the database."
--
-- Only the AI bookkeeping functions (app.ai_reserve / ai_commit / ai_release /
-- ai_store_lesson_cards) are SECURITY DEFINER, with explicit checks, and the
-- last three are callable by the service role only.
-- ============================================================================

create schema if not exists api;
revoke all on schema api from public;
grant usage on schema api to authenticated;
alter default privileges in schema api revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- New tables
-- ---------------------------------------------------------------------------

-- Exit check: 3 questions; teacher records with a show of hands (rule 2:
-- no student phones). Per-student "didn't get it" taps are optional.
create table exit_checks (
  card_id      uuid primary key references lesson_cards(id) on delete cascade,
  school_id    uuid not null references schools(id) on delete cascade,
  questions    jsonb not null default '[]'::jsonb,   -- ["q1","q2","q3"]
  results      jsonb,                                -- [{"q":1,"got_it":21,"total":27},…]
  not_got      uuid[] not null default '{}',         -- student ids (optional taps)
  recorded_by  uuid references auth.users(id),
  recorded_at  timestamptz
);

-- "After lesson" completion marker (one per card).
create table lesson_reports (
  card_id      uuid primary key references lesson_cards(id) on delete cascade,
  school_id    uuid not null references schools(id) on delete cascade,
  teacher_id   uuid not null references teachers(id) on delete cascade,
  lesson_date  date not null,
  note         text,                                  -- private to the teacher
  completed_at timestamptz not null default now()
);

-- "Finished for today".
create table teacher_day_closures (
  teacher_id  uuid not null references teachers(id) on delete cascade,
  day         date not null,
  school_id   uuid not null references schools(id) on delete cascade,
  open_items  jsonb not null default '[]'::jsonb,     -- carried over, not blocking
  closed_at   timestamptz not null default now(),
  primary key (teacher_id, day)
);

-- Idempotency for offline-first clients: every write RPC takes a client_op_id.
create table api_ops (
  client_op_id uuid primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  op           text not null,
  result       jsonb,
  created_at   timestamptz not null default now()
);

-- AI budget reservations: reserve → call model → commit/release.
create type ai_res_status as enum ('pending','committed','released');
create table ai_reservations (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  feature     text not null,
  est_cents   numeric(10,2) not null check (est_cents >= 0),
  status      ai_res_status not null default 'pending',
  batch_id    text,                                  -- Anthropic batch id
  payload     jsonb,                                 -- lessons requested
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '26 hours'  -- batch max 24h + slack
);
create index ai_res_pending_idx on ai_reservations(school_id, user_id) where status = 'pending';

alter table exit_checks          enable row level security;
alter table lesson_reports       enable row level security;
alter table teacher_day_closures enable row level security;
alter table api_ops              enable row level security;
alter table ai_reservations      enable row level security;

-- school_id is ALWAYS derived, never trusted from the client (attack A10).
create or replace function app.fill_school_from_card()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.school_id := (select c.school_id from lesson_cards lc join classes c on c.id = lc.class_id
                    where lc.id = new.card_id);
  return new;
end $$;
create trigger exit_checks_school    before insert or update on exit_checks
  for each row execute function app.fill_school_from_card();
create trigger lesson_reports_school before insert or update on lesson_reports
  for each row execute function app.fill_school_from_card();

-- Policies: the card's own teacher writes; school leadership reads.
create policy exit_rw on exit_checks for all to authenticated
  using (exists (select 1 from lesson_cards lc where lc.id = exit_checks.card_id
                 and lc.teacher_id = app.my_teacher_id()))
  with check (exists (select 1 from lesson_cards lc where lc.id = exit_checks.card_id
                      and lc.teacher_id = app.my_teacher_id()));
create policy exit_lead_read on exit_checks for select to authenticated
  using (app.manages_school(exit_checks.school_id));

create policy reports_rw on lesson_reports for all to authenticated
  using (lesson_reports.teacher_id = app.my_teacher_id())
  with check (lesson_reports.teacher_id = app.my_teacher_id()
              and exists (select 1 from lesson_cards lc where lc.id = lesson_reports.card_id
                          and lc.teacher_id = app.my_teacher_id()));
create policy reports_lead_read on lesson_reports for select to authenticated
  using (app.manages_school(lesson_reports.school_id));

create policy closures_rw on teacher_day_closures for all to authenticated
  using (teacher_day_closures.teacher_id = app.my_teacher_id())
  with check (teacher_day_closures.teacher_id = app.my_teacher_id()
              and teacher_day_closures.school_id =
                  (select t.school_id from teachers t where t.id = app.my_teacher_id()));
create policy closures_lead_read on teacher_day_closures for select to authenticated
  using (app.manages_school(teacher_day_closures.school_id));

create policy ops_self on api_ops for all to authenticated
  using (api_ops.user_id = auth.uid()) with check (api_ops.user_id = auth.uid());

create policy res_self_read on ai_reservations for select to authenticated
  using (ai_reservations.user_id = auth.uid());
-- no write policy: only app.ai_* functions write reservations.

grant select, insert, update on exit_checks, lesson_reports, teacher_day_closures, api_ops to authenticated;
grant select on ai_reservations to authenticated;

-- ---------------------------------------------------------------------------
-- Internal: my lessons on a date (timetable minus my substitutions-away,
-- plus lessons I substitute). SECURITY INVOKER → RLS on timetable applies.
-- ---------------------------------------------------------------------------
create or replace function api.my_lessons(p_date date)
returns table (class_id uuid, subject_id smallint, period smallint,
               room_id uuid, is_substitution boolean)
language sql stable security invoker set search_path = public, pg_temp as $$
  select ts.class_id, ts.subject_id, ts.period, ts.room_id, false
  from timetable_slots ts
  where ts.teacher_id = app.my_teacher_id()
    and ts.day_of_week = extract(isodow from p_date)::smallint
    and ts.effective_from <= p_date
    and (ts.effective_to is null or ts.effective_to >= p_date)
    and not exists (select 1 from substitutions s
                    where s.date = p_date and s.period = ts.period
                      and s.class_id = ts.class_id
                      and s.absent_teacher_id = app.my_teacher_id())
  union all
  select s.class_id, s.subject_id, s.period, null::uuid, true
  from substitutions s
  where s.date = p_date and s.substitute_teacher_id = app.my_teacher_id()
$$;

-- ---------------------------------------------------------------------------
-- "Who to ask first" (V3.1: moved above my_day, which calls it) — our own code, no AI (rule 7). Private to the teacher:
-- runs as invoker, so only a teacher of the class gets rows back.
-- Score (estimate weights — tune in pilot):
--   +3 didn't get last exit check   +2 each absence last 14 days (max 6)
--   +2 average of last 3 grades < 3.5   +1 no grade in this subject for 14 days
-- ---------------------------------------------------------------------------
create or replace function api.ask_first(p_class_id uuid, p_subject_id smallint, p_n int default 3)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  with roster as (
    select cm.student_id from class_members cm
    where cm.class_id = p_class_id and cm.status = 'active'
      and (app.teaches_class(p_class_id, p_subject_id) or app.is_class_teacher_of_class(p_class_id))
  ),
  last_exit as (
    select ec.not_got from exit_checks ec join lesson_cards lc on lc.id = ec.card_id
    where lc.class_id = p_class_id and lc.subject_id = p_subject_id and ec.recorded_at is not null
    order by ec.recorded_at desc limit 1
  ),
  scored as (
    select r.student_id,
      (case when r.student_id = any (coalesce((select not_got from last_exit), '{}')) then 3 else 0 end)
      + least(6, 2 * (select count(*) from attendance_logs a
                      where a.student_id = r.student_id and a.status = 'absent'
                        and a.date >= current_date - 14))
      + (case when (select avg(g.value) from (select g2.value from grades g2
                     where g2.student_id = r.student_id and g2.subject_id = p_subject_id
                       and g2.deleted_at is null order by g2.created_at desc limit 3) g) < 3.5
              then 2 else 0 end)
      + (case when not exists (select 1 from grades g3 where g3.student_id = r.student_id
                               and g3.subject_id = p_subject_id and g3.deleted_at is null
                               and g3.created_at >= now() - interval '14 days') then 1 else 0 end)
      as score
    from roster r
  )
  select coalesce(jsonb_agg(jsonb_build_object('student_id', s.student_id,
                     'name', st.first_name || ' ' || left(st.last_name, 1) || '.',
                     'score', s.score) order by s.score desc), '[]'::jsonb)
  from (select * from scored where score > 0 order by score desc limit p_n) s
  join students st on st.id = s.student_id
$$;

-- ---------------------------------------------------------------------------
-- 1. "My day"  —  GET /rest/v1/rpc/my_day?p_date=2026-11-16
-- One round trip for the whole screen (fast on a weak school network).
-- ---------------------------------------------------------------------------
create or replace function api.my_day(p_date date default current_date)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'date', p_date,
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'period',      l.period,
        'start',       bp.start_time,
        'end',         bp.end_time,
        'class_id',    l.class_id,
        'class',       c.grade_level || '-' || c.letter,
        'subject_id',  l.subject_id,
        'subject',     sub.name_uz,
        'room_id',     l.room_id,
        'substitution', l.is_substitution,
        'card',        (select jsonb_build_object('id', lc.id, 'status', lc.status, 'topic', lc.topic,
                                                  'ai_generated', lc.ai_generated)
                        from lesson_cards lc
                        where lc.class_id = l.class_id and lc.lesson_date = p_date
                          and lc.period = l.period limit 1),
        'attendance_done', exists (select 1 from attendance_logs a
                                   where a.class_id = l.class_id and a.date = p_date
                                     and a.period = l.period),
        'lesson_done', exists (select 1 from lesson_reports r join lesson_cards lc on lc.id = r.card_id
                               where lc.class_id = l.class_id and lc.lesson_date = p_date
                                 and lc.period = l.period),
        'ask_first',   api.ask_first(l.class_id, l.subject_id, 3)
      ) order by l.period)
      from api.my_lessons(p_date) l
      join classes c   on c.id = l.class_id
      join subjects sub on sub.id = l.subject_id
      left join bell_periods bp on bp.school_id = c.school_id and bp.number = l.period
    ), '[]'::jsonb),
    'absence_reports_pending', (
      select count(*) from parent_absence_reports par
      join classes c on c.class_teacher_id = app.my_teacher_id()
      join class_members cm on cm.class_id = c.id and cm.student_id = par.student_id
                            and cm.status = 'active'
      where par.status = 'pending' and par.absence_date >= p_date),
    'closed', exists (select 1 from teacher_day_closures d
                      where d.teacher_id = app.my_teacher_id() and d.day = p_date)
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. Lesson card: open (get or create draft) and save.
-- ---------------------------------------------------------------------------
create or replace function api.open_lesson_card(p_class_id uuid, p_subject_id smallint,
                                                p_date date, p_period smallint)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  select lc.id into v_id from lesson_cards lc
   where lc.class_id = p_class_id and lc.lesson_date = p_date and lc.period = p_period
   limit 1;
  if v_id is null then
    insert into lesson_cards (school_id, class_id, subject_id, teacher_id, lesson_date, period)
    values ((select c.school_id from classes c where c.id = p_class_id),
            p_class_id, p_subject_id, app.my_teacher_id(), p_date, p_period)
    returning id into v_id;                       -- RLS cards_insert decides
  end if;
  return (select jsonb_build_object(
            'card', to_jsonb(lc),
            'exit_check', (select to_jsonb(ec) from exit_checks ec where ec.card_id = lc.id),
            'ask_first', api.ask_first(lc.class_id, lc.subject_id, 3))
          from lesson_cards lc where lc.id = v_id);
end $$;

-- Teacher edits/approves the card. Approving an AI draft = "people decide".
create or replace function api.save_lesson_card(p_card_id uuid, p_patch jsonb, p_approve boolean default false)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  update lesson_cards lc set
    topic     = coalesce(p_patch->>'topic', lc.topic),
    plan      = coalesce(p_patch->>'plan', lc.plan),
    questions = coalesce(p_patch->'questions', lc.questions),
    homework  = coalesce(p_patch->>'homework', lc.homework),
    materials = coalesce(p_patch->'materials', lc.materials),
    status    = case when p_approve then 'approved'::card_status else lc.status end,
    approved_by = case when p_approve then auth.uid() else lc.approved_by end,
    approved_at = case when p_approve then now() else lc.approved_at end
  where lc.id = p_card_id;
  if not found then raise exception 'card_not_found_or_denied' using errcode = '42501'; end if;

  if p_patch ? 'exit_questions' then
    insert into exit_checks (card_id, school_id, questions)
    values (p_card_id, '00000000-0000-0000-0000-000000000000', p_patch->'exit_questions') -- school_id overwritten by trigger
    on conflict (card_id) do update set questions = excluded.questions;
  end if;
  return (select to_jsonb(lc) from lesson_cards lc where lc.id = p_card_id);
end $$;

-- ---------------------------------------------------------------------------
-- 3. "After lesson" — one call, one transaction, idempotent (offline queue).
-- p := {
--   "client_op_id": uuid,
--   "absent": [student_id…], "late": [student_id…],   -- everyone else = present
--   "topic": "Kasrlarni qo'shish",
--   "homework": {"description": "...", "due_date": "2026-11-18"},
--   "grades": [{"student_id": "...", "value": 5, "comment": "Keyingi qadam: ..."}],
--   "exit": {"results": [{"q":1,"got_it":21,"total":27}], "not_got": [student_id…]},
--   "note": "private note"
-- }
-- ---------------------------------------------------------------------------
create or replace function api.finish_lesson(p_card_id uuid, p jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_card   lesson_cards%rowtype;
  v_op     uuid := (p->>'client_op_id')::uuid;
  v_prev   jsonb;
  v_term   uuid;
  v_result jsonb;
  g        jsonb;
begin
  if v_op is null then raise exception 'client_op_id required' using errcode = '22023'; end if;
  -- V3.2: two copies of the same save arriving at the same moment (offline
  -- queue + reconnect) wait for each other; the second then returns the
  -- first one's result instead of failing on the api_ops primary key.
  perform pg_advisory_xact_lock(hashtextextended('finish_lesson:' || v_op::text, 0));
  select a.result into v_prev from api_ops a where a.client_op_id = v_op;
  if found then return v_prev; end if;           -- retry from offline queue

  select * into v_card from lesson_cards lc
   where lc.id = p_card_id and lc.teacher_id = app.my_teacher_id();
  if not found then raise exception 'card_not_found_or_denied' using errcode = '42501'; end if;

  -- attendance for the whole roster (RLS attendance_insert/update decide)
  insert into attendance_logs (student_id, class_id, date, period, subject_id, teacher_id, status, marked_by)
  select cm.student_id, v_card.class_id, v_card.lesson_date, v_card.period, v_card.subject_id,
         v_card.teacher_id,
         case when cm.student_id::text in (select jsonb_array_elements_text(coalesce(p->'absent','[]'))) then 'absent'
              when cm.student_id::text in (select jsonb_array_elements_text(coalesce(p->'late','[]')))   then 'late'
              else 'present' end::attendance_status,
         auth.uid()
  from class_members cm
  where cm.class_id = v_card.class_id and cm.status = 'active'
  on conflict (student_id, date, period) do update
    set status = excluded.status, marked_by = excluded.marked_by, marked_at = now();

  if p ? 'topic' then
    update lesson_cards set topic = p->>'topic' where id = v_card.id;
  end if;

  if p->'homework'->>'description' is not null then
    insert into homework (class_id, subject_id, teacher_id, assigned_at, due_date, description)
    values (v_card.class_id, v_card.subject_id, v_card.teacher_id, v_card.lesson_date,
            coalesce((p->'homework'->>'due_date')::date, v_card.lesson_date + 1),  -- V3.1: default next day
            p->'homework'->>'description');
  end if;

  select t.id into v_term from terms t join classes c on c.academic_year_id = t.academic_year_id
   where c.id = v_card.class_id and v_card.lesson_date between t.start_date and t.end_date;
  if v_term is null and jsonb_array_length(coalesce(p->'grades','[]')) > 0 then   -- V3.1: clear error
    raise exception 'no_term_for_date' using errcode = '22023';
  end if;
  for g in select * from jsonb_array_elements(coalesce(p->'grades','[]')) loop
    insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, comment, created_by)
    values ((g->>'student_id')::uuid, v_card.subject_id, v_term, 'current',
            (g->>'value')::smallint, v_card.teacher_id, g->>'comment', auth.uid());
  end loop;

  if p ? 'exit' then
    insert into exit_checks (card_id, school_id, results, not_got, recorded_by, recorded_at)
    values (v_card.id, v_card.school_id, p->'exit'->'results',
            coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'exit'->'not_got') x), '{}'),
            auth.uid(), now())
    on conflict (card_id) do update
      set results = excluded.results, not_got = excluded.not_got,
          recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at;
  end if;

  insert into lesson_reports (card_id, school_id, teacher_id, lesson_date, note)
  values (v_card.id, v_card.school_id, v_card.teacher_id, v_card.lesson_date, p->>'note')
  on conflict (card_id) do update set note = excluded.note, completed_at = now();

  v_result := jsonb_build_object('ok', true, 'card_id', v_card.id,
                                 'next', api.my_day(v_card.lesson_date)->'lessons');
  insert into api_ops (client_op_id, user_id, op, result)
  values (v_op, auth.uid(), 'finish_lesson', v_result);
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- 4. "Finished for today" — checklist + close. Never blocks (rule 3):
-- open items are carried over and shown tomorrow morning, not at 21:00.
-- ---------------------------------------------------------------------------
create or replace function api.day_checklist(p_date date default current_date)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  with l as (select * from api.my_lessons(p_date)),
  items as (
    select 'attendance' as kind, l.class_id, l.period,
           exists (select 1 from attendance_logs a where a.class_id = l.class_id
                   and a.date = p_date and a.period = l.period) as ok
    from l
    union all
    select 'topic', l.class_id, l.period,
           exists (select 1 from lesson_cards lc where lc.class_id = l.class_id
                   and lc.lesson_date = p_date and lc.period = l.period and lc.topic is not null)
    from l
    union all
    select 'after_lesson', l.class_id, l.period,
           exists (select 1 from lesson_reports r join lesson_cards lc on lc.id = r.card_id
                   where lc.class_id = l.class_id and lc.lesson_date = p_date and lc.period = l.period)
    from l
    union all
    select 'tomorrow_cards', null::uuid, null::smallint,
           (select count(*) from api.my_lessons(p_date + 1) t
             where exists (select 1 from lesson_cards lc where lc.class_id = t.class_id
                           and lc.lesson_date = p_date + 1 and lc.period = t.period))
           = (select count(*) from api.my_lessons(p_date + 1))
  )
  select jsonb_build_object(
    'date', p_date,
    'done', (select count(*) from items where ok),
    'total', (select count(*) from items),
    'items', coalesce((select jsonb_agg(to_jsonb(items)) from items), '[]'::jsonb))
$$;

create or replace function api.close_day(p_date date default current_date, p_client_op_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_list jsonb := api.day_checklist(p_date);
begin
  insert into teacher_day_closures (teacher_id, day, school_id, open_items)
  values (app.my_teacher_id(), p_date,
          (select t.school_id from teachers t where t.id = app.my_teacher_id()),
          coalesce((select jsonb_agg(i) from jsonb_array_elements(v_list->'items') i
                    where not (i->>'ok')::boolean), '[]'::jsonb))
  on conflict (teacher_id, day) do update
    set open_items = excluded.open_items, closed_at = now();
  -- From here the outbox worker holds non-urgent notifications for this teacher
  -- until next morning (quiet hours: after closing or after 18:00, whichever first).
  return v_list || jsonb_build_object('closed', true);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Weekly preparation — context for the server. NO student names or ids:
-- only class-level topic gaps (rule 4 + data leaves Uzbekistan → lawyer).
-- ---------------------------------------------------------------------------
create or replace function api.weekly_prep_context(p_week_start date)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  with days as (select (p_week_start + i)::date d from generate_series(0, 5) i),
  lessons as (
    select d.d as lesson_date, l.* from days d cross join lateral api.my_lessons(d.d) l
  )
  select jsonb_build_object(
    'week_start', p_week_start,
    'lessons', coalesce((select jsonb_agg(jsonb_build_object(
        'class_id', l.class_id, 'grade_level', c.grade_level, 'subject_id', l.subject_id,
        'date', l.lesson_date, 'period', l.period,
        'has_card', exists (select 1 from lesson_cards lc where lc.class_id = l.class_id
                            and lc.lesson_date = l.lesson_date and lc.period = l.period))
        order by l.lesson_date, l.period)
      from lessons l join classes c on c.id = l.class_id), '[]'::jsonb),
    -- mastery gaps: topics where the class average on the last weekly tests < 80%
    -- V3.1: aggregate in a subquery first (nested aggregates are not allowed)
    'gaps', coalesce((select jsonb_agg(jsonb_build_object(
        'class_id', g.class_id, 'subject_id', g.subject_id, 'topic', g.topic,
        'mastered_pct', g.pct))
      from (select wt.class_id, wt.subject_id, wt.topic, round(avg(ta.score)::numeric, 0) as pct
            from weekly_tests wt join test_attempts ta on ta.test_id = wt.id
            where wt.teacher_id = app.my_teacher_id() and wt.test_date >= p_week_start - 28
              and ta.score is not null
            group by wt.class_id, wt.subject_id, wt.topic
            having avg(ta.score) < 80) g), '[]'::jsonb)
  )
$$;

-- Library first (rule 7): checked lesson cards for a subject/grade/topic.
create or replace function api.library_cards(p_subject_id smallint, p_grade_level smallint, p_topic text default null)
returns setof library_items language sql stable security invoker set search_path = public, pg_temp as $$
  select * from library_items li
  where li.kind = 'lesson_card' and li.status = 'checked'
    and li.subject_id = p_subject_id and li.grade_level = p_grade_level
    and (p_topic is null or li.topic ilike '%' || p_topic || '%')
  order by li.usage_count desc limit 5
$$;

-- ---------------------------------------------------------------------------
-- AI budget: reserve → call → commit/release. Closes the check-then-log race
-- (attack A15d): the advisory lock serialises reservations per school+user.
-- ---------------------------------------------------------------------------

-- V3.1: the limit comes from v3 app.ai_check() (plan + role + feature,
-- ai_plan_rules, per-user override in ai_quotas). The placeholder
-- app.ai_limit_cents() is no longer needed.

create or replace function app.ai_reserve(p_school_id uuid, p_feature text, p_est_cents numeric, p_payload jsonb default null)
returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_chk record; v_pending numeric; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_est_cents is null or p_est_cents < 0 then raise exception 'bad_estimate' using errcode = '22023'; end if;
  if not app.member_at(p_school_id) then          -- belt and braces (attack A15b)
    raise exception 'not_member' using errcode = '42501';
  end if;
  -- V3.1: lock FIRST, then check, so two parallel calls can't both pass (A15d).
  -- V3.3: one lock per SCHOOL, because the school cap is shared by everyone.
  perform pg_advisory_xact_lock(hashtextextended('ai_budget:' || p_school_id::text, 0));
  select * into v_chk from app.ai_check(p_school_id, p_feature);
  if v_chk.reason = 'school_budget_reached' then
    raise exception 'school_budget_reached' using errcode = 'P0001', hint = 'try_library';
  end if;
  if not v_chk.allowed and v_chk.reason <> 'limit_reached' then
    raise exception 'plan_not_allowed' using errcode = 'P0001', hint = 'try_library', detail = v_chk.reason;
  end if;
  select coalesce(sum(r.est_cents), 0) into v_pending from ai_reservations r
   where r.user_id = auth.uid() and r.school_id = p_school_id and r.feature = p_feature
     and r.status = 'pending' and r.expires_at > now();
  if not v_chk.allowed or v_pending + p_est_cents > v_chk.remaining_cents then
    raise exception 'limit_reached' using errcode = 'P0001', hint = 'try_library';
  end if;
  if (select coalesce(sum(r.est_cents), 0) from ai_reservations r
       where r.school_id = p_school_id and r.status = 'pending' and r.expires_at > now())
     + p_est_cents > v_chk.school_remaining_cents then
    raise exception 'school_budget_reached' using errcode = 'P0001', hint = 'try_library';
  end if;

  insert into ai_reservations (school_id, user_id, feature, est_cents, payload)
  values (p_school_id, auth.uid(), p_feature, p_est_cents, p_payload)
  returning id into v_id;
  return v_id;
end $$;

-- service role only: real usage after the model answered
create or replace function app.ai_commit(p_res_id uuid, p_model text, p_tokens_in int, p_tokens_out int, p_cost_cents numeric)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r ai_reservations%rowtype;
begin
  update ai_reservations set status = 'committed'
   where id = p_res_id and status = 'pending' returning * into r;
  if not found then raise exception 'reservation_not_pending'; end if;
  insert into ai_usage_log (user_id, school_id, feature, model, tokens_in, tokens_out, cost_cents)
  values (r.user_id, r.school_id, r.feature, p_model, p_tokens_in, p_tokens_out, p_cost_cents);
end $$;

create or replace function app.ai_release(p_res_id uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update ai_reservations set status = 'released' where id = p_res_id and status = 'pending'
$$;

-- service role only: store AI drafts. Permission is re-derived from the
-- reservation's user (auth.uid() is null for the service role).
create or replace function app.ai_store_lesson_cards(p_res_id uuid, p_cards jsonb)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare r ai_reservations%rowtype; v_tid uuid; v_n int := 0; c jsonb;
begin
  select * into r from ai_reservations where id = p_res_id and feature = 'lesson_prep';
  if not found then raise exception 'reservation_not_found'; end if;
  select t.id into v_tid from teachers t where t.user_id = r.user_id and t.school_id = r.school_id;
  for c in select * from jsonb_array_elements(p_cards) loop
    if exists (select 1 from teacher_assignments ta join classes cl on cl.id = ta.class_id
               where ta.teacher_id = v_tid and ta.class_id = (c->>'class_id')::uuid
                 and ta.subject_id = (c->>'subject_id')::smallint and cl.school_id = r.school_id)
       and not exists (select 1 from lesson_cards lc where lc.class_id = (c->>'class_id')::uuid
                       and lc.lesson_date = (c->>'date')::date and lc.period = (c->>'period')::smallint)
    then
      insert into lesson_cards (school_id, class_id, subject_id, teacher_id, lesson_date, period,
                                topic, plan, questions, homework, status, ai_generated)
      values (r.school_id, (c->>'class_id')::uuid, (c->>'subject_id')::smallint, v_tid,
              (c->>'date')::date, (c->>'period')::smallint, c->>'topic', c->>'plan',
              c->'questions', c->>'homework', 'ai_draft', true);
      insert into exit_checks (card_id, school_id, questions)
      select lc.id, r.school_id, coalesce(c->'exit_questions', '[]'::jsonb)
      from lesson_cards lc where lc.class_id = (c->>'class_id')::uuid
        and lc.lesson_date = (c->>'date')::date and lc.period = (c->>'period')::smallint;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Grants: explicit, nothing by default.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema api from public;
grant execute on function api.my_day(date), api.my_lessons(date), api.ask_first(uuid, smallint, int),
  api.open_lesson_card(uuid, smallint, date, smallint), api.save_lesson_card(uuid, jsonb, boolean),
  api.finish_lesson(uuid, jsonb), api.day_checklist(date), api.close_day(date, uuid),
  api.weekly_prep_context(date), api.library_cards(smallint, smallint, text)
  to authenticated;

revoke execute on function app.ai_reserve(uuid, text, numeric, jsonb), app.ai_commit(uuid, text, int, int, numeric),
  app.ai_release(uuid), app.ai_store_lesson_cards(uuid, jsonb), app.fill_school_from_card()
  from public, authenticated;
grant execute on function app.ai_reserve(uuid, text, numeric, jsonb) to authenticated;
-- ai_commit / ai_release / ai_store_lesson_cards: service_role only (table owner / Supabase service key).
