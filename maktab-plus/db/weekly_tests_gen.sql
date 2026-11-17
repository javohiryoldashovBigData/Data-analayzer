-- ============================================================================
-- MAKTAB+ round 4 — weekly test generator
--   retrieval practice + spaced repetition (old topics come back)
--   + "mix topics" (interleaving)
-- Order of sources (rule 7): school's own questions → checked Library questions
--   → questions from this class's past tests. AI is NOT called here. If there
--   are not enough new questions, the RPC says so (missing_new) and the app
--   offers "make questions with AI" (ai_made → teacher checks → usable).
-- Run AFTER v3 schema + api_phase1.sql.  Parse-checked only (pglast), NOT run.
-- V3-ADAPT marks the places that depend on v3 names I could not see:
--   * test_answer_keys(question_id uuid pk, correct_index smallint)
--   * test_questions has NO correct_index column in v3
--   * teachers can read/insert test_answer_keys for their own tests (v3 policy)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Topic key: "Kasrlar  " and "kasrlar" are the same topic
-- ---------------------------------------------------------------------------
create or replace function app.topic_key(p text)
returns text language sql immutable parallel safe as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')), '')
$$;

-- ---------------------------------------------------------------------------
-- 2. Question bank (answer keys in a separate table, like v3 test_answer_keys)
-- ---------------------------------------------------------------------------
create table if not exists question_bank (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid references schools(id) on delete cascade,   -- null = platform Library
  subject_id    smallint not null references subjects(id),
  grade_level   smallint not null check (grade_level between 1 and 11),
  topic         text not null,
  topic_key     text generated always as (app.topic_key(topic)) stored,
  language      text not null default 'uz' check (language in ('uz','ru','en')),
  question_text text not null,
  options       jsonb not null check (jsonb_typeof(options) = 'array'
                                      and jsonb_array_length(options) between 2 and 6),
  status        library_status not null default 'ai_made',      -- only 'checked' is used in tests
  source        text not null default 'teacher' check (source in ('teacher','library','ai')),
  created_by    uuid references auth.users(id),
  checked_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
create index if not exists question_bank_lookup_idx
  on question_bank(subject_id, topic_key, grade_level, language) where status = 'checked';

create table if not exists question_bank_keys (
  question_id   uuid primary key references question_bank(id) on delete cascade,
  correct_index smallint not null check (correct_index >= 0)
);

-- link test questions back to their source + remember topic / review flag
alter table test_questions add column if not exists topic            text;
alter table test_questions add column if not exists is_review        boolean not null default false;
alter table test_questions add column if not exists bank_question_id uuid references question_bank(id) on delete set null;
alter table test_questions add column if not exists source_question_id uuid;   -- reused past test question
alter table weekly_tests   add column if not exists mix_topics       boolean not null default true;
create index if not exists test_questions_bank_idx on test_questions(bank_question_id);

alter table question_bank      enable row level security;
alter table question_bank_keys enable row level security;

-- staff = teacher or leader somewhere (definer: safe read of user_school_roles)
create or replace function app.is_staff_at(p_school_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from user_school_roles r
                 where r.user_id = auth.uid() and r.is_active and r.school_id = p_school_id
                   and r.role in ('teacher','zavuch','director','school_admin'))
$$;
create or replace function app.is_staff_anywhere()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from user_school_roles r
                 where r.user_id = auth.uid() and r.is_active
                   and r.role in ('teacher','zavuch','director','school_admin'))
$$;

-- Students and parents never read the bank (it contains future test questions).
drop policy if exists qb_select on question_bank;
create policy qb_select on question_bank for select to authenticated using (
  (question_bank.school_id is not null and app.is_staff_at(question_bank.school_id))
  or (question_bank.school_id is null and question_bank.status = 'checked' and app.is_staff_anywhere())
  or (question_bank.school_id is null and app.can_edit_library())
);
drop policy if exists qb_write on question_bank;
drop policy if exists qb_insert on question_bank;
create policy qb_insert on question_bank for insert to authenticated with check (
  question_bank.created_by = auth.uid()
  and ((question_bank.school_id is not null and app.is_staff_at(question_bank.school_id))
       or (question_bank.school_id is null and app.can_edit_library())));
drop policy if exists qb_update on question_bank;
create policy qb_update on question_bank for update to authenticated
  using (
    (question_bank.school_id is not null and app.is_staff_at(question_bank.school_id))
    or (question_bank.school_id is null and app.can_edit_library()))
  with check (
    (question_bank.school_id is not null and app.is_staff_at(question_bank.school_id))
    or (question_bank.school_id is null and app.can_edit_library()));
