-- ============================================================================
-- MAKTAB+ — step 3: parents & students (load after api_phase1.sql)
--
-- 1. api.class_week(): the diary week for a class — timetable, bell times and
--    lesson TOPICS. Lesson cards stay private (they hold the teacher's "ask
--    first" notes, hole A2), so this function returns only date/period/
--    subject/topic, and only to students/parents of that class or its staff.
-- 2. Accepted absence report → the day is EXCUSED automatically: a teacher
--    marking that child "absent" is stored as "excused", so no needless
--    "your child is absent" alert goes to the parent who reported it.
-- ============================================================================

create or replace function api.class_week(p_class_id uuid, p_week_start date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (app.in_class(p_class_id) or app.is_staff_at(app.class_school(p_class_id))) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'date', d.day, 'period', ts.period, 'subject_id', ts.subject_id, 'subject', sub.name_uz,
             'start', bp.start_time, 'end', bp.end_time,
             'topic', (select lc.topic from lesson_cards lc
                       where lc.class_id = p_class_id and lc.lesson_date = d.day and lc.period = ts.period))
           order by d.day, ts.period)
    from generate_series(p_week_start, p_week_start + 5, interval '1 day') d0
    cross join lateral (select d0::date as day) d
    join timetable_slots ts on ts.class_id = p_class_id
                           and ts.day_of_week = extract(isodow from d.day)::int
                           and ts.effective_from <= d.day
                           and (ts.effective_to is null or ts.effective_to >= d.day)
    join subjects sub on sub.id = ts.subject_id
    left join bell_periods bp on bp.school_id = app.class_school(p_class_id) and bp.number = ts.period
  ), '[]'::jsonb);
end $$;
revoke execute on function api.class_week(uuid, date) from public;
grant execute on function api.class_week(uuid, date) to authenticated;

create or replace function app.excuse_reported_absence()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'absent' and exists (
       select 1 from parent_absence_reports r
       where r.student_id = new.student_id and r.absence_date = new.date and r.status = 'accepted') then
    new.status := 'excused';
    new.reason := coalesce(new.reason, 'parent_report');
  end if;
  return new;
end $$;
revoke execute on function app.excuse_reported_absence() from public, authenticated;
drop trigger if exists attendance_excuse_reported on attendance_logs;
create trigger attendance_excuse_reported before insert or update on attendance_logs
  for each row execute function app.excuse_reported_absence();
