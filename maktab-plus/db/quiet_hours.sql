-- ============================================================================
-- MAKTAB+ round 4 — quiet hours for the notification outbox
--   rule 2 "No phones in the lesson"  +  rule 3 "Work ends when school ends"
-- Run AFTER v3 schema + api_phase1.sql.  Parse-checked only (pglast), NOT run.
--
-- THE RULE (all times Asia/Tashkent; numbers are ESTIMATES = team decisions)
--  A. SAFETY kinds are ALWAYS immediate, for everyone:
--       gate_in, gate_out, absence, skipped_lesson, system
--  B. STAFF recipient (teacher/zavuch/director/school_admin of that school)
--     for any other kind is HELD when:
--       - they ran close_day today, OR
--       - it is after 18:00, OR before the morning start, OR
--       - today is not a school day (Sunday, a day off, between terms)
--     → delivered at the next school day, 30 min before the first bell.
--  C. STUDENT recipient: non-safety kinds are held DURING LESSONS
--     (first bell → end of last period today) → delivered after the last bell,
--     and held at night 21:00–07:00.
--  D. PARENT recipient: non-safety kinds held at night 21:00–07:00 → 07:00.
--  The worker never needs to know the rule: it only reads deliver_after.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings (per school, defaults are ESTIMATES)
-- ---------------------------------------------------------------------------
create table if not exists school_quiet_settings (
  school_id          uuid primary key references schools(id) on delete cascade,
  staff_end          time not null default '18:00',
  morning_lead       interval not null default '30 minutes',  -- before first bell
  family_night_start time not null default '21:00',
  family_night_end   time not null default '07:00',
  default_first_bell time not null default '08:00',           -- if bell_periods is empty
  check (morning_lead between interval '0' and interval '2 hours')
);
alter table school_quiet_settings enable row level security;
drop policy if exists qs_read on school_quiet_settings;
create policy qs_read on school_quiet_settings for select to authenticated
  using (app.member_at(school_quiet_settings.school_id));
drop policy if exists qs_write on school_quiet_settings;
create policy qs_write on school_quiet_settings for all to authenticated
  using (app.manages_school(school_quiet_settings.school_id))
  with check (app.manages_school(school_quiet_settings.school_id));
grant select, insert, update on school_quiet_settings to authenticated;

-- Days off: school_id null = national day off for everyone. Fill from the
-- official calendar each year (do NOT hardcode dates here — they move,
-- e.g. Ramazon/Qurbon hayit).
create table if not exists school_days_off (
  id        bigint generated always as identity primary key,
  school_id uuid references schools(id) on delete cascade,
  day       date not null,
  name      text not null
);
create unique index if not exists school_days_off_uk
  on school_days_off ((coalesce(school_id, '00000000-0000-0000-0000-000000000000'::uuid)), day);
alter table school_days_off enable row level security;
drop policy if exists sdo_read on school_days_off;
create policy sdo_read on school_days_off for select to authenticated
  using (school_days_off.school_id is null or app.member_at(school_days_off.school_id));
drop policy if exists sdo_write on school_days_off;
create policy sdo_write on school_days_off for all to authenticated
  using (school_days_off.school_id is not null and app.manages_school(school_days_off.school_id))
  with check (school_days_off.school_id is not null and app.manages_school(school_days_off.school_id));
grant select, insert, update, delete on school_days_off to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Outbox columns
-- ---------------------------------------------------------------------------
alter table notification_outbox add column if not exists school_id     uuid;
alter table notification_outbox add column if not exists deliver_after timestamptz;
alter table notification_outbox add column if not exists held_reason   text;
create index if not exists outbox_due_idx on notification_outbox (deliver_after nulls first, id)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- 3. Calendar helpers (all definer: called from a trigger with any caller)
-- ---------------------------------------------------------------------------
create or replace function app.local_ts(p_day date, p_time time)
returns timestamptz language sql stable as $$
  select (p_day + p_time) at time zone 'Asia/Tashkent'
$$;

create or replace function app.is_school_day(p_school_id uuid, p_day date)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select extract(isodow from p_day) <> 7
     and not exists (select 1 from school_days_off d
                     where d.day = p_day and (d.school_id is null or d.school_id = p_school_id))
     and exists (select 1 from terms t                           -- between terms = holidays
                 where p_day between t.start_date and t.end_date)
  -- V3-ADAPT: if v3 has per-school terms, add  and t.school_id = p_school_id
  -- 5-day schools: add their Saturdays to school_days_off, or add a
  -- days_per_week column (team decision).
$$;