drop policy if exists qb_delete on question_bank;
create policy qb_delete on question_bank for delete to authenticated using (
  (question_bank.school_id is not null and app.is_staff_at(question_bank.school_id)
     and question_bank.created_by = auth.uid())
  or (question_bank.school_id is null and app.can_edit_library()));

drop policy if exists qbk_rw on question_bank_keys;
create policy qbk_rw on question_bank_keys for all to authenticated
  using (exists (select 1 from question_bank q where q.id = question_bank_keys.question_id))  -- RLS of q applies
  with check (exists (select 1 from question_bank q where q.id = question_bank_keys.question_id
                      and ((q.school_id is not null and app.is_staff_at(q.school_id))
                           or (q.school_id is null and app.can_edit_library()))));

grant select, insert, update, delete on question_bank, question_bank_keys to authenticated;

-- Teacher saves their own question (people-made → 'checked' by the author).
create or replace function api.save_bank_question(
  p_subject_id smallint, p_grade_level smallint, p_topic text, p_question text,
  p_options jsonb, p_correct_index smallint, p_language text default 'uz')
returns uuid language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_school uuid; v_id uuid;
begin
  select t.school_id into v_school from teachers t where t.id = app.my_teacher_id();
  if v_school is null then raise exception 'not_a_teacher' using errcode = '42501'; end if;
  if p_correct_index < 0 or p_correct_index >= jsonb_array_length(p_options) then
    raise exception 'bad_correct_index' using errcode = '22023';
  end if;
  insert into question_bank (school_id, subject_id, grade_level, topic, language, question_text,
                             options, status, source, created_by, checked_by)
  values (v_school, p_subject_id, p_grade_level, p_topic, p_language, p_question,
          p_options, 'checked', 'teacher', auth.uid(), auth.uid())
  returning id into v_id;
  insert into question_bank_keys (question_id, correct_index) values (v_id, p_correct_index);
  return v_id;
end $$;

-- Teacher approves an AI-made question of their school (rule 1: people decide).
create or replace function api.check_bank_question(p_id uuid, p_correct_index smallint default null)
returns void language plpgsql volatile security invoker set search_path = public, pg_temp as $$
begin
  update question_bank set status = 'checked', checked_by = auth.uid()
   where id = p_id and school_id is not null and status <> 'checked';
  if not found then raise exception 'not_found_or_not_allowed' using errcode = '42501'; end if;
  if p_correct_index is not null then
    update question_bank_keys set correct_index = p_correct_index where question_id = p_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Spacing rule (ESTIMATE — tune in the pilot)
--   A topic comes back after an interval that grows each time the class
--   handles it well:   1 → 2 → 4 → 8 weeks
--   If class mastery on that topic is < 80% (mastery-inspired threshold),
--   the interval resets to 1 week.
--   "Due" = days since last seen >= interval*7 - 2  (2-day tolerance so a
--   Friday test and a Thursday test both count as "one week").
-- ---------------------------------------------------------------------------
create or replace function app.review_interval_weeks(p_times_seen int, p_mastery numeric)
returns int language sql immutable as $$
  select case
    when p_mastery is null or p_mastery < 80 then 1
    else (power(2, least(greatest(p_times_seen, 1) - 1, 3)))::int     -- 1,2,4,8
  end
$$;

-- Class-level topic history (no student names leave this function; numbers only)
create or replace function api.class_topic_history(p_class_id uuid, p_subject_id smallint,
                                                   p_on date default current_date)
returns table (topic_key text, topic text, last_seen date, times_seen int,
               mastery_pct numeric, interval_weeks int, due boolean, priority numeric)
language sql stable security invoker set search_path = public, pg_temp as $$
  with h as (
    select app.topic_key(coalesce(tq.topic, wt.topic))  as k,
           min(coalesce(tq.topic, wt.topic))            as label,
           max(wt.test_date)                            as last_seen,
           count(distinct wt.id)::int                   as times_seen,
           round(100.0 * avg(case when aa.is_correct then 1.0
                                  when aa.is_correct is not null then 0.0 end), 0) as mastery
    from weekly_tests wt
    join test_questions tq on tq.test_id = wt.id
    left join attempt_answers aa on aa.question_id = tq.id
    where wt.class_id = p_class_id and wt.subject_id = p_subject_id
      and wt.status in ('published','closed') and wt.test_date < p_on
      and coalesce(tq.topic, wt.topic) is not null
    group by 1
  )
  select h.k, h.label, h.last_seen, h.times_seen, h.mastery,
         app.review_interval_weeks(h.times_seen, h.mastery),
         (p_on - h.last_seen) >= app.review_interval_weeks(h.times_seen, h.mastery) * 7 - 2,
         round((p_on - h.last_seen)::numeric / (app.review_interval_weeks(h.times_seen, h.mastery) * 7)
               + case when h.mastery is not null and h.mastery < 80 then 1 else 0 end, 3)
  from h
