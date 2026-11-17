-- ============================================================================
-- MAKTAB+ round 4 — curriculum topics (platform data, no student data)
-- Used by ai-weekly-prep: own code picks the NEXT topics (rule 7, no AI),
-- then the Library is searched by topic, and only the rest goes to the AI.
-- The curriculum block is the same for every class of a subject+grade →
-- it is the cached part of the prompt.
-- CONTENT: load from the official state curriculum (methodologist). Do not
-- type topics from memory. Licence/reuse of official texts: check with a lawyer.
-- Parse-checked only (pglast), NOT run.
-- ============================================================================

alter table classes add column if not exists language text not null default 'uz'
  check (language in ('uz','ru','en'));                  -- V3-ADAPT: maybe already in v3

create table if not exists curriculum_topics (
  id          bigint generated always as identity primary key,
  subject_id  smallint not null references subjects(id),
  grade_level smallint not null check (grade_level between 1 and 11),
  language    text not null default 'uz' check (language in ('uz','ru','en')),
  seq         int not null,                              -- order in the school year
  term_no     smallint check (term_no between 1 and 4),
  hours       smallint not null default 1 check (hours between 1 and 20),  -- lessons for this topic
  topic       text not null,
  topic_key   text generated always as (app.topic_key(topic)) stored,       -- from weekly_tests_gen.sql
  objectives  text,                                      -- what students should be able to do
  source_ref  text,                                      -- document + page of the official programme
  unique (subject_id, grade_level, language, seq)
);
alter table curriculum_topics enable row level security;
drop policy if exists cur_read on curriculum_topics;
create policy cur_read on curriculum_topics for select to authenticated using (app.is_staff_anywhere());
drop policy if exists cur_write on curriculum_topics;
create policy cur_write on curriculum_topics for all to authenticated
  using (app.can_edit_library()) with check (app.can_edit_library());   -- V3-ADAPT: methodologist role
grant select, insert, update, delete on curriculum_topics to authenticated;

-- Whole programme for a subject+grade (the cached prompt block). Stable text order.
create or replace function api.curriculum_for(p_subject_id smallint, p_grade_level smallint,
                                              p_language text default 'uz')
returns table (seq int, term_no smallint, hours smallint, topic text, objectives text)
language sql stable security invoker set search_path = public, pg_temp as $$
  select ct.seq, ct.term_no, ct.hours, ct.topic, ct.objectives
  from curriculum_topics ct
  where ct.subject_id = p_subject_id and ct.grade_level = p_grade_level and ct.language = p_language
  order by ct.seq
$$;

-- The next p_n lesson topics for this class+subject: continue after the last
-- topic used in an APPROVED card; a topic with hours = 3 fills 3 lessons.
create or replace function api.next_topics(p_class_id uuid, p_subject_id smallint, p_n int default 5)
returns table (lesson_no int, seq int, topic text, objectives text)
language sql stable security invoker set search_path = public, pg_temp as $$
  with c as (select cl.grade_level, cl.language from classes cl where cl.id = p_class_id),
  prog as (
    select ct.* from curriculum_topics ct, c
    where ct.subject_id = p_subject_id and ct.grade_level = c.grade_level and ct.language = c.language
  ),
  done as (                                   -- how many lessons each topic already had
    select p.seq, count(*)::int as used
    from lesson_cards lc join prog p on p.topic_key = app.topic_key(lc.topic)
    where lc.class_id = p_class_id and lc.subject_id = p_subject_id and lc.status = 'approved'
    group by p.seq
  ),
  last_seq as (select coalesce(max(d.seq), 0) as s from done d),
  slots as (                                  -- remaining lessons, one row per lesson
    select p.seq, p.topic, p.objectives, g.i
    from prog p
    left join done d on d.seq = p.seq
    cross join last_seq ls
    cross join lateral generate_series(1, greatest(p.hours - coalesce(d.used, 0), 0)) g(i)
    where p.seq >= ls.s
  )
  select (row_number() over (order by s.seq, s.i))::int, s.seq, s.topic, s.objectives
  from slots s
  order by s.seq, s.i
  limit greatest(least(p_n, 30), 0)
$$;

revoke execute on function api.curriculum_for(smallint, smallint, text) from public;
revoke execute on function api.next_topics(uuid, smallint, int) from public;
grant  execute on function api.curriculum_for(smallint, smallint, text) to authenticated;
grant  execute on function api.next_topics(uuid, smallint, int) to authenticated;
