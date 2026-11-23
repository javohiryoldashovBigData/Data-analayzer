-- ============================================================================
-- MAKTAB+ — step 5: AI (weekly lesson drafts + "Mavzuni takrorlash")
-- Load after api_phase1.sql, curriculum.sql, school_api.sql.
--
-- Money rules (see PROJECT_BRIEF §6): every AI job is first RESERVED against
-- the person's budget AND the school's hard monthly cap (app.ai_reserve), then
-- sent overnight as one Batch (half price), then COMMITTED with the real cost.
-- No student names or grades ever go to the AI: lesson drafts get the topic
-- and class-level numbers; topic reviews get only the topic and grade.
-- ============================================================================

-- topic review is part of the teacher's (and school's) budget
insert into ai_plan_rules (plan, role, feature, monthly_limit_cents) values
  ('standard','teacher','topic_review', 100),
  ('pro','teacher','topic_review', 200)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 1. "Mavzuni takrorlash": one short explanation per class + topic, made when
--    the teacher marked students "didn't get it" in the exit check. Shown
--    only to those students (and their parents), the teacher and leadership.
-- ---------------------------------------------------------------------------
create table if not exists topic_reviews (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  class_id    uuid not null references classes(id) on delete cascade,
  subject_id  smallint not null references subjects(id),
  card_id     uuid references lesson_cards(id) on delete set null,
  teacher_id  uuid references teachers(id) on delete set null,
  topic       text not null,
  topic_key   text generated always as (app.topic_key(topic)) stored,
  student_ids uuid[] not null default '{}',        -- who didn't get it (never sent to the AI)
  content     jsonb not null,                       -- {title, steps[], example, try_it}
  status      library_status not null default 'ai_made',   -- "AI-made, not yet checked"
  created_at  timestamptz not null default now(),
  unique (class_id, subject_id, topic_key)
);
alter table topic_reviews enable row level security;
create policy reviews_select on topic_reviews for select to authenticated using (
  teacher_id = app.my_teacher_id()
  or app.manages_school(school_id)
  or exists (select 1 from students s where s.id = any (topic_reviews.student_ids)
             and (s.user_id = auth.uid()
                  or exists (select 1 from guardians g where g.student_id = s.id and g.parent_user_id = auth.uid())))
);
-- the teacher may correct the text (AI suggests, people decide)
create policy reviews_update on topic_reviews for update to authenticated
  using (teacher_id = app.my_teacher_id()) with check (teacher_id = app.my_teacher_id());
grant select, update (content) on topic_reviews to authenticated;

-- Jobs for the night worker (service role only): cards whose exit check has
-- "didn't get it" students, with a topic, and no review yet for that class+topic.
create or replace function app.ai_review_jobs(p_since date default current_date - 1)
returns table (card_id uuid, school_id uuid, class_id uuid, subject_id smallint, subject text,
               grade_level smallint, topic text, teacher_user_id uuid, students int)
language sql stable security definer set search_path = public as $$
  select distinct on (lc.class_id, lc.subject_id, app.topic_key(lc.topic))
         lc.id, lc.school_id, lc.class_id, lc.subject_id, sub.name_uz, c.grade_level, lc.topic, t.user_id,
         cardinality(ec.not_got)
  from exit_checks ec
  join lesson_cards lc on lc.id = ec.card_id
  join classes c on c.id = lc.class_id
  join subjects sub on sub.id = lc.subject_id
  join teachers t on t.id = lc.teacher_id
  join schools s on s.id = lc.school_id and s.is_active
  where ec.recorded_at >= p_since and cardinality(ec.not_got) > 0 and coalesce(lc.topic, '') <> ''
    and not exists (select 1 from topic_reviews tr where tr.class_id = lc.class_id
                    and tr.subject_id = lc.subject_id and tr.topic_key = app.topic_key(lc.topic))
    and not exists (select 1 from ai_reservations r where r.feature = 'topic_review' and r.status = 'pending'
                    and r.payload->>'card_id' = lc.id::text)
  order by lc.class_id, lc.subject_id, app.topic_key(lc.topic), ec.recorded_at desc
$$;