create or replace function app.first_bell(p_school_id uuid)
returns time language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select min(b.start_time) from bell_periods b where b.school_id = p_school_id),
    (select s.default_first_bell from school_quiet_settings s where s.school_id = p_school_id),
    time '08:00')
$$;

create or replace function app.qs(p_school_id uuid)
returns school_quiet_settings language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select s from school_quiet_settings s where s.school_id = p_school_id),
    row(p_school_id, time '18:00', interval '30 minutes', time '21:00', time '07:00', time '08:00')::school_quiet_settings)
$$;

-- Next staff "work start" strictly after p_at (searches up to 60 days; holidays)
create or replace function app.next_staff_start(p_school_id uuid, p_at timestamptz)
returns timestamptz language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_day date := (p_at at time zone 'Asia/Tashkent')::date;
  v_start timestamptz; i int;
begin
  for i in 0..60 loop
    if app.is_school_day(p_school_id, v_day + i) then
      v_start := app.local_ts(v_day + i, app.first_bell(p_school_id)) - (app.qs(p_school_id)).morning_lead;
      if v_start > p_at then return v_start; end if;
    end if;
  end loop;
  return p_at + interval '1 day';          -- no term data at all: never hold forever
end $$;

-- End of the last lesson of this student today (null = no lessons today)
create or replace function app.student_lessons_end(p_student_user uuid, p_day date)
returns timestamptz language sql stable security definer set search_path = public, pg_temp as $$
  select app.local_ts(p_day, max(b.end_time))
  from students s
  join class_members cm on cm.student_id = s.id and cm.status = 'active'
  join timetable_slots ts on ts.class_id = cm.class_id
   and ts.day_of_week = extract(isodow from p_day)::int
   and ts.effective_from <= p_day and (ts.effective_to is null or ts.effective_to >= p_day)
  join classes c on c.id = cm.class_id
  join bell_periods b on b.school_id = c.school_id and b.number = ts.period
  where s.user_id = p_student_user
$$;

-- ---------------------------------------------------------------------------
-- 4. THE RULE: when may this notification be delivered?  (null = now)
-- ---------------------------------------------------------------------------
create or replace function app.deliver_after(p_recipient uuid, p_kind text, p_school_id uuid,
                                             p_student_id uuid default null,
                                             p_at timestamptz default now())
