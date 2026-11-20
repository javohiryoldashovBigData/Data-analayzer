-- ============================================================================
-- MAKTAB+ — step 4: zavuch / director, class teacher, weekly tests online
-- Load after api_phase1.sql, weekly_tests_gen.sql and family_api.sql.
-- All functions are SECURITY INVOKER unless noted, so RLS decides every row.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Zavuch: "did every teacher finish today's work?" (leadership only)
--    Per teacher: lessons in the timetable, "after lesson" done, topics
--    written, and cards ready for the next school day. Numbers, no children.
-- ---------------------------------------------------------------------------
create or replace function api.school_day_check(p_date date default current_date)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_school uuid; v_next date;
begin
  select r.school_id into v_school from user_school_roles r
   where r.user_id = auth.uid() and r.is_active and r.role in ('school_admin','director','zavuch') limit 1;
  if v_school is null or not app.manages_school(v_school) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- next school day (Mon–Sat)
  v_next := p_date + case extract(isodow from p_date)::int when 6 then 2 else 1 end;
  return coalesce((
    select jsonb_agg(x order by x->>'name') from (
      select jsonb_build_object(
        'teacher_id', t.id,
        'name', p.first_name || ' ' || p.last_name,
        'lessons', count(ts.*),
        'after_lesson_done', count(ts.*) filter (where exists (
            select 1 from lesson_reports lr join lesson_cards lc on lc.id = lr.card_id
            where lc.class_id = ts.class_id and lc.lesson_date = p_date and lc.period = ts.period)),
        'topics_written', count(ts.*) filter (where exists (
            select 1 from lesson_cards lc where lc.class_id = ts.class_id and lc.lesson_date = p_date
              and lc.period = ts.period and coalesce(lc.topic, '') <> '')),
        'next_day_lessons', (select count(*) from timetable_slots t2 where t2.teacher_id = t.id
            and t2.day_of_week = extract(isodow from v_next)::int and t2.effective_from <= v_next
            and (t2.effective_to is null or t2.effective_to >= v_next)),
        'next_day_cards', (select count(*) from lesson_cards lc2 where lc2.teacher_id = t.id
            and lc2.lesson_date = v_next),
        'day_closed', exists (select 1 from teacher_day_closures d where d.teacher_id = t.id and d.day = p_date)
      ) as x
      from teachers t
      join profiles p on p.user_id = t.user_id
      left join timetable_slots ts on ts.teacher_id = t.id
           and ts.day_of_week = extract(isodow from p_date)::int
           and ts.effective_from <= p_date and (ts.effective_to is null or ts.effective_to >= p_date)
      where t.school_id = v_school and t.status = 'active'
      group by t.id, p.first_name, p.last_name
    ) s), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Class teacher: "My class" — the whole picture of their own class.
--    Signals are simple rules from attendance and grades only (never money):
--      attendance: 3+ absences in the last 14 days
--      grades:     average of the last 21 days < 3.0, or 0.7+ below the 21 days before
--    These are prompts for a conversation, not labels (rule 1).
-- ---------------------------------------------------------------------------
create or replace function api.my_class_overview()
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_class classes%rowtype;
begin
  select c.* into v_class from classes c where c.class_teacher_id = app.my_teacher_id() limit 1;
  if v_class.id is null then raise exception 'not_a_class_teacher' using errcode = '42501'; end if;
  return jsonb_build_object(
    'class_id', v_class.id,
    'class', v_class.grade_level || '-' || v_class.letter,
    'students', coalesce((
      select jsonb_agg(row_to_json(s) order by s.signals_count desc, s.last_name, s.first_name) from (
        select st.id, st.first_name, st.last_name,
               a.present, a.total, a.absent14, a.late30,
               g.avg_recent, g.avg_before,
               (case when a.absent14 >= 3 then 1 else 0 end
                + case when g.avg_recent < 3.0 or g.avg_before - g.avg_recent >= 0.7 then 1 else 0 end) as signals_count,
               array_remove(array[
                 case when a.absent14 >= 3 then 'attendance' end,
                 case when g.avg_recent < 3.0 or g.avg_before - g.avg_recent >= 0.7 then 'grades' end], null) as signals
        from class_members cm join students st on st.id = cm.student_id
        left join lateral (
          select count(*) filter (where al.status in ('present','late')) as present, count(*) as total,
                 count(*) filter (where al.status = 'absent' and al.date >= current_date - 14) as absent14,
                 count(*) filter (where al.status = 'late') as late30
          from attendance_logs al where al.student_id = st.id and al.date >= current_date - 30) a on true
        left join lateral (
          select round(avg(gr.value) filter (where gr.created_at >= current_date - 21), 2) as avg_recent,
                 round(avg(gr.value) filter (where gr.created_at < current_date - 21 and gr.created_at >= current_date - 42), 2) as avg_before
          from grades gr where gr.student_id = st.id and gr.deleted_at is null and gr.grade_type = 'current') g on true
        where cm.class_id = v_class.id and cm.status = 'active'
      ) s), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Weekly tests online (student side). Questions come in the student's own
--    order (app.student_question_order); keys are never sent; scoring is on
--    the server (app.submit_attempt).
-- ---------------------------------------------------------------------------
create or replace function api.my_tests()
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'test_id', wt.id, 'subject', sub.name_uz, 'topic', wt.topic, 'test_date', wt.test_date,
           'status', wt.status, 'questions', (select count(*) from test_questions q where q.test_id = wt.id),
           'attempt', (select jsonb_build_object('id', ta.id, 'submitted_at', ta.submitted_at, 'score', ta.score)
                       from test_attempts ta join students s on s.id = ta.student_id
                       where ta.test_id = wt.id and s.user_id = auth.uid()))
         order by wt.test_date desc), '[]'::jsonb)
  from weekly_tests wt join subjects sub on sub.id = wt.subject_id
  where wt.status in ('published','closed')
    and exists (select 1 from class_members cm join students s on s.id = cm.student_id
                where cm.class_id = wt.class_id and cm.status = 'active' and s.user_id = auth.uid())
