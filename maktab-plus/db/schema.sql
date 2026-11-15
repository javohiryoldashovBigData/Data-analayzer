-- ============================================================================
-- MAKTAB+ — schema v3 (PostgreSQL 15+ / self-hosted Supabase)
--
-- v2 was designed by Perplexity; v3 is the joint version (Perplexity + Claude).
-- Every problem found in testing v1 (brief §9) is fixed and marked "FIX #n".
-- v3 changes are marked "V3:" — see docs/06-v3-changes.md. Main ideas:
--   * ONE WINDOW PER SCHOOL: each school has its own address (slug), branding,
--     people and data. Nobody outside the school — not another school, not a
--     district admin, not even the platform super admin — can read its
--     personal data. Government admins get NUMBERS ONLY (app.school_stats).
--   * Parents and students see teachers' NAMES only (app.my_teachers()), never
--     phones. They contact a teacher through the school office (contact_requests).
--   * Weekly tests are cheat-proof: answer keys live in a separate table, and
--     scoring happens on the server (app.submit_attempt).
--
-- Deployment modes:
--   * Self-hosted Supabase in Uzbekistan: run schema.sql directly
--     (auth.users / auth.uid() already exist).
--   * Plain PostgreSQL 16 for development/testing: run local_compat.sql
--     FIRST to create the auth shim, then this file.
--
-- Golden rules in this file:
--   * Every function parameter is prefixed p_ (FIX #1: a parameter named
--     like a column silently loses to the column in SQL functions).
--   * RLS is enabled on EVERY table; tables with no policy = deny all
--     for the `authenticated` role (service role / table owner bypasses).
--   * SELECT/INSERT/UPDATE/DELETE are granted to authenticated and RLS
--     does the restricting (FIX #6: you cannot revoke your way to safety
--     and still have write policies).
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- ENUM TYPES
-- ---------------------------------------------------------------------------
-- V3: 'methodologist' = platform-level Library reviewer (no school scope).
create type user_role         as enum ('super_admin','methodologist','region_admin','district_admin','school_admin','director','zavuch','teacher','student','parent');
create type school_mode       as enum ('private','government');
create type school_type       as enum ('general','specialized','lyceum','gymnasium','evening');
create type gender            as enum ('m','f');
create type guardian_relation as enum ('father','mother','brother','sister','grandmother','grandfather','other');
create type member_status     as enum ('active','transferred','graduated','expelled');
create type attendance_status as enum ('present','absent','late','excused');
create type grade_weight      as enum ('current','quarter','exam','final');
create type gate_direction    as enum ('in','out');
create type gate_method       as enum ('qr','nfc','manual');
create type absence_status    as enum ('pending','accepted','rejected');
create type problem_severity  as enum ('small','serious');
create type problem_status    as enum ('open','handled','escalated');
create type card_status       as enum ('draft','ai_draft','approved');
create type library_kind      as enum ('animation','photo_board','material','worksheet','quiz','lesson_card');
create type library_status    as enum ('ai_made','under_review','checked');
create type test_status       as enum ('draft','published','closed');
create type attempt_mode      as enum ('paper','online');
create type flag_kind         as enum ('similar_answers','identical_wrong','level_jump','fast_answers','pasted_text','left_window');
create type flag_decision     as enum ('pending','dismissed','talked_to_student');   -- V3: teacher decides
create type contact_status    as enum ('open','forwarded','answered','closed');      -- V3: parent → school office
create type school_plan       as enum ('standard','pro');                             -- V3: AI plans
create type invoice_status    as enum ('issued','paid','overdue','cancelled');
create type pay_provider      as enum ('click','payme','cash');
create type pay_status        as enum ('pending','completed','failed');
create type admission_status  as enum ('applied','testing','interview','accepted','rejected','enrolled');
create type notification_kind as enum ('grade_posted','absence','homework','announcement','timetable_change','gate_in','gate_out','skipped_lesson','absence_report','fee_due','payment_received','test_result','problem','parent_message','system');
create type device_platform   as enum ('fcm_android','fcm_ios','telegram');

-- ---------------------------------------------------------------------------
-- 1. GEOGRAPHY & SCHOOLS
-- ---------------------------------------------------------------------------
create table regions (
  id       smallint primary key,
  name_uz  text not null,
  name_ru  text not null
);

create table districts (
  id        integer primary key,
  region_id smallint not null references regions(id) on delete restrict,
  name_uz   text not null,
  name_ru   text not null
);

create table schools (
  id          uuid primary key default gen_random_uuid(),
  district_id integer not null references districts(id) on delete restrict,
  name        text not null,
  mode        school_mode not null default 'private',      -- FIX #10.2: private / government
  school_type school_type not null default 'general',
  address     text,
  phone       text,
  settings    jsonb not null default '{}'::jsonb,
  -- V3: the school's own "window"
  slug        text not null unique                          -- school-a → school-a.maktabplus.uz
              check (slug ~ '^[a-z0-9]([a-z0-9-]{1,40}[a-z0-9])$'),
  logo_url    text,
  brand_color text not null default '#1d6fd8' check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  is_active   boolean not null default true,                -- false = window closed (unpaid, etc.)
  share_stats_with_government boolean not null default false, -- private schools opt in; check with a lawyer
  plan        school_plan not null default 'standard',      -- V3: Standard = AI for teachers; Pro = AI for everyone
  pro_trial_until date,                                     -- V3: free Pro trial (e.g. pilot school)
  created_at  timestamptz not null default now()
);
create index schools_district_idx on schools(district_id);

create table school_subscriptions (                        -- private-school billing
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references schools(id) on delete cascade,
  plan          text not null,
  status        text not null default 'active',
  valid_from    date not null,
  valid_until   date not null,
  price_monthly numeric(12,2) not null default 0,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. IDENTITY (extends auth.users)
-- ---------------------------------------------------------------------------
create table profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  first_name  text not null,
  last_name   text not null,
  middle_name text,
  phone       text unique,
  pinfl       char(14) unique,                            -- JShShIR; nullable for children
  birth_date  date,
  gender      gender,
  avatar_url  text,
  locale      text not null default 'uz',                 -- uz / ru / en
  created_at  timestamptz not null default now()
);

-- One row per (user, role, scope). Scope is exactly one of:
--   school_id   for school-scoped roles (school_admin/director/zavuch/teacher/student/parent)
--   district_id for district_admin
--   region_id   for region_admin
--   nothing     for super_admin
-- FIX #8: region/district admins are first-class; every access helper resolves scope.
create table user_school_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        user_role not null,
  school_id   uuid references schools(id) on delete cascade,
  district_id integer references districts(id) on delete cascade,
  region_id   smallint references regions(id) on delete cascade,
  is_active   boolean not null default true,
  granted_by  uuid references auth.users(id),
  granted_at  timestamptz not null default now(),
  constraint role_scope_chk check (
    ( role in ('school_admin','director','zavuch','teacher','student','parent')
      and school_id is not null and district_id is null and region_id is null )
    or ( role = 'district_admin' and district_id is not null and school_id is null and region_id is null )
    or ( role = 'region_admin' and region_id is not null and school_id is null and district_id is null )
    or ( role in ('super_admin','methodologist') and school_id is null and district_id is null and region_id is null )
  )
);
create unique index user_school_roles_scope_uk on user_school_roles (
  user_id, role,
  (coalesce(school_id, '00000000-0000-0000-0000-000000000000'::uuid)),
  (coalesce(district_id, -1)),
  (coalesce(region_id, -1))
);
create index user_school_roles_user_idx on user_school_roles(user_id) where is_active;

-- ---------------------------------------------------------------------------
-- 3. PEOPLE
-- ---------------------------------------------------------------------------
create table students (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete restrict,
  user_id     uuid unique references auth.users(id) on delete set null,  -- null for young kids
  pinfl       char(14) unique,
  first_name  text not null,
  last_name   text not null,
  middle_name text,
  gender      gender,
  birth_date  date,
  status      member_status not null default 'active',
  created_at  timestamptz not null default now()
);
create index students_school_status_idx on students(school_id, status);
create index students_user_idx on students(user_id);

create table guardians (
  id             uuid primary key default gen_random_uuid(),
  parent_user_id uuid not null references auth.users(id) on delete cascade,
  student_id     uuid not null references students(id) on delete cascade,
  relation       guardian_relation not null,
  is_primary     boolean not null default true,
  unique (parent_user_id, student_id)
);
create index guardians_student_idx on guardians(student_id);
create index guardians_parent_idx on guardians(parent_user_id);

create table teachers (
  id        uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete restrict,
  user_id   uuid unique references auth.users(id) on delete cascade,  -- assumption: one school per teacher
  status    text not null default 'active',
  created_at timestamptz not null default now()
);
create index teachers_school_idx on teachers(school_id);

-- ---------------------------------------------------------------------------
-- 4. ACADEMIC CALENDAR & CLASSES
-- ---------------------------------------------------------------------------
create table academic_years (
  id         smallint primary key,
  start_date date not null,
  end_date   date not null,
  is_current boolean not null default false
);