returns table (deliver_at timestamptz, reason text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_local   timestamp := p_at at time zone 'Asia/Tashkent';
  v_day     date := v_local::date;
  v_time    time := v_local::time;
  v_qs      school_quiet_settings;
  v_tid     uuid;
  v_family  boolean;
  v_student boolean;
  v_end     timestamptz;
  v_bell    timestamptz;
begin
  -- A. safety kinds: always now
  if p_kind in ('gate_in','gate_out','absence','skipped_lesson','system') then
    return query select null::timestamptz, null::text; return;
  end if;
  if p_school_id is null then                                -- unknown school: do not hold
    return query select null::timestamptz, 'no_school'::text; return;
  end if;
  v_qs := app.qs(p_school_id);

  -- Is this message about the recipient's OWN family? (a teacher can also be a parent)
  v_student := exists (select 1 from students s where s.user_id = p_recipient
                       and (p_student_id is null or s.id = p_student_id));
  v_family  := v_student
            or (p_student_id is not null and exists (
                  select 1 from guardians g where g.parent_user_id = p_recipient
                  and g.student_id = p_student_id));

  -- B. staff
  if not v_family and exists (select 1 from user_school_roles r
        where r.user_id = p_recipient and r.is_active and r.school_id = p_school_id
          and r.role in ('teacher','zavuch','director','school_admin')) then
    select t.id into v_tid from teachers t where t.user_id = p_recipient and t.school_id = p_school_id;
    v_bell := app.local_ts(v_day, app.first_bell(p_school_id)) - v_qs.morning_lead;
    if not app.is_school_day(p_school_id, v_day) then
      return query select app.next_staff_start(p_school_id, p_at), 'day_off'::text; return;
    end if;
    if v_tid is not null and exists (select 1 from teacher_day_closures d
                                     where d.teacher_id = v_tid and d.day = v_day) then
      return query select app.next_staff_start(p_school_id, p_at), 'day_closed'::text; return;
    end if;
    if v_time >= v_qs.staff_end then
      return query select app.next_staff_start(p_school_id, p_at), 'after_hours'::text; return;
    end if;
    if p_at < v_bell then
      return query select v_bell, 'before_start'::text; return;
    end if;
    return query select null::timestamptz, null::text; return;
  end if;

  -- C/D. family night window (wraps midnight: 21:00 → 07:00)
  if v_time >= v_qs.family_night_start then
    return query select app.local_ts(v_day + 1, v_qs.family_night_end), 'night'::text; return;
  end if;
  if v_time < v_qs.family_night_end then
    return query select app.local_ts(v_day, v_qs.family_night_end), 'night'::text; return;
  end if;

  -- C. student during lessons → after the last bell
  if v_student and app.is_school_day(p_school_id, v_day) then
    v_end := app.student_lessons_end(p_recipient, v_day);
    if v_end is not null and p_at >= app.local_ts(v_day, app.first_bell(p_school_id))
       and p_at < v_end then
      return query select v_end, 'in_lessons'::text; return;
    end if;
  end if;

  return query select null::timestamptz, null::text;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Trigger: every outbox insert gets its school + deliver_after
--    (existing triggers insert (recipient_id, payload) — unchanged)
-- ---------------------------------------------------------------------------
create or replace function app.outbox_schedule()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student uuid := nullif(new.payload->>'student_id', '')::uuid; r record;
begin
  new.school_id := coalesce(
    new.school_id,
    nullif(new.payload->>'school_id', '')::uuid,
    (select s.school_id from students s where s.id = v_student),
    (select u.school_id from user_school_roles u
      where u.user_id = new.recipient_id and u.is_active and u.school_id is not null
      order by app.role_rank(u.role) desc limit 1));          -- role_rank: round4_roles_signals.sql
  select * into r from app.deliver_after(new.recipient_id, new.payload->>'kind',
                                         new.school_id, v_student, coalesce(new.created_at, now()));
  new.deliver_after := r.deliver_at;
  new.held_reason   := r.reason;
  return new;
end $$;

drop trigger if exists outbox_schedule on notification_outbox;
create trigger outbox_schedule before insert on notification_outbox
  for each row execute function app.outbox_schedule();

-- close_day after a message was already queued for later today: hold it too.
create or replace function app.hold_after_close_day()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update notification_outbox o
     set deliver_after = app.next_staff_start(new.school_id, now()), held_reason = 'day_closed'
   from teachers t
   where t.id = new.teacher_id and o.recipient_id = t.user_id
     and o.status = 'pending' and o.deliver_after is not null
     and o.deliver_after < app.next_staff_start(new.school_id, now())
     and coalesce(o.payload->>'kind', '') not in ('gate_in','gate_out','absence','skipped_lesson','system')
     and o.payload->>'student_id' is null;      -- own-family messages are not work
  return new;
end $$;
drop trigger if exists closures_hold on teacher_day_closures;
create trigger closures_hold after insert on teacher_day_closures
  for each row execute function app.hold_after_close_day();

-- ---------------------------------------------------------------------------
-- 6. The outbox worker query (Edge Function / cron, service role)
--    Concurrency-safe: two workers never take the same row.
-- ---------------------------------------------------------------------------
create or replace function app.outbox_claim(p_limit int default 200)
returns setof notification_outbox
language sql volatile security definer set search_path = public, pg_temp as $$
  update notification_outbox o
     set status = 'sending', attempts = o.attempts + 1
   where o.id in (
     select x.id from notification_outbox x
     where x.status = 'pending'
       and (x.deliver_after is null or x.deliver_after <= now())
     order by x.deliver_after nulls first, x.id
     limit p_limit
     for update skip locked)
  returning o.*
$$;
-- After sending: status = 'sent' (processed_at = now()), or back to 'pending'
-- with deliver_after = now() + backoff on a provider error (attempts < 5).

revoke execute on function app.outbox_claim(int) from public;
revoke execute on function app.deliver_after(uuid, text, uuid, uuid, timestamptz) from public;
revoke execute on function app.next_staff_start(uuid, timestamptz) from public;
revoke execute on function app.student_lessons_end(uuid, date) from public;
revoke execute on function app.outbox_schedule(), app.hold_after_close_day() from public;
-- read-only helpers the UI may call ("when will this be delivered?"):
grant execute on function app.is_school_day(uuid, date), app.first_bell(uuid) to authenticated;
-- service_role only (Supabase): grant execute on function app.outbox_claim(int) to service_role;

-- OPEN (team decisions):
--  * timetable_change for TOMORROW posted at 20:00 → teacher sees it at 07:30.
--    The my_day screen shows it anyway. If that is too late, add
--    'timetable_change' to the safety list (silent push).
--  * Parents' "grade_posted" at night is held to 07:00 — teachers should not
--    grade at night anyway (rule 3).