create or replace function app.ai_store_topic_review(p_res_id uuid, p_content jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare r ai_reservations%rowtype; lc lesson_cards%rowtype; v_id uuid;
begin
  select * into r from ai_reservations where id = p_res_id and feature = 'topic_review';
  if not found then raise exception 'reservation_not_found'; end if;
  select * into lc from lesson_cards where id = (r.payload->>'card_id')::uuid and school_id = r.school_id;
  if not found then raise exception 'card_not_found'; end if;
  insert into topic_reviews (school_id, class_id, subject_id, card_id, teacher_id, topic, student_ids, content)
  values (lc.school_id, lc.class_id, lc.subject_id, lc.id, lc.teacher_id, lc.topic,
          coalesce((select ec.not_got from exit_checks ec where ec.card_id = lc.id), '{}'),
          jsonb_build_object('title', left(p_content->>'title', 120),
                             'steps', (select coalesce(jsonb_agg(left(x, 300)), '[]'::jsonb)
                                       from jsonb_array_elements_text(coalesce(p_content->'steps', '[]')) x),
                             'example', left(p_content->>'example', 600),
                             'try_it', left(p_content->>'try_it', 300)))
  on conflict (class_id, subject_id, topic_key) do nothing
  returning id into v_id;
  -- tell the students who need it (quiet hours apply: not a safety kind)
  insert into notification_outbox (recipient_id, payload)
  select s.user_id, jsonb_build_object('kind', 'system', 'event', 'topic_review_ready', 'topic', lc.topic)
  from students s where v_id is not null and s.user_id is not null
    and s.id = any (coalesce((select ec.not_got from exit_checks ec where ec.card_id = lc.id), '{}'));
  return v_id;
end $$;

-- student / parent: my reviews of the last 14 days
create or replace function api.my_reviews()
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', tr.id, 'student_ids', tr.student_ids, 'subject', sub.name_uz, 'topic', tr.topic,
           'content', tr.content, 'status', tr.status, 'created_at', tr.created_at)
         order by tr.created_at desc), '[]'::jsonb)
  from topic_reviews tr join subjects sub on sub.id = tr.subject_id
  where tr.created_at >= now() - interval '14 days'
$$;

-- ---------------------------------------------------------------------------
-- 2. Budget overview (for the teacher's button and the director's screen)
-- ---------------------------------------------------------------------------
create or replace function api.ai_budget(p_feature text default 'lesson_prep')
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_school uuid; v_chk record;
begin
  select r.school_id into v_school from user_school_roles r
   where r.user_id = auth.uid() and r.is_active and r.school_id is not null limit 1;
  if v_school is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into v_chk from app.ai_check(v_school, p_feature);
  return jsonb_build_object(
    'allowed', v_chk.allowed, 'reason', v_chk.reason, 'plan', v_chk.plan,
    'my_remaining_cents', v_chk.remaining_cents, 'school_remaining_cents', v_chk.school_remaining_cents,
    'my_jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'feature', r.feature, 'status', r.status,
                         'lessons', jsonb_array_length(coalesce(r.payload->'lessons', '[]')),
                         'sent', r.batch_id is not null, 'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
                from (select * from ai_reservations r where r.user_id = auth.uid() order by created_at desc limit 5) r),
    'school', case when app.is_school_admin(v_school) then (
      select jsonb_build_object('cap_cents', s.ai_monthly_cap_cents,
               'used_cents', coalesce((select sum(u.cost_cents) from ai_usage_log u
                                       where u.school_id = s.id and u.created_at >= date_trunc('month', now())), 0),
               'requests', (select count(*) from ai_usage_log u
                            where u.school_id = s.id and u.created_at >= date_trunc('month', now())))
      from schools s where s.id = v_school) end);
end $$;

revoke execute on function app.ai_review_jobs(date), app.ai_store_topic_review(uuid, jsonb) from public, authenticated;
revoke execute on function api.my_reviews(), api.ai_budget(text) from public;
grant execute on function api.my_reviews(), api.ai_budget(text) to authenticated;
-- teachers read their own reservations (policy res_self_read from api_phase1)
grant execute on function app.ai_check(uuid, text) to authenticated;