create table terms (                                       -- 4 chorak
  id               uuid primary key default gen_random_uuid(),
  academic_year_id smallint not null references academic_years(id) on delete cascade,
  number           smallint not null check (number between 1 and 4),
  start_date       date not null,
  end_date         date not null,
  is_current       boolean not null default false,
  unique (academic_year_id, number)
);

create table subjects (
  id      smallint primary key,
  name_uz text not null,
  name_ru text not null,
  code    text unique not null
);

create table grade_types (
  id       smallint primary key,
  code     grade_weight not null unique,
  label_uz text not null
);

create table classes (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references schools(id) on delete cascade,
  academic_year_id smallint not null references academic_years(id) on delete cascade,
  grade_level      smallint not null check (grade_level between 1 and 11),
  letter           char(1) not null,
  class_teacher_id uuid references teachers(id) on delete set null,     -- sinf rahbari
  unique (school_id, academic_year_id, grade_level, letter)
);
create index classes_school_year_idx on classes(school_id, academic_year_id);

create table class_members (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references classes(id) on delete cascade,
  student_id  uuid not null references students(id) on delete cascade,
  enrolled_at date not null default current_date,
  status      member_status not null default 'active',
  unique (class_id, student_id)
);
create index class_members_student_idx on class_members(student_id);
create index class_members_class_idx on class_members(class_id) where status = 'active';

create table rooms (
  id        uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name      text not null
);

create table bell_periods (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references schools(id) on delete cascade,
  number     smallint not null check (number between 1 and 9),
  start_time time not null,
  end_time   time not null,
  unique (school_id, number)
);

create table timetable_slots (
  id              uuid primary key default gen_random_uuid(),
  class_id        uuid not null references classes(id) on delete cascade,
  day_of_week     smallint not null check (day_of_week between 1 and 6),  -- Mon..Sat
  period          smallint not null check (period between 1 and 9),
  subject_id      smallint not null references subjects(id),
  teacher_id      uuid not null references teachers(id) on delete cascade,
  room_id         uuid references rooms(id) on delete set null,
  effective_from  date not null default current_date,
  effective_to    date,
  unique (class_id, day_of_week, period, effective_from)
);
create index timetable_class_day_idx on timetable_slots(class_id, day_of_week, period) where effective_to is null;
create index timetable_teacher_idx  on timetable_slots(teacher_id, day_of_week) where effective_to is null;
create unique index timetable_no_teacher_clash
  on timetable_slots(teacher_id, day_of_week, period, effective_from) where effective_to is null;

create table teacher_assignments (
  id               uuid primary key default gen_random_uuid(),
  teacher_id       uuid not null references teachers(id) on delete cascade,
  class_id         uuid not null references classes(id) on delete cascade,
  subject_id       smallint not null references subjects(id),
  academic_year_id smallint not null references academic_years(id) on delete cascade,
  unique (teacher_id, class_id, subject_id, academic_year_id)
);
create index teacher_assignments_teacher_idx on teacher_assignments(teacher_id, academic_year_id);

create table substitutions (                               -- zavuch: teacher is sick
  id                   uuid primary key default gen_random_uuid(),
  school_id            uuid not null references schools(id) on delete cascade,
  date                 date not null,
  period               smallint not null check (period between 1 and 9),
  class_id             uuid not null references classes(id) on delete cascade,
  subject_id           smallint not null references subjects(id),
  absent_teacher_id    uuid not null references teachers(id) on delete cascade,
  substitute_teacher_id uuid not null references teachers(id) on delete cascade,
  created_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  unique (school_id, date, period, class_id)
);

-- ---------------------------------------------------------------------------
-- 5. GRADES
-- ---------------------------------------------------------------------------
create table grades (
  id         bigint generated always as identity primary key,
  student_id uuid not null references students(id) on delete cascade,
  subject_id smallint not null references subjects(id),
  term_id    uuid not null references terms(id),
  grade_type grade_weight not null default 'current',
  value      smallint not null check (value between 1 and 5),
  teacher_id uuid not null references teachers(id),
  comment    text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz                                  -- soft delete keeps history
);
create index grades_report_idx   on grades(student_id, term_id, subject_id) where deleted_at is null;
create index grades_teacher_idx  on grades(teacher_id, created_at desc) where deleted_at is null;
create index grades_term_idx     on grades(term_id, subject_id) where deleted_at is null;

-- FIX #4: real table (not a matview) maintained by trigger in app.refresh_student_summary.
create table student_term_summary (
  student_id    uuid not null references students(id) on delete cascade,
  term_id       uuid not null references terms(id) on delete cascade,
  subject_id    smallint not null references subjects(id),
  current_count integer not null default 0,
  current_avg   numeric(4,2),
  quarter_grade smallint,
  exam_grade    smallint,
  final_grade   smallint,
  updated_at    timestamptz not null default now(),
  primary key (student_id, term_id, subject_id)
);
create index student_term_summary_term_idx on student_term_summary(term_id, subject_id);

-- ---------------------------------------------------------------------------
-- 6. ATTENDANCE (monthly range partitions)
-- ---------------------------------------------------------------------------
create table attendance_logs (
  id         bigint generated always as identity,
  student_id uuid not null references students(id) on delete cascade,
  class_id   uuid not null references classes(id) on delete cascade,
  date       date not null,
  period     smallint not null check (period between 1 and 9),
  subject_id smallint references subjects(id),
  teacher_id uuid references teachers(id),
  status     attendance_status not null,
  reason     text,
  marked_by  uuid not null references auth.users(id),
  marked_at  timestamptz not null default now(),
  primary key (id, date),
  unique (student_id, date, period)
) partition by range (date);

do $$
declare d date := date_trunc('month', current_date); i int;
begin
  for i in 0..11 loop
    execute format(
      'create table if not exists attendance_logs_%s partition of attendance_logs
       for values from (%L) to (%L)',
      to_char(d + (i || ' months')::interval, 'YYYY_MM'),
      d + (i || ' months')::interval,
      d + ((i+1) || ' months')::interval);
  end loop;
end $$;

create index attendance_class_date_idx on attendance_logs(class_id, date desc);
create index attendance_student_idx    on attendance_logs(student_id, date desc);