$$;

-- ---------------------------------------------------------------------------
-- 4. THE GENERATOR
--   api.generate_weekly_test(class, subject, topic, test_date, n_new, n_review,
--                            mix_topics, language)
--   → creates a DRAFT test. The teacher reviews/edits, then publishes (rule 1).
-- ---------------------------------------------------------------------------
create or replace function api.generate_weekly_test(
  p_class_id   uuid,
  p_subject_id smallint,
  p_topic      text,
  p_test_date  date    default current_date,
  p_n_new      int     default 8,
  p_n_review   int     default 4,          -- ≈ 1/3 old topics (ESTIMATE)
  p_mix_topics boolean default true,       -- true = interleave; false = new block, then review block
  p_language   text    default 'uz')
returns jsonb language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare
  v_tid uuid := app.my_teacher_id();
  v_class classes%rowtype;
  v_term uuid; v_test uuid; v_key text := app.topic_key(p_topic);
  v_new int := 0; v_rev int := 0; v_q record; v_qid uuid; v_pos int := 0;
  v_review_topics jsonb;
begin
  if v_tid is null or not app.teaches_class(p_class_id, p_subject_id) then
    raise exception 'not_your_class' using errcode = '42501';
  end if;
  if v_key is null then raise exception 'topic_required' using errcode = '22023'; end if;
  if p_n_new not between 0 and 30 or p_n_review not between 0 and 15 or p_n_new + p_n_review = 0 then
    raise exception 'bad_counts' using errcode = '22023';
  end if;
  select * into v_class from classes c where c.id = p_class_id;
  select t.id into v_term from terms t
   where t.academic_year_id = v_class.academic_year_id
     and p_test_date between t.start_date and t.end_date;
  if v_term is null then raise exception 'no_term_for_date' using errcode = 'P0001'; end if;

  insert into weekly_tests (school_id, class_id, subject_id, teacher_id, term_id, test_date,
                            topic, status, mix_topics)
  values (v_class.school_id, p_class_id, p_subject_id, v_tid, v_term, p_test_date,
          p_topic, 'draft', p_mix_topics)
  returning id into v_test;

  -- scratch list of chosen questions
  create temp table if not exists _pick (
    ord int, block smallint, is_review boolean, topic text, question_text text,
    options jsonb, correct_index smallint, bank_id uuid, source_id uuid
  ) on commit drop;
  truncate _pick;

  -- (a) NEW questions on this week's topic: unseen by this class first,
  --     school's own first, then Library; deterministic order per test.
  insert into _pick
  select row_number() over (), 1, false, q.topic, q.question_text, q.options, k.correct_index, q.id, null
  from (
    select qb.* from question_bank qb
    where qb.subject_id = p_subject_id and qb.topic_key = v_key and qb.status = 'checked'
      and qb.language = p_language
      and qb.grade_level between v_class.grade_level - 1 and v_class.grade_level
      and (qb.school_id = v_class.school_id or qb.school_id is null)
    order by
      exists (select 1 from test_questions tq join weekly_tests wt on wt.id = tq.test_id
              where tq.bank_question_id = qb.id and wt.class_id = p_class_id),   -- unseen first
      (qb.school_id is null),                                                  -- own school first
      md5(qb.id::text || v_test::text)
    limit p_n_new
  ) q
  join question_bank_keys k on k.question_id = q.id;
  get diagnostics v_new = row_count;

  -- (b) REVIEW questions: due old topics, weakest/most overdue first, round-robin
  --     across topics (max 2 per topic). Bank variants preferred over the exact
  --     past question (retrieval, not memorising the answer letter).
  with due as (
    select h.topic_key, h.topic, h.priority, h.mastery_pct,
           row_number() over (order by h.priority desc, h.last_seen) as trank
    from api.class_topic_history(p_class_id, p_subject_id, p_test_date) h
    where h.due and h.topic_key <> v_key
  ),
  cand as (
    -- bank variants
    select d.trank, d.topic, qb.question_text, qb.options, k.correct_index,
           qb.id as bank_id, null::uuid as source_id,
           exists (select 1 from test_questions tq join weekly_tests wt on wt.id = tq.test_id
                   where tq.bank_question_id = qb.id and wt.class_id = p_class_id) as seen,
           md5(qb.id::text || v_test::text) as tie
    from due d
    join question_bank qb on qb.topic_key = d.topic_key and qb.subject_id = p_subject_id
     and qb.status = 'checked' and qb.language = p_language
     and qb.grade_level between v_class.grade_level - 1 and v_class.grade_level
     and (qb.school_id = v_class.school_id or qb.school_id is null)
    join question_bank_keys k on k.question_id = qb.id
    union all
    -- fallback: this class's own past questions on that topic (own code, no AI)
    select d.trank, coalesce(tq.topic, wt.topic), tq.question_text, tq.options, ak.correct_index,
           null::uuid, tq.id, true, md5(tq.id::text || v_test::text)
    from due d
    join weekly_tests wt on wt.class_id = p_class_id and wt.subject_id = p_subject_id
     and wt.status in ('published','closed') and wt.id <> v_test
    join test_questions tq on tq.test_id = wt.id
     and app.topic_key(coalesce(tq.topic, wt.topic)) = d.topic_key
     and tq.bank_question_id is null                       -- bank ones are covered above
    join test_answer_keys ak on ak.question_id = tq.id      -- V3-ADAPT
  ),
  ranked as (
    select c.*, row_number() over (partition by c.trank order by c.seen, c.tie) as in_topic
    from cand c
  )
  insert into _pick
  select 1000 + row_number() over (order by r.in_topic, r.trank), 2, true, r.topic,
         r.question_text, r.options, r.correct_index, r.bank_id, r.source_id
  from ranked r
  where r.in_topic <= 2
  order by r.in_topic, r.trank
  limit p_n_review;
  get diagnostics v_rev = row_count;

  -- (c) write questions + keys. Teacher-facing position:
  --     mix → interleaved (deterministic shuffle); no mix → new block, then review.
  for v_q in
    select * from _pick
    order by case when p_mix_topics then 0 else block end,
             case when p_mix_topics then md5(coalesce(bank_id, source_id)::text || v_test::text) end,
             ord
  loop
    v_pos := v_pos + 1;
    insert into test_questions (test_id, question_text, options, points, position,
                                topic, is_review, bank_question_id, source_question_id)
    values (v_test, v_q.question_text, v_q.options, 1, v_pos,
            v_q.topic, v_q.is_review, v_q.bank_id, v_q.source_id)
    returning id into v_qid;
    insert into test_answer_keys (question_id, correct_index)          -- V3-ADAPT
    values (v_qid, v_q.correct_index);
  end loop;

  select coalesce(jsonb_agg(distinct p.topic), '[]'::jsonb) into v_review_topics
  from _pick p where p.is_review;

  return jsonb_build_object(
    'test_id', v_test, 'status', 'draft',
    'new_count', v_new, 'review_count', v_rev,
    'missing_new', greatest(p_n_new - v_new, 0),        -- > 0 → app offers Library search, then AI
    'missing_review', greatest(p_n_review - v_rev, 0),  -- 0 due topics early in the year is normal
    'review_topics', v_review_topics,
    'mix_topics', p_mix_topics);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Per-student order (replace v3's shuffle if it differs)
--   Deterministic: the same student always sees the same order (refresh-safe,
--   paper/online identical); neighbours see different orders (copying signal).
--   mix_topics = false keeps blocks: new questions first, review block after.
-- ---------------------------------------------------------------------------
create or replace function app.student_question_order(p_test_id uuid, p_student_id uuid)
returns table (question_id uuid, student_position int)
language sql stable security invoker set search_path = public, pg_temp as $$
  select tq.id,
         (row_number() over (
            order by case when wt.mix_topics then 0 else tq.is_review::int end,
                     md5(p_student_id::text || tq.id::text)))::int
  from test_questions tq join weekly_tests wt on wt.id = tq.test_id
  where tq.test_id = p_test_id
$$;

revoke execute on function api.generate_weekly_test(uuid, smallint, text, date, int, int, boolean, text) from public;
revoke execute on function api.class_topic_history(uuid, smallint, date) from public;
revoke execute on function api.save_bank_question(smallint, smallint, text, text, jsonb, smallint, text) from public;
revoke execute on function api.check_bank_question(uuid, smallint) from public;
grant  execute on function api.generate_weekly_test(uuid, smallint, text, date, int, int, boolean, text) to authenticated;
grant  execute on function api.class_topic_history(uuid, smallint, date) to authenticated;
grant  execute on function api.save_bank_question(smallint, smallint, text, text, jsonb, smallint, text) to authenticated;
grant  execute on function api.check_bank_question(uuid, smallint) to authenticated;

-- v3 revokes EXECUTE on new app.* functions from PUBLIC (default privileges),
-- so helpers used inside policies / invoker RPCs must be granted explicitly.
grant execute on function app.topic_key(text), app.is_staff_at(uuid), app.is_staff_anywhere(),
  app.review_interval_weeks(int, numeric), app.student_question_order(uuid, uuid) to authenticated;

-- OPEN (team decisions):
--  * Do review questions count toward the weekly score? Suggest: yes, the
--    weekly test is formative (no journal grade), so it does not matter much.
--  * Topic history is per class per academic year (classes are per year).
--    Cross-year review ("last year's fractions") needs curriculum topic ids.