$$;

-- start (or resume) my attempt and get the questions in MY order, without answers
create or replace function api.start_test(p_test_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_student uuid; v_attempt test_attempts%rowtype;
begin
  select s.id into v_student from students s where s.user_id = auth.uid();
  if v_student is null then raise exception 'not_a_student' using errcode = '42501'; end if;
  select * into v_attempt from test_attempts ta where ta.test_id = p_test_id and ta.student_id = v_student;
  if v_attempt.id is null then
    insert into test_attempts (test_id, student_id, mode) values (p_test_id, v_student, 'online')
    returning * into v_attempt;                            -- RLS: published test of my class only
  end if;
  return jsonb_build_object(
    'attempt_id', v_attempt.id, 'submitted_at', v_attempt.submitted_at, 'score', v_attempt.score,
    'questions', (select jsonb_agg(jsonb_build_object(
                    'id', q.id, 'text', q.question_text, 'options', q.options, 'topic', q.topic,
                    'answer', (select aa.answer from attempt_answers aa where aa.attempt_id = v_attempt.id and aa.question_id = q.id))
                  order by o.student_position)
                  from app.student_question_order(p_test_id, v_student) o
                  join test_questions q on q.id = o.question_id));
end $$;

create or replace function api.save_answer(p_attempt_id uuid, p_question_id uuid, p_choice int)
returns void language plpgsql volatile security invoker set search_path = public, pg_temp as $$
begin
  insert into attempt_answers (attempt_id, question_id, position, answer)
  values (p_attempt_id, p_question_id,
          coalesce((select position from test_questions where id = p_question_id), 0), to_jsonb(p_choice))
  on conflict (attempt_id, question_id) do update set answer = excluded.answer;   -- RLS: my open attempt only
end $$;

-- teacher: results of one test — per student score, per topic mastery
create or replace function api.test_results(p_test_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if not app.owns_test(p_test_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'test', (select jsonb_build_object('id', wt.id, 'topic', wt.topic, 'status', wt.status, 'test_date', wt.test_date,
                    'class', c.grade_level || '-' || c.letter, 'subject', sub.name_uz)
             from weekly_tests wt join classes c on c.id = wt.class_id join subjects sub on sub.id = wt.subject_id
             where wt.id = p_test_id),
    'students', coalesce((select jsonb_agg(jsonb_build_object(
                  'name', s.first_name || ' ' || s.last_name, 'score', ta.score, 'submitted_at', ta.submitted_at)
                  order by s.last_name)
                from class_members cm join students s on s.id = cm.student_id
                join weekly_tests wt on wt.id = p_test_id and wt.class_id = cm.class_id
                left join test_attempts ta on ta.test_id = p_test_id and ta.student_id = s.id
                where cm.status = 'active'), '[]'::jsonb),
    'topics', coalesce((select jsonb_agg(jsonb_build_object('topic', x.topic, 'is_review', x.is_review,
                  'correct_pct', x.pct, 'answers', x.n) order by x.is_review, x.topic)
                from (select coalesce(q.topic, '') as topic, q.is_review,
                             round(100.0 * count(*) filter (where aa.is_correct) / nullif(count(aa.*), 0)) as pct,
                             count(aa.*) as n
                      from test_questions q
                      left join attempt_answers aa on aa.question_id = q.id
                        and exists (select 1 from test_attempts ta where ta.id = aa.attempt_id and ta.submitted_at is not null)
                      where q.test_id = p_test_id group by q.topic, q.is_review) x), '[]'::jsonb));
end $$;

-- teacher: my tests (all statuses)
create or replace function api.teacher_tests()
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'test_id', wt.id, 'class', c.grade_level || '-' || c.letter, 'subject', sub.name_uz, 'class_id', wt.class_id,
           'subject_id', wt.subject_id, 'topic', wt.topic, 'test_date', wt.test_date, 'status', wt.status,
           'questions', (select count(*) from test_questions q where q.test_id = wt.id),
           'submitted', (select count(*) from test_attempts ta where ta.test_id = wt.id and ta.submitted_at is not null))
         order by wt.test_date desc), '[]'::jsonb)
  from weekly_tests wt join classes c on c.id = wt.class_id join subjects sub on sub.id = wt.subject_id
  where wt.teacher_id = app.my_teacher_id()
$$;

revoke execute on function api.school_day_check(date), api.my_class_overview(), api.my_tests(),
  api.start_test(uuid), api.save_answer(uuid, uuid, int), api.test_results(uuid), api.teacher_tests() from public;
grant execute on function api.school_day_check(date), api.my_class_overview(), api.my_tests(),
  api.start_test(uuid), api.save_answer(uuid, uuid, int), api.test_results(uuid), api.teacher_tests() to authenticated;
-- helpers used inside these invoker functions
grant execute on function app.owns_test(uuid), app.student_question_order(uuid, uuid), app.submit_attempt(uuid) to authenticated;