-- ---------------------------------------------------------------------------
-- 7. GATE CHECK-IN (school entry/exit ONLY — no GPS, per brief rule 4)
-- ---------------------------------------------------------------------------
create table gate_devices (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references schools(id) on delete cascade,
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table gate_events (
  id         bigint generated always as identity,
  school_id  uuid not null references schools(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  direction  gate_direction not null,
  method     gate_method not null default 'qr',
  device_id  uuid references gate_devices(id),
  scanned_at timestamptz not null default now(),
  primary key (id, scanned_at)
) partition by range (scanned_at);

do $$
declare d date := date_trunc('month', current_date); i int;
begin
  for i in 0..11 loop
    execute format(
      'create table if not exists gate_events_%s partition of gate_events
       for values from (%L) to (%L)',
      to_char(d + (i || ' months')::interval, 'YYYY_MM'),
      (d + (i || ' months')::interval)::timestamptz,
      (d + ((i+1) || ' months')::interval)::timestamptz);
  end loop;
end $$;

create index gate_events_student_idx on gate_events(student_id, scanned_at desc);
create index gate_events_school_idx  on gate_events(school_id, scanned_at desc);

create table parent_absence_reports (                      -- parent reports absence in advance
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references schools(id) on delete cascade,
  student_id   uuid not null references students(id) on delete cascade,
  parent_user_id uuid not null references auth.users(id),
  absence_date date not null,
  reason       text,
  status       absence_status not null default 'pending',
  reviewed_by  uuid references auth.users(id),            -- homeroom teacher / zavuch
  review_note  text,
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  constraint reviewed_requires_decision check (
    status = 'pending' or reviewed_by is not null)
);
create index parent_absence_reports_idx on parent_absence_reports(school_id, absence_date desc);

create table skipped_lesson_events (                      -- in building but marked absent
  id             bigint generated always as identity primary key,
  school_id      uuid not null references schools(id) on delete cascade,
  student_id     uuid not null references students(id) on delete cascade,
  class_id       uuid not null references classes(id) on delete cascade,
  date           date not null,
  period         smallint not null,
  attendance_id  bigint,
  detected_at    timestamptz not null default now(),
  resolved_at    timestamptz,
  unique (student_id, date, period)
);

-- ---------------------------------------------------------------------------
-- 8. ZAVUCH PROBLEM INBOX & LESSON CARDS
-- ---------------------------------------------------------------------------
create table problems (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  raised_by   uuid not null references auth.users(id),
  category    text not null,                              -- grades_missing, plan_missing, homework_missing…
  severity    problem_severity not null,
  description text not null,
  ref_table   text,
  ref_id      text,
  status      problem_status not null default 'open',
  assigned_to uuid references auth.users(id),             -- zavuch handling it
  escalated_to uuid references auth.users(id),            -- director
  resolution  text,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index problems_school_idx on problems(school_id, status, created_at desc);

create table lesson_cards (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  class_id    uuid not null references classes(id) on delete cascade,
  subject_id  smallint not null references subjects(id),
  teacher_id  uuid not null references teachers(id) on delete cascade,
  lesson_date date not null,
  period      smallint not null check (period between 1 and 9),
  topic       text,
  plan        text,                                       -- lesson plan
  questions   jsonb,                                      -- who to ask first, prompts
  homework    text,
  materials   jsonb not null default '[]'::jsonb,         -- library_item ids
  status      card_status not null default 'draft',
  ai_generated boolean not null default false,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index lesson_cards_class_date_idx on lesson_cards(class_id, lesson_date);
create index lesson_cards_teacher_idx    on lesson_cards(teacher_id, lesson_date);

-- ---------------------------------------------------------------------------
-- 9. HOMEWORK & ANNOUNCEMENTS
-- ---------------------------------------------------------------------------
create table homework (
  id             uuid primary key default gen_random_uuid(),
  class_id       uuid not null references classes(id) on delete cascade,
  subject_id     smallint not null references subjects(id),
  teacher_id     uuid not null references teachers(id) on delete cascade,
  assigned_at    date not null default current_date,
  due_date       date not null,
  description    text not null,
  attachment_url text,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index homework_class_due_idx on homework(class_id, due_date desc) where deleted_at is null;

create table announcements (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references schools(id) on delete cascade,
  class_id     uuid references classes(id) on delete cascade,
  author_id    uuid not null references auth.users(id),
  title        text not null,
  body         text not null,
  published_at timestamptz not null default now()
);
create index announcements_school_idx on announcements(school_id, published_at desc);

-- ---------------------------------------------------------------------------
-- 10. WEEKLY TESTS & INTEGRITY FLAGS
-- ---------------------------------------------------------------------------
create table weekly_tests (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references schools(id) on delete cascade,
  class_id   uuid not null references classes(id) on delete cascade,
  subject_id smallint not null references subjects(id),
  teacher_id uuid not null references teachers(id) on delete cascade,
  term_id    uuid not null references terms(id),
  test_date  date not null,
  topic      text,
  status     test_status not null default 'draft',
  created_at timestamptz not null default now()
);
create index weekly_tests_class_idx on weekly_tests(class_id, test_date desc);

create table test_questions (
  id            uuid primary key default gen_random_uuid(),
  test_id       uuid not null references weekly_tests(id) on delete cascade,
  question_text text not null,
  options       jsonb not null,                           -- ["a","b","c","d"]
  points        smallint not null default 1,
  position      smallint not null
);
create index test_questions_test_idx on test_questions(test_id, position);

-- V3 (hole A4): the answer key is in its own table so students can read the
-- questions without the correct answers. Students see keys only after the
-- test is closed ("see answers").
create table test_answer_keys (
  question_id   uuid primary key references test_questions(id) on delete cascade,
  correct_index smallint not null
);

create table test_attempts (
  id           uuid primary key default gen_random_uuid(),
  test_id      uuid not null references weekly_tests(id) on delete cascade,
  student_id   uuid not null references students(id) on delete cascade,
  mode         attempt_mode not null default 'online',
  started_at   timestamptz not null default now(),
  submitted_at timestamptz,
  score        numeric(5,2)
);
create index test_attempts_test_idx on test_attempts(test_id);
create unique index test_attempts_once on test_attempts(test_id, student_id);

create table attempt_answers (                            -- per-student question order (FIX #10.2)
  id          uuid primary key default gen_random_uuid(),
  attempt_id  uuid not null references test_attempts(id) on delete cascade,
  question_id uuid not null references test_questions(id) on delete cascade,
  position    smallint not null,                          -- shuffled per student
  answer      jsonb,
  is_correct  boolean,
  unique (attempt_id, question_id)
);

create table integrity_flags (                            -- signals ONLY, teacher decides (rule 1)
  id           uuid primary key default gen_random_uuid(),
  test_id      uuid not null references weekly_tests(id) on delete cascade,
  attempt_id   uuid references test_attempts(id) on delete cascade,
  student_id   uuid not null references students(id) on delete cascade,
  kind         flag_kind not null,
  details      jsonb not null default '{}'::jsonb,
  teacher_seen boolean not null default false,
  decision     flag_decision not null default 'pending',  -- V3: the teacher decides (rule 1)
  created_at   timestamptz not null default now()
);
create index integrity_flags_test_idx on integrity_flags(test_id, teacher_seen);

-- ---------------------------------------------------------------------------
-- 11. THE LIBRARY
-- ---------------------------------------------------------------------------
create table library_items (
  id               uuid primary key default gen_random_uuid(),
  subject_id       smallint references subjects(id),
  grade_level      smallint check (grade_level between 1 and 11),
  topic            text not null,
  kind             library_kind not null,
  title            text not null,
  description      text,
  language         text not null default 'uz',
  content_url      text,                                  -- animation file, image…
  content          jsonb not null default '{}'::jsonb,    -- graph spec, quiz body…
  status           library_status not null default 'ai_made',  -- "AI-made, not yet checked"
  author_user_id   uuid references auth.users(id),
  origin_school_id uuid references schools(id) on delete set null,  -- V3: who made it (null = platform)
  methodologist_id uuid references auth.users(id),
  reviewed_at      timestamptz,
  usage_count      integer not null default 0,
  created_at       timestamptz not null default now()
);
create index library_items_lookup_idx on library_items(subject_id, grade_level, kind, status);

-- ---------------------------------------------------------------------------
-- 12. AI USAGE & QUOTAS (server-side AI only; keys never in browser)
-- ---------------------------------------------------------------------------
create table ai_usage_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  school_id  uuid references schools(id) on delete set null,
  feature    text not null,                               -- yordamchi, exam_check, lesson_prep…
  model      text not null,
  tokens_in  integer not null default 0,
  tokens_out integer not null default 0,
  cost_cents numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);
create index ai_usage_log_user_idx on ai_usage_log(user_id, created_at desc);

create table ai_quotas (                                  -- V3: optional per-user OVERRIDE of the plan limit
  user_id             uuid primary key references auth.users(id) on delete cascade,
  monthly_limit_cents numeric(10,2) not null default 500,
  note                text
);

-- V3: which AI features each plan gives to each role, and the monthly budget
-- per person. The server calls app.ai_check() BEFORE every AI request and
-- writes ai_usage_log AFTER it. Product settings, not school data.
-- LIMITS ARE PLACEHOLDER ESTIMATES (US cents / person / month) — set real
-- numbers after measuring the pilot.
create table ai_plan_rules (
  plan                school_plan not null,
  role                user_role   not null,
  feature             text        not null,
  monthly_limit_cents numeric(10,2) not null,
  primary key (plan, role, feature)
);
insert into ai_plan_rules (plan, role, feature, monthly_limit_cents) values
  -- STANDARD: AI for teaching only. Everyone else uses free features made by our own code.
  ('standard','teacher','lesson_prep',    200),   -- weekly lesson-card drafts (batched once a week)
  ('standard','teacher','lesson_card',    200),   -- edit / improve one card
  ('standard','teacher','test_build',     200),   -- weekly test from topics taught
  ('standard','teacher','photo_board',    100),   -- textbook photo → exact graph on the projector
  ('standard','zavuch', 'weekly_report',  100),
  -- PRO: everything in Standard with higher limits, plus AI for everyone.
  ('pro','teacher','lesson_prep',   400),
  ('pro','teacher','lesson_card',   400),
  ('pro','teacher','test_build',    400),
  ('pro','teacher','photo_board',   200),
  ('pro','teacher','exam_check',    600),         -- reading exam photos (strongest model)
  ('pro','zavuch', 'weekly_report', 200),
  ('pro','director','monthly_report',200),
  ('pro','student','tutor',          60),         -- AI tutor at home (explains, never hands over answers)
  ('pro','student','photo_learn',    40),
  ('pro','parent', 'weekly_report',  10);

-- ---------------------------------------------------------------------------
-- 13. PRIVATE-SCHOOL PAYMENTS & ADMISSIONS
-- ---------------------------------------------------------------------------
create table fee_invoices (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references schools(id) on delete cascade,
  student_id   uuid not null references students(id) on delete cascade,
  period_month date not null,                             -- first day of month
  amount       numeric(12,2) not null check (amount >= 0),
  currency     text not null default 'UZS',
  due_date     date not null,
  status       invoice_status not null default 'issued',
  created_at   timestamptz not null default now(),
  unique (school_id, student_id, period_month)
);
create index fee_invoices_student_idx on fee_invoices(student_id, period_month);

create table payments (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references fee_invoices(id) on delete cascade,
  amount       numeric(12,2) not null check (amount > 0),
  provider     pay_provider not null,
  provider_ref text,                                      -- Click/Payme transaction id
  status       pay_status not null default 'pending',
  paid_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index payments_invoice_idx on payments(invoice_id);

create table admission_applications (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references schools(id) on delete cascade,
  first_name    text not null,
  last_name     text not null,
  birth_date    date not null,
  gender        gender,
  parent_phone  text not null,
  parent_email  text,
  status        admission_status not null default 'applied',
  test_score    numeric(5,2),
  interview_notes text,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index admission_school_idx on admission_applications(school_id, status);

-- ---------------------------------------------------------------------------
-- 13b. V3: PARENT → SCHOOL OFFICE MESSAGES
-- Parents see teachers' names only. To reach a teacher they write to the
-- school office (school_admin / director / zavuch), who answers or forwards.
-- ---------------------------------------------------------------------------
create table contact_requests (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references schools(id) on delete cascade,
  student_id        uuid not null references students(id) on delete cascade,
  parent_user_id    uuid not null references auth.users(id) on delete cascade,
  about_teacher_id  uuid references teachers(id) on delete set null,  -- optional: "about the math teacher"
  topic             text not null,
  body              text not null,
  status            contact_status not null default 'open',
  forwarded_to      uuid references teachers(id) on delete set null,  -- office forwards to a teacher
  handled_by        uuid references auth.users(id),
  reply             text,
  created_at        timestamptz not null default now(),
  answered_at       timestamptz
);
create index contact_requests_school_idx on contact_requests(school_id, status, created_at desc);
create index contact_requests_parent_idx on contact_requests(parent_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 14. NOTIFICATIONS (outbox pattern; FIX #5: PK includes partition key)
-- ---------------------------------------------------------------------------
create table devices (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  platform         device_platform not null,
  token            text,
  telegram_chat_id text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (user_id, platform, token)
);

create table notification_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind    notification_kind not null,
  channel device_platform not null,
  enabled boolean not null default true,
  primary key (user_id, kind, channel)
);

create table notifications (
  id           uuid not null default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  school_id    uuid references schools(id),
  kind         notification_kind not null,
  title        text not null,
  body         text,
  data         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  primary key (id, recipient_id)                          -- FIX #5: partition key in PK
) partition by hash (recipient_id);
create table notifications_0 partition of notifications for values with (modulus 4, remainder 0);
create table notifications_1 partition of notifications for values with (modulus 4, remainder 1);
create table notifications_2 partition of notifications for values with (modulus 4, remainder 2);
create table notifications_3 partition of notifications for values with (modulus 4, remainder 3);
create index notifications_inbox_idx on notifications(recipient_id, created_at desc);

create table notification_outbox (
  id           bigint generated always as identity primary key,
  recipient_id uuid not null,
  payload      jsonb not null,
  status       text not null default 'pending',
  attempts     smallint not null default 0,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index outbox_pending_idx on notification_outbox(status) where status = 'pending';

-- ---------------------------------------------------------------------------
-- 15. AUDIT LOG (FIX #7: populated by triggers on grades)
-- ---------------------------------------------------------------------------
create table audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id),
  school_id  uuid,
  table_name text not null,
  row_id     text not null,
  action     text not null,
  old_value  jsonb,
  new_value  jsonb,
  created_at timestamptz not null default now()
);
create index audit_user_time_idx on audit_log(user_id, created_at desc);
create index audit_school_idx   on audit_log(school_id, created_at desc);

-- ============================================================================
-- ACCESS HELPERS — all SECURITY DEFINER, all parameters prefixed p_
-- (FIX #1: parameter names can never shadow column names)
-- ============================================================================
create schema if not exists app;

create or replace function app.my_teacher_id()
returns uuid language sql stable security definer set search_path = public as $$
  select t.id from teachers t
  join schools s on s.id = t.school_id and s.is_active      -- V3: closed window = no access
  where t.user_id = auth.uid() and t.status = 'active' limit 1
$$;

-- V3 — ONE WINDOW PER SCHOOL. Only people with a role INSIDE the school pass
-- these checks. District/region/super admins are NOT members of any school:
-- they never see names, grades or attendance. Government admins get numbers
-- through app.school_stats(); platform staff work through the service role,
-- which is audited.
-- A school whose window is closed (is_active = false) lets nobody in.

-- Any active role inside this (open) school.
create or replace function app.member_at(p_school_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_school_roles r
    join schools s on s.id = r.school_id and s.is_active
    where r.user_id = auth.uid()
      and r.is_active
      and r.school_id = p_school_id
  )
$$;

-- School leadership inside this school: school_admin, director, zavuch.
create or replace function app.manages_school(p_school_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_school_roles r
    join schools s on s.id = r.school_id and s.is_active
    where r.user_id = auth.uid()
      and r.is_active
      and r.role in ('school_admin','director','zavuch')
      and r.school_id = p_school_id
  )
$$;

-- V3: top of the school only (school_admin, director): staff roles, settings,
-- branding, billing. A zavuch cannot make anyone (or themselves) an admin.
create or replace function app.is_school_admin(p_school_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_school_roles r
    join schools s on s.id = r.school_id and s.is_active
    where r.user_id = auth.uid()
      and r.is_active
      and r.role in ('school_admin','director')
      and r.school_id = p_school_id
  )
$$;

-- V3: staff = leadership + teachers (not parents/students).
create or replace function app.is_staff_at(p_school_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_school_roles r
    join schools s on s.id = r.school_id and s.is_active
    where r.user_id = auth.uid()
      and r.is_active
      and r.role in ('school_admin','director','zavuch','teacher')
      and r.school_id = p_school_id
  )
$$;

-- V3: which school a class belongs to (used to stop rows claiming the wrong school).
create or replace function app.class_school(p_class_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select c.school_id from classes c where c.id = p_class_id
$$;

create or replace function app.teacher_school(p_teacher_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select t.school_id from teachers t where t.id = p_teacher_id
$$;

create or replace function app.student_school(p_student_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.school_id from students s where s.id = p_student_id
$$;

-- V3: caller is a student of this class, or a parent of one.
create or replace function app.in_class(p_class_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from class_members cm
    join students s on s.id = cm.student_id
    where cm.class_id = p_class_id
      and cm.status = 'active'
      and ( s.user_id = auth.uid()
         or exists (select 1 from guardians g
                    where g.student_id = s.id and g.parent_user_id = auth.uid()) )
  )
$$;

create or replace function app.is_methodologist()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_school_roles r
                 where r.user_id = auth.uid() and r.is_active and r.role = 'methodologist')
$$;

-- Caller teaches p_subject (null = any subject) to this student's active class.
create or replace function app.teaches(p_student_id uuid, p_subject_id smallint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from class_members cm
    join teacher_assignments ta on ta.class_id = cm.class_id
    where cm.student_id = p_student_id
      and cm.status = 'active'
      and ta.teacher_id = app.my_teacher_id()
      and (p_subject_id is null or ta.subject_id = p_subject_id)
  )
$$;

create or replace function app.is_class_teacher_of(p_student_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from class_members cm
    join classes c on c.id = cm.class_id
    where cm.student_id = p_student_id
      and cm.status = 'active'
      and c.class_teacher_id = app.my_teacher_id()
  )
$$;

-- Central read primitive: self / guardian / school leadership / own teachers.
create or replace function app.can_see_student(p_student_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from students s
    join schools sc on sc.id = s.school_id and sc.is_active  -- V3: closed window = no access
    where s.id = p_student_id
      and ( s.user_id = auth.uid()
         or exists (select 1 from guardians g
                    where g.student_id = s.id and g.parent_user_id = auth.uid())
         or app.manages_school(s.school_id)
         or app.teaches(p_student_id, null)
         or app.is_class_teacher_of(p_student_id) )
  )
$$;

-- Class-level teaching authority (used by lesson card / test / homework writes).
create or replace function app.teaches_class(p_class_id uuid, p_subject_id smallint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from teacher_assignments ta
    where ta.class_id = p_class_id
      and ta.teacher_id = app.my_teacher_id()
      and (p_subject_id is null or ta.subject_id = p_subject_id)
  )
$$;

create or replace function app.is_class_teacher_of_class(p_class_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from classes c
    where c.id = p_class_id and c.class_teacher_id = app.my_teacher_id()
  )
$$;

-- Superuser / teacher-at-school / district / region checks.
-- IMPORTANT: policies must NEVER inline-subquery user_school_roles (or the
-- table a policy is defined on) — PostgreSQL aborts with
-- "infinite recursion detected in policy". Always use these helpers.
create or replace function app.is_super()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_school_roles r
                 where r.user_id = auth.uid() and r.is_active and r.role = 'super_admin')
$$;

create or replace function app.is_teacher_at(p_school_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_school_roles r
                 where r.user_id = auth.uid() and r.is_active
                   and r.role = 'teacher' and r.school_id = p_school_id)
$$;

create or replace function app.manages_district(p_district_id integer)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_school_roles r
    where r.user_id = auth.uid() and r.is_active
      and ( r.role = 'super_admin'
         or (r.role = 'district_admin' and r.district_id = p_district_id)
         or (r.role = 'region_admin' and r.region_id =
              (select d.region_id from districts d where d.id = p_district_id)) )
  )
$$;

create or replace function app.manages_region(p_region_id smallint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_school_roles r
    where r.user_id = auth.uid() and r.is_active
      and ( r.role = 'super_admin'
         or (r.role = 'region_admin' and r.region_id = p_region_id) )
  )
$$;

-- V3: full profiles (with phone numbers):
--   * yourself;
--   * school leadership: everyone in their own school (they run the office);
--   * teachers: their colleagues (staff of the same school) only.
-- Parents and students never read other people's profiles. They get teachers'
-- NAMES from app.my_teachers() and reach teachers via contact_requests.
create or replace function app.can_see_profile(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user_id = auth.uid()
     or exists (
       select 1
       from user_school_roles theirs
       where theirs.user_id = p_user_id
         and theirs.is_active
         and theirs.school_id is not null
         and ( app.manages_school(theirs.school_id)
            or ( theirs.role in ('school_admin','director','zavuch','teacher')
                 and app.is_staff_at(theirs.school_id) ) ) )
$$;

-- V3: teacher NAMES for parents and students (no phone, no other details):
-- the teachers of the caller's own class / children's classes.
create or replace function app.my_teachers()
returns table (student_id uuid, teacher_id uuid, first_name text, last_name text,
               subject_id smallint, is_class_teacher boolean)
language sql stable security definer set search_path = public as $$
  with kids as (
    select s.id from students s
    where s.user_id = auth.uid()
       or exists (select 1 from guardians g where g.student_id = s.id and g.parent_user_id = auth.uid())
  ), links as (
    select cm.student_id, ta.teacher_id, ta.subject_id, false as is_class_teacher
    from class_members cm join teacher_assignments ta on ta.class_id = cm.class_id
    where cm.student_id in (select id from kids) and cm.status = 'active'
    union
    select cm.student_id, c.class_teacher_id, null::smallint, true
    from class_members cm join classes c on c.id = cm.class_id
    where cm.student_id in (select id from kids) and cm.status = 'active'
      and c.class_teacher_id is not null
  )
  select l.student_id, l.teacher_id, p.first_name, p.last_name, l.subject_id, l.is_class_teacher
  from links l
  join teachers t on t.id = l.teacher_id
  join schools sc on sc.id = t.school_id and sc.is_active
  join profiles p on p.user_id = t.user_id
$$;

-- V3: attendance authority for one row (used by insert AND update checks).
create or replace function app.can_mark_attendance(p_student_id uuid, p_class_id uuid, p_subject_id smallint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from class_members cm
                 where cm.student_id = p_student_id and cm.class_id = p_class_id
                   and cm.status = 'active')
     and ( app.manages_school(app.student_school(p_student_id))
        or app.is_class_teacher_of(p_student_id)
        or (p_subject_id is not null and app.teaches(p_student_id, p_subject_id)) )
$$;

-- V3: the login page of a school window needs its name/logo BEFORE login.
-- Only public branding comes out — nothing else about the school.
create or replace function app.school_window(p_slug text)
returns table (school_id uuid, name text, logo_url text, brand_color text, mode school_mode)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.logo_url, s.brand_color, s.mode
  from schools s where s.slug = lower(p_slug) and s.is_active
$$;

-- V3: the windows this user may enter (school picker after login).
create or replace function app.my_schools()
returns table (school_id uuid, slug text, name text, roles user_role[])
language sql stable security definer set search_path = public as $$
  select s.id, s.slug, s.name, array_agg(r.role order by r.role)
  from user_school_roles r join schools s on s.id = r.school_id and s.is_active
  where r.user_id = auth.uid() and r.is_active
  group by s.id, s.slug, s.name
$$;

-- V3: government dashboards get NUMBERS ONLY, never names.
-- Government schools: always. Private schools: only if they opted in
-- (share_stats_with_government) — check with a lawyer what the law requires.
create or replace function app.school_stats(p_school_id uuid, p_from date default current_date - 30)
returns table (students bigint, attendance_rate numeric, avg_current_grade numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_school schools%rowtype;
begin
  select * into v_school from schools where id = p_school_id;
  if not found
     or not (app.manages_school(p_school_id) or app.manages_district(v_school.district_id))
     or (v_school.mode = 'private' and not v_school.share_stats_with_government
         and not app.manages_school(p_school_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select (select count(*) from students s where s.school_id = p_school_id and s.status = 'active'),
           (select round(100.0 * count(*) filter (where a.status in ('present','late'))
                     / nullif(count(*), 0), 1)
              from attendance_logs a join classes c on c.id = a.class_id
             where c.school_id = p_school_id and a.date >= p_from),
           (select round(avg(g.value), 2)
              from grades g join students s on s.id = g.student_id
             where s.school_id = p_school_id and g.grade_type = 'current'
               and g.deleted_at is null and g.created_at >= p_from);
end $$;

-- V3: student finishes a test. Scoring happens HERE, on the server, against
-- the hidden answer key — the student can never write a score (holes A5, A6).
create or replace function app.submit_attempt(p_attempt_id uuid)
returns numeric language plpgsql volatile security definer set search_path = public as $$
declare v_score numeric(5,2);
begin
  if not exists (
    select 1 from test_attempts ta
    join students s on s.id = ta.student_id
    join weekly_tests wt on wt.id = ta.test_id
    where ta.id = p_attempt_id and s.user_id = auth.uid()
      and ta.submitted_at is null and wt.status = 'published') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update attempt_answers aa
     set is_correct = (aa.answer = to_jsonb(k.correct_index))
    from test_answer_keys k
   where aa.attempt_id = p_attempt_id and k.question_id = aa.question_id;
  select round(100.0 * coalesce(sum(q.points) filter (where aa.is_correct), 0)
               / nullif(sum(q.points), 0), 2)
    into v_score
    from test_attempts ta
    join test_questions q on q.test_id = ta.test_id
    left join attempt_answers aa on aa.attempt_id = ta.id and aa.question_id = q.id
   where ta.id = p_attempt_id;
  update test_attempts set submitted_at = now(), score = coalesce(v_score, 0)
   where id = p_attempt_id;
  return coalesce(v_score, 0);
end $$;

-- ============================================================================
-- ROW LEVEL SECURITY — enable on EVERY table (FIX #3)
-- Tables with no policy below intentionally deny everything to `authenticated`
-- (notification_outbox, ai_usage_log, audit_log writes, integrity_flags
-- writes, gate writes, payments writes…) — those paths run as the service
-- role (table owner), which bypasses RLS.
-- ============================================================================
do $$
declare t text;
begin
  for t in select c.relname from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p')
             and c.relrowsecurity = false
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---- reference data (non-sensitive): readable by any authenticated user ----
alter table regions     enable row level security;
alter table districts   enable row level security;
alter table subjects    enable row level security;
alter table grade_types enable row level security;
create policy ref_read_regions   on regions     for select to authenticated using (true);
create policy ref_read_districts on districts   for select to authenticated using (true);
create policy ref_read_subjects  on subjects    for select to authenticated using (true);
create policy ref_read_gtypes    on grade_types for select to authenticated using (true);

-- ---- organization (V3: one window per school) ----
-- A user sees only the schools they belong to. The public login page uses
-- app.school_window(slug), which returns branding only.
create policy schools_read   on schools for select to authenticated using (app.member_at(id) or app.is_super());
create policy schools_insert on schools for insert to authenticated with check (app.is_super());
create policy schools_update on schools for update to authenticated
  using (app.is_school_admin(id) or app.is_super()) with check (app.is_school_admin(id) or app.is_super());
create policy schools_delete on schools for delete to authenticated using (app.is_super());
create policy subs_read     on school_subscriptions for select to authenticated using (app.is_school_admin(school_id) or app.is_super());
create policy years_read    on academic_years for select to authenticated using (true);
create policy terms_read    on terms        for select to authenticated using (true);
create policy rooms_read    on rooms        for select to authenticated using (app.member_at(school_id));
create policy rooms_write   on rooms        for all    to authenticated using (app.manages_school(school_id));
create policy bells_read    on bell_periods for select to authenticated using (app.member_at(school_id));
create policy bells_write   on bell_periods for all    to authenticated using (app.manages_school(school_id));

-- ---- identity ----
create policy profiles_select on profiles for select to authenticated using (app.can_see_profile(user_id));
create policy profiles_write  on profiles for all    to authenticated using (user_id = auth.uid());

create policy roles_select on user_school_roles for select to authenticated using (
  user_id = auth.uid()
  or app.is_super()
  or (school_id is not null and app.manages_school(school_id))
  or (district_id is not null and app.manages_district(district_id))
  or (region_id is not null and app.manages_region(region_id))
);
-- V3: only school_admin/director hand out school roles (a zavuch could make
-- themselves admin before). Super admin creates the first school admin and
-- the district/region/methodologist roles.
create policy roles_write on user_school_roles for all to authenticated using (
  app.is_super() or (school_id is not null and app.is_school_admin(school_id))
) with check (
  app.is_super()
  or ( school_id is not null and app.is_school_admin(school_id)
       and role in ('school_admin','director','zavuch','teacher','student','parent') )
);

-- ---- people ----
create policy students_read  on students  for select to authenticated using (app.can_see_student(id));
create policy students_write on students  for all    to authenticated using (app.manages_school(school_id));

create policy guardians_read on guardians for select to authenticated using (
  parent_user_id = auth.uid() or app.can_see_student(student_id)
);
create policy guardians_write on guardians for all to authenticated using (
  app.manages_school(app.student_school(student_id)));

-- V3: the teachers table is staff-only; parents get names via app.my_teachers().
create policy teachers_read  on teachers  for select to authenticated using (app.is_staff_at(school_id));
create policy teachers_write on teachers  for all    to authenticated using (app.manages_school(school_id));

-- ---- classes & timetable ----
create policy classes_read  on classes for select to authenticated using (app.member_at(school_id));
create policy classes_write on classes for all    to authenticated using (app.manages_school(school_id));

-- V3: rosters are staff-only; a parent/student sees only their own row.
create policy cmembers_read on class_members for select to authenticated using (
  app.can_see_student(student_id) or app.is_staff_at(app.class_school(class_id))
);
create policy cmembers_write on class_members for all to authenticated using (
  app.manages_school(app.class_school(class_id)));

create policy timetable_read  on timetable_slots for select to authenticated using (
  app.member_at(app.class_school(class_id)));
create policy timetable_write on timetable_slots for all to authenticated using (
  app.manages_school(app.class_school(class_id)));

create policy tassign_read on teacher_assignments for select to authenticated using (
  app.member_at(app.class_school(class_id)));
create policy tassign_write on teacher_assignments for all to authenticated using (
  app.manages_school(app.class_school(class_id)));

create policy subst_read  on substitutions for select to authenticated using (app.is_staff_at(school_id));
create policy subst_write on substitutions for all    to authenticated using (app.manages_school(school_id));

-- ---- grades ----
create policy grades_select on grades for select to authenticated using (app.can_see_student(student_id));
-- V3 grade authority (hole A8):
--   * subject teacher: current / exam / quarter grades in the subject they teach
--     to this student's class (class-teacher status no longer lets you grade
--     subjects you don't teach);
--   * final (yearly) grade: school leadership only (zavuch/director confirm).
--     ASSUMPTION — change here if the school wants teachers to post finals.
--   * the term must belong to the student's class's academic year;
--   * created_by is always the caller.
create policy grades_insert on grades for insert to authenticated with check (
  created_by = auth.uid()
  and exists (
    select 1
    from terms t
    join classes c on c.academic_year_id = t.academic_year_id
    join class_members cm on cm.class_id = c.id
         and cm.student_id = grades.student_id and cm.status = 'active'
    where t.id = grades.term_id )
  and (
    ( teacher_id = app.my_teacher_id()
      and grade_type <> 'final'
      and app.teaches(student_id, subject_id) )
    or
    ( app.manages_school(app.student_school(student_id))
      and app.teacher_school(teacher_id) = app.student_school(student_id) ) )
);
create policy grades_update on grades for update to authenticated using (
  app.manages_school(app.student_school(student_id))
  or ( teacher_id = app.my_teacher_id() and app.teaches(student_id, subject_id) )
) with check (
  app.manages_school(app.student_school(student_id))
  or ( teacher_id = app.my_teacher_id() and grade_type <> 'final'
       and app.teaches(student_id, subject_id) )
);
-- no DELETE policy for authenticated: corrections are soft deletes via UPDATE.

-- ---- summary (real table now; same visibility as grades) ----
create policy summary_select on student_term_summary
  for select to authenticated using (app.can_see_student(student_id));

-- ---- attendance ----
create policy attendance_select on attendance_logs
  for select to authenticated using (app.can_see_student(student_id));
-- V3: one helper for insert AND update, so an update can never move a row to
-- a student/class the teacher has no authority over.
create policy attendance_insert on attendance_logs for insert to authenticated with check (
  marked_by = auth.uid() and app.can_mark_attendance(student_id, class_id, subject_id)
);
create policy attendance_update on attendance_logs for update to authenticated using (
  app.can_mark_attendance(student_id, class_id, subject_id)
) with check (
  marked_by = auth.uid() and app.can_mark_attendance(student_id, class_id, subject_id)
);

-- ---- gate ----
create policy gate_events_select on gate_events
  for select to authenticated using (app.can_see_student(student_id));
create policy gate_devices_read on gate_devices
  for select to authenticated using (app.manages_school(school_id));
-- gate writes happen from the scanner app via the service role (no policy = deny).

create policy absence_reports_select on parent_absence_reports for select to authenticated using (
  parent_user_id = auth.uid()
  or app.can_see_student(student_id)
);
-- V3 (hole A1): the guardian check was "g.student_id = student_id", which
-- compared guardians.student_id with itself. Now fully qualified, and the
-- school must be the child's school, and the date cannot be in the past.
create policy absence_reports_insert on parent_absence_reports for insert to authenticated with check (
  parent_user_id = auth.uid()
  and status = 'pending' and reviewed_by is null
  and absence_date >= current_date
  and school_id = app.student_school(parent_absence_reports.student_id)
  and exists (select 1 from guardians g
              where g.student_id = parent_absence_reports.student_id
                and g.parent_user_id = auth.uid())
);
create policy absence_reports_update on parent_absence_reports for update to authenticated using (
  app.is_class_teacher_of(student_id) or app.manages_school(school_id)
) with check (
  ( app.is_class_teacher_of(student_id) or app.manages_school(school_id) )
  and school_id = app.student_school(parent_absence_reports.student_id)
  and (status = 'pending' or reviewed_by = auth.uid())
);

create policy skipped_select on skipped_lesson_events for select to authenticated using (
  app.can_see_student(student_id)
);
-- skipped_lesson_events are written by the detection job (service role).

-- ---- problems & lesson cards ----
create policy problems_select on problems for select to authenticated using (
  ( (raised_by = auth.uid() or assigned_to = auth.uid() or escalated_to = auth.uid())
    and app.member_at(school_id) )
  or app.manages_school(school_id)
);
-- V3: the problem inbox is for staff. Parents use contact_requests.
create policy problems_insert on problems for insert to authenticated with check (
  raised_by = auth.uid() and app.is_staff_at(school_id)
);
create policy problems_update on problems for update to authenticated
  using (app.manages_school(school_id)) with check (app.manages_school(school_id));

-- V3 (hole A2): lesson cards hold the private "who to ask first" list, so only
-- the card's teacher, a substitute teaching that lesson, and leadership read them.
-- Parents/students get topic and homework from the homework table.
create policy cards_select on lesson_cards for select to authenticated using (
  teacher_id = app.my_teacher_id()
  or app.manages_school(school_id)
  or exists (select 1 from substitutions su
             where su.class_id = lesson_cards.class_id and su.date = lesson_cards.lesson_date
               and su.period = lesson_cards.period
               and su.substitute_teacher_id = app.my_teacher_id())
);
create policy cards_insert on lesson_cards for insert to authenticated with check (
  teacher_id = app.my_teacher_id()
  and school_id = app.class_school(class_id)
  and ( app.teaches_class(class_id, subject_id)
     or app.is_class_teacher_of_class(class_id) )
);
create policy cards_update on lesson_cards for update to authenticated using (
  teacher_id = app.my_teacher_id() or app.manages_school(school_id)
) with check (
  school_id = app.class_school(class_id)
  and ( app.manages_school(school_id)
     or ( teacher_id = app.my_teacher_id()
          and ( app.teaches_class(class_id, subject_id)
             or app.is_class_teacher_of_class(class_id) ) ) )
);

-- ---- homework & announcements ----
-- V3: homework of a class is visible to staff and to that class's students/parents only.
create policy homework_select on homework for select to authenticated using (
  app.is_staff_at(app.class_school(class_id)) or app.in_class(class_id)
);
create policy homework_insert on homework for insert to authenticated with check (
  teacher_id = app.my_teacher_id()
  and ( app.teaches_class(class_id, subject_id)
     or app.is_class_teacher_of_class(class_id)
     or app.manages_school(app.class_school(class_id)) )
);
create policy homework_update on homework for update to authenticated using (
  teacher_id = app.my_teacher_id() or app.manages_school(app.class_school(class_id))
) with check (
  app.manages_school(app.class_school(class_id))
  or ( teacher_id = app.my_teacher_id()
       and ( app.teaches_class(class_id, subject_id) or app.is_class_teacher_of_class(class_id) ) )
);

-- V3: school-wide announcements → everyone in the school; class announcements
-- → staff + that class. Teachers post only to classes they teach.
create policy ann_select on announcements for select to authenticated using (
  case when class_id is null then app.member_at(school_id)
       else app.is_staff_at(school_id) or app.in_class(class_id) end
);
create policy ann_write on announcements for all to authenticated using (
  app.manages_school(school_id) or author_id = auth.uid()
) with check (
  (class_id is null or school_id = app.class_school(class_id))
  and ( app.manages_school(school_id)
     or ( author_id = auth.uid() and class_id is not null
          and ( app.teaches_class(class_id, null) or app.is_class_teacher_of_class(class_id) ) ) )
);

-- ---- weekly tests ----
-- V3: students/parents see a test only once it is published.
create policy tests_select on weekly_tests for select to authenticated using (
  app.is_staff_at(school_id) or (status <> 'draft' and app.in_class(class_id))
);
create policy tests_write on weekly_tests for all to authenticated using (
  teacher_id = app.my_teacher_id() or app.manages_school(school_id)
) with check (
  school_id = app.class_school(class_id)
  and ( ( teacher_id = app.my_teacher_id()
          and ( app.teaches_class(class_id, subject_id) or app.is_class_teacher_of_class(class_id) ) )
     or app.manages_school(school_id) )
);

create or replace function app.owns_test(p_test_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from weekly_tests wt
                 where wt.id = p_test_id
                   and (wt.teacher_id = app.my_teacher_id() or app.manages_school(wt.school_id)))
$$;
create or replace function app.test_visible_to_class(p_test_id uuid, p_min_status test_status)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from weekly_tests wt
                 where wt.id = p_test_id and wt.status >= p_min_status
                   and app.in_class(wt.class_id))
$$;

create policy questions_select on test_questions for select to authenticated using (
  app.owns_test(test_id) or app.test_visible_to_class(test_id, 'published')
);
create policy questions_write on test_questions for all to authenticated
  using (app.owns_test(test_id)) with check (app.owns_test(test_id));

-- V3 (hole A4): answer keys — test owner / leadership; class only after the test is closed.
create policy keys_select on test_answer_keys for select to authenticated using (
  app.owns_test((select q.test_id from test_questions q where q.id = test_answer_keys.question_id))
  or app.test_visible_to_class((select q.test_id from test_questions q where q.id = test_answer_keys.question_id), 'closed')
);
create policy keys_write on test_answer_keys for all to authenticated using (
  app.owns_test((select q.test_id from test_questions q where q.id = test_answer_keys.question_id))
) with check (
  app.owns_test((select q.test_id from test_questions q where q.id = test_answer_keys.question_id))
);

create policy attempts_select on test_attempts for select to authenticated using (
  app.can_see_student(student_id) or app.owns_test(test_id)
);
-- V3 (hole A5): a student may only START their own attempt on a published
-- test of their own class — empty: no score, not submitted. Scoring happens
-- in app.submit_attempt().
create policy attempts_insert on test_attempts for insert to authenticated with check (
  ( exists (select 1 from students s
            where s.id = test_attempts.student_id and s.user_id = auth.uid())
    and score is null and submitted_at is null and mode = 'online'
    and exists (select 1 from weekly_tests wt
                join class_members cm on cm.class_id = wt.class_id
                     and cm.student_id = test_attempts.student_id and cm.status = 'active'
                where wt.id = test_attempts.test_id and wt.status = 'published') )
  or app.owns_test(test_id)          -- teacher records a paper attempt
);
create policy attempts_update on test_attempts for update to authenticated
  using (app.owns_test(test_id)) with check (app.owns_test(test_id));

create or replace function app.my_open_attempt(p_attempt_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from test_attempts ta join students s on s.id = ta.student_id
                 where ta.id = p_attempt_id and s.user_id = auth.uid() and ta.submitted_at is null)
$$;

create policy answers_select on attempt_answers for select to authenticated using (
  app.my_open_attempt(attempt_id)
  or app.can_see_student((select ta.student_id from test_attempts ta where ta.id = attempt_answers.attempt_id))
  or app.owns_test((select ta.test_id from test_attempts ta where ta.id = attempt_answers.attempt_id))
);
-- V3 (hole A6): a student writes answers only into their own UNSUBMITTED
-- attempt, only for questions of that test, and can never set is_correct.
create policy answers_insert on attempt_answers for insert to authenticated with check (
  ( app.my_open_attempt(attempt_id) and is_correct is null
    and exists (select 1 from test_attempts ta join test_questions q on q.test_id = ta.test_id
                where ta.id = attempt_answers.attempt_id and q.id = attempt_answers.question_id) )
  or app.owns_test((select ta.test_id from test_attempts ta where ta.id = attempt_answers.attempt_id))
);
create policy answers_update on attempt_answers for update to authenticated using (
  app.my_open_attempt(attempt_id)
  or app.owns_test((select ta.test_id from test_attempts ta where ta.id = attempt_answers.attempt_id))
) with check (
  ( app.my_open_attempt(attempt_id) and is_correct is null )
  or app.owns_test((select ta.test_id from test_attempts ta where ta.id = attempt_answers.attempt_id))
);

-- V3 (hole A3): integrity flags are for the teacher only (rule 1: AI suggests,
-- people decide). Students and parents never see them.
create policy flags_select on integrity_flags for select to authenticated using (app.owns_test(test_id));
create policy flags_update on integrity_flags for update to authenticated
  using (app.owns_test(test_id)) with check (app.owns_test(test_id));
-- integrity flags are written by the detection job (service role).

-- ---- library (V3: holes A9, A10) ----
-- Everyone reads CHECKED items. AI-made items: their author, staff of the
-- school that made them, and methodologists. Teachers/staff add items as
-- 'ai_made'; only a methodologist can mark 'checked'. Nobody but the author
-- (while unchecked) or a methodologist can change or delete an item.
create policy library_select on library_items for select to authenticated using (
  status = 'checked'
  or author_user_id = auth.uid()
  or app.is_methodologist()
  or (origin_school_id is not null and app.is_staff_at(origin_school_id))
);
create policy library_insert on library_items for insert to authenticated with check (
  app.is_methodologist()
  or ( author_user_id = auth.uid() and status = 'ai_made' and methodologist_id is null
       and origin_school_id is not null and app.is_staff_at(origin_school_id) )
);
create policy library_update on library_items for update to authenticated using (
  app.is_methodologist() or (author_user_id = auth.uid() and status = 'ai_made')
) with check (
  app.is_methodologist()
  or (author_user_id = auth.uid() and status in ('ai_made','under_review') and methodologist_id is null)
);
create policy library_delete on library_items for delete to authenticated using (
  app.is_methodologist() or (author_user_id = auth.uid() and status = 'ai_made')
);

-- ---- AI quotas ----
create policy quotas_select on ai_quotas for select to authenticated using (user_id = auth.uid());
create policy quotas_write  on ai_quotas for all    to authenticated using (app.is_super());
create policy plan_rules_read on ai_plan_rules for select to authenticated using (true);
create policy usage_select on ai_usage_log for select to authenticated using (
  user_id = auth.uid() or (school_id is not null and app.is_school_admin(school_id)));

-- V3: may the caller use this AI feature in this school right now?
-- Returns allowed + reason ('ok' | 'not_member' | 'window_closed' |
-- 'not_in_plan' | 'limit_reached') + budget left this month.
-- Effective plan = 'pro' if the school is on Pro or inside its Pro trial.
create or replace function app.ai_check(p_school_id uuid, p_feature text)
returns table (allowed boolean, reason text, plan school_plan, remaining_cents numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_school schools%rowtype; v_plan school_plan; v_limit numeric; v_used numeric;
begin
  select * into v_school from schools where id = p_school_id;
  if not found or not exists (select 1 from user_school_roles r
                              where r.user_id = auth.uid() and r.is_active and r.school_id = p_school_id) then
    return query select false, 'not_member', null::school_plan, 0::numeric; return;
  end if;
  if not v_school.is_active then
    return query select false, 'window_closed', null::school_plan, 0::numeric; return;
  end if;
  v_plan := case when v_school.plan = 'pro' or v_school.pro_trial_until >= current_date
                 then 'pro'::school_plan else 'standard'::school_plan end;
  select max(pr.monthly_limit_cents) into v_limit
    from ai_plan_rules pr
    join user_school_roles r on r.role = pr.role
   where r.user_id = auth.uid() and r.is_active and r.school_id = p_school_id
     and pr.plan = v_plan and pr.feature = p_feature;
  if v_limit is null then
    return query select false, 'not_in_plan', v_plan, 0::numeric; return;
  end if;
  select coalesce(q.monthly_limit_cents, v_limit) into v_limit
    from (select 1) one left join ai_quotas q on q.user_id = auth.uid();
  select coalesce(sum(u.cost_cents), 0) into v_used
    from ai_usage_log u
   where u.user_id = auth.uid() and u.school_id = p_school_id and u.feature = p_feature
     and u.created_at >= date_trunc('month', now());
  if v_used >= v_limit then
    return query select false, 'limit_reached', v_plan, 0::numeric; return;
  end if;
  return query select true, 'ok', v_plan, v_limit - v_used;
end $$;

-- ---- payments & admissions ----
create policy invoices_select on fee_invoices for select to authenticated using (
  app.is_school_admin(school_id)
  or exists (select 1 from guardians g
             where g.student_id = fee_invoices.student_id and g.parent_user_id = auth.uid())
);
create policy payments_select on payments for select to authenticated using (
  app.is_school_admin((select fi.school_id from fee_invoices fi where fi.id = payments.invoice_id))
  or exists (
    select 1
    from fee_invoices fi
    join guardians g on g.student_id = fi.student_id
    where fi.id = payments.invoice_id and g.parent_user_id = auth.uid()
  )
);
-- payments/admissions writes: Click/Payme webhooks + public admission form → service role.
create policy admissions_select on admission_applications for select to authenticated using (
  app.manages_school(school_id));
create policy admissions_update on admission_applications for update to authenticated
  using (app.manages_school(school_id)) with check (app.manages_school(school_id));

-- ---- V3: parent → school office ----
create policy contact_select on contact_requests for select to authenticated using (
  parent_user_id = auth.uid()
  or app.manages_school(school_id)
  or (forwarded_to is not null and forwarded_to = app.my_teacher_id())
);
create policy contact_insert on contact_requests for insert to authenticated with check (
  parent_user_id = auth.uid()
  and status = 'open' and forwarded_to is null and handled_by is null and reply is null
  and school_id = app.student_school(contact_requests.student_id)
  and exists (select 1 from guardians g
              where g.student_id = contact_requests.student_id and g.parent_user_id = auth.uid())
  and (about_teacher_id is null or app.teacher_school(about_teacher_id) = school_id)
);
create policy contact_update on contact_requests for update to authenticated using (
  app.manages_school(school_id)
) with check (
  app.manages_school(school_id)
  and school_id = app.student_school(contact_requests.student_id)
  and (forwarded_to is null or app.teacher_school(forwarded_to) = school_id)
);

-- ---- notifications ----
create policy notifications_self on notifications
  for all to authenticated using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());
create policy devices_self on devices
  for all to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy prefs_self on notification_preferences
  for all to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());
-- notification_outbox: NO policy → authenticated sees/writes nothing (FIX #3).

-- ---- audit log ----
-- V3: rows without a school are platform-level and hidden (were visible to all).
create policy audit_select on audit_log for select to authenticated using (
  school_id is not null and app.is_school_admin(school_id)
);
-- audit_log writes: triggers only (security definer). No write policy.

-- ============================================================================
-- TRIGGERS
-- ============================================================================
create or replace function app.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger touch_grades before update on grades
  for each row execute function app.touch_updated_at();
create trigger touch_summary before update on student_term_summary
  for each row execute function app.touch_updated_at();

-- FIX #4: summary maintained as a real table, recomputed per affected row.
create or replace function app.refresh_student_summary()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_student uuid; v_term uuid; v_subject smallint;
begin
  v_student := coalesce(new.student_id, old.student_id);
  v_term    := coalesce(new.term_id, old.term_id);
  v_subject := coalesce(new.subject_id, old.subject_id);
  delete from student_term_summary
   where student_id = v_student and term_id = v_term and subject_id = v_subject;
  insert into student_term_summary
    (student_id, term_id, subject_id, current_count, current_avg,
     quarter_grade, exam_grade, final_grade)
  select student_id, term_id, subject_id,
         count(*) filter (where grade_type = 'current'),
         round(avg(value) filter (where grade_type = 'current'), 2),
         max(value) filter (where grade_type = 'quarter'),
         max(value) filter (where grade_type = 'exam'),
         max(value) filter (where grade_type = 'final')
  from grades
  where student_id = v_student and term_id = v_term and subject_id = v_subject
    and deleted_at is null
  group by student_id, term_id, subject_id
  having count(*) > 0;
  return null;
end $$;
create trigger grades_summary after insert or update or delete on grades
  for each row execute function app.refresh_student_summary();

-- FIX #7: audit trail for grade changes.
create or replace function app.audit_grade()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (user_id, school_id, table_name, row_id, action, old_value, new_value)
  values (
    auth.uid(),
    (select school_id from students where id = coalesce(new.student_id, old.student_id)),
    'grades',
    coalesce(new.id, old.id)::text,
    lower(tg_op),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;
create trigger grades_audit after insert or update or delete on grades
  for each row execute function app.audit_grade();

-- Grade posted → outbox (never send push in the request path).
create or replace function app.on_grade_posted()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_recipient uuid; v_subject text;
begin
  if new.deleted_at is not null then return new; end if;
  select name_uz into v_subject from subjects where id = new.subject_id;
  insert into notification_outbox (recipient_id, payload)
  select s.user_id, jsonb_build_object('kind','grade_posted','student_id', new.student_id,
           'subject', v_subject, 'value', new.value, 'term_id', new.term_id)
  from students s
  where s.id = new.student_id and s.user_id is not null;
  for v_recipient in select parent_user_id from guardians
                     where student_id = new.student_id and is_primary
  loop
    insert into notification_outbox (recipient_id, payload)
    values (v_recipient, jsonb_build_object('kind','grade_posted',
             'student_id', new.student_id, 'subject', v_subject,
             'value', new.value, 'term_id', new.term_id));
  end loop;
  return new;
end $$;
create trigger grade_posted_notify after insert on grades
  for each row execute function app.on_grade_posted();

-- FIX #9: absence alerts fire on INSERT and on UPDATE (e.g. present → absent).
create or replace function app.on_absence_marked()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_recipient uuid;
begin
  if new.status in ('absent','late')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into notification_outbox (recipient_id, payload)
    select s.user_id, jsonb_build_object('kind','absence','student_id', new.student_id,
             'date', new.date, 'period', new.period, 'status', new.status)
    from students s
    where s.id = new.student_id and s.user_id is not null;
    for v_recipient in select parent_user_id from guardians
                       where student_id = new.student_id and is_primary
    loop
      insert into notification_outbox (recipient_id, payload)
      values (v_recipient, jsonb_build_object('kind','absence',
               'student_id', new.student_id, 'date', new.date,
               'period', new.period, 'status', new.status));
    end loop;
  end if;
  return new;
end $$;
create trigger absence_notify after insert or update on attendance_logs
  for each row execute function app.on_absence_marked();

-- Gate check-in → instant parent alert (entry/exit only, no GPS).
create or replace function app.on_gate_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_recipient uuid;
begin
  for v_recipient in select parent_user_id from guardians
                     where student_id = new.student_id and is_primary
  loop
    insert into notification_outbox (recipient_id, payload)
    values (v_recipient, jsonb_build_object(
      'kind', case new.direction when 'in' then 'gate_in' else 'gate_out' end,
      'student_id', new.student_id, 'scanned_at', new.scanned_at));
  end loop;
  return new;
end $$;
create trigger gate_event_notify after insert on gate_events
  for each row execute function app.on_gate_event();

-- Skipped lesson detected (service job writes the event) → alert parent + class teacher.
create or replace function app.on_skipped_lesson()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_recipient uuid; v_teacher_user uuid;
begin
  for v_recipient in select parent_user_id from guardians
                     where student_id = new.student_id and is_primary
  loop
    insert into notification_outbox (recipient_id, payload)
    values (v_recipient, jsonb_build_object('kind','skipped_lesson',
             'student_id', new.student_id, 'date', new.date, 'period', new.period));
  end loop;
  select t.user_id into v_teacher_user
  from classes c join teachers t on t.id = c.class_teacher_id
  where c.id = new.class_id;
  if v_teacher_user is not null then
    insert into notification_outbox (recipient_id, payload)
    values (v_teacher_user, jsonb_build_object('kind','skipped_lesson',
             'student_id', new.student_id, 'date', new.date, 'period', new.period));
  end if;
  return new;
end $$;
create trigger skipped_lesson_notify after insert on skipped_lesson_events
  for each row execute function app.on_skipped_lesson();

-- V3: parent wrote to the school office → alert school admins/director/zavuch.
create or replace function app.on_contact_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into notification_outbox (recipient_id, payload)
  select distinct r.user_id, jsonb_build_object('kind','parent_message',
           'contact_request_id', new.id, 'student_id', new.student_id, 'topic', new.topic)
  from user_school_roles r
  where r.school_id = new.school_id and r.is_active
    and r.role in ('school_admin','director','zavuch');
  return new;
end $$;
create trigger contact_request_notify after insert on contact_requests
  for each row execute function app.on_contact_request();

-- ============================================================================
-- GRANTS (FIX #6: grant writes to authenticated; RLS is the guard)
-- ============================================================================
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;

-- V3 (hole A11): v2 ended with "alter default privileges ... grant ... to
-- authenticated", which made every FUTURE table open to all logged-in users.
-- Removed. A new table is now closed until a developer explicitly enables RLS,
-- writes policies and grants access. test_rls.sql also fails if any public
-- table has RLS switched off.
alter default privileges in schema public
  revoke select, insert, update, delete on tables from authenticated;
-- The public login page (not logged in) may only call school_window().
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on all functions in schema app from public, anon;
    grant usage on schema app to anon;
    grant execute on function app.school_window(text) to anon;
  end if;
end $$;
