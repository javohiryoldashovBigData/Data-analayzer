-- ============================================================================
-- MAKTAB+ — seed data v2 (two schools, all roles, for RLS testing)
--
-- Local PostgreSQL:   psql -f local_compat.sql -f schema.sql -f seed.sql -f test_rls.sql
-- Self-hosted Supabase: skip the auth.users inserts (create the users in
--   Supabase Auth instead) and keep everything else; replace the uuids.
--
-- Fixture summary:
--   School A (district 101, region 1): class 5-A with students sA1, sA2
--     staff:  adminA (school_admin), directorA, zavuchA
--     teacher teachA  — MATH teacher AND class teacher of 5-A
--     teacher teachA2 — teacher at School A with NO assignments
--     parent  parentA — guardian of sA1
--     student studA1  — own login for sA1
--   School B (district 202, region 2): class 5-B with student sB1
--     staff:  adminB, teacher teachB (MATH + class teacher of 5-B)
--   dadminA — district admin of district 101 (covers School A, not B)
--   V3: superU (platform super admin), methodU (Library methodologist)
-- ============================================================================

-- ---- geography ----
insert into regions (id, name_uz, name_ru) values (1, 'Toshkent shahri', 'Ташкент');
insert into regions (id, name_uz, name_ru) values (2, 'Samarqand viloyati', 'Самаркандская область');
insert into districts (id, region_id, name_uz, name_ru) values (101, 1, 'Yunusobod', 'Юнусабадский');
insert into districts (id, region_id, name_uz, name_ru) values (202, 2, 'Samarqand shahri', 'Самарканд');

-- ---- users (LOCAL TESTING ONLY — on Supabase create these in Auth) ----
insert into auth.users (id, email) values
 ('aaaa0000-0000-4000-8000-00000000a001', 'adminA@maktab.test'),
 ('aaaa0000-0000-4000-8000-00000000a002', 'directorA@maktab.test'),
 ('aaaa0000-0000-4000-8000-00000000a003', 'zavuchA@maktab.test'),
 ('aaaa0000-0000-4000-8000-00000000a004', 'teachA@maktab.test'),
 ('aaaa0000-0000-4000-8000-00000000a008', 'teachA2@maktab.test'),
 ('aaaa0000-0000-4000-8000-00000000a005', 'parentA@maktab.test'),
 ('aaaa0000-0000-4000-8000-00000000a006', 'studA1@maktab.test'),
 ('aaaa0000-0000-4000-8000-00000000a007', 'dadminA@maktab.test'),
 ('aaaa0000-0000-4000-8000-00000000b001', 'adminB@maktab.test'),
 ('aaaa0000-0000-4000-8000-00000000b002', 'teachB@maktab.test'),
 ('aaaa0000-0000-4000-8000-00000000c001', 'super@maktab.test'),        -- V3: platform super admin
 ('aaaa0000-0000-4000-8000-00000000c002', 'method@maktab.test');       -- V3: methodologist

-- ---- schools ----
insert into schools (id, district_id, name, mode, slug, brand_color) values
 ('bbbb0000-0000-4000-8000-00000000a001', 101, '1-maktab (A)', 'private',    'school-a', '#0f766e'),
 ('bbbb0000-0000-4000-8000-00000000b001', 202, '2-maktab (B)', 'government', 'school-b', '#7c3aed');

-- ---- roles ----
insert into user_school_roles (user_id, role, school_id, district_id, region_id) values
 ('aaaa0000-0000-4000-8000-00000000a001', 'school_admin', 'bbbb0000-0000-4000-8000-00000000a001', null, null),
 ('aaaa0000-0000-4000-8000-00000000a002', 'director',     'bbbb0000-0000-4000-8000-00000000a001', null, null),
 ('aaaa0000-0000-4000-8000-00000000a003', 'zavuch',       'bbbb0000-0000-4000-8000-00000000a001', null, null),
 ('aaaa0000-0000-4000-8000-00000000a004', 'teacher',      'bbbb0000-0000-4000-8000-00000000a001', null, null),
 ('aaaa0000-0000-4000-8000-00000000a008', 'teacher',      'bbbb0000-0000-4000-8000-00000000a001', null, null),
 ('aaaa0000-0000-4000-8000-00000000a005', 'parent',       'bbbb0000-0000-4000-8000-00000000a001', null, null),
 ('aaaa0000-0000-4000-8000-00000000a006', 'student',      'bbbb0000-0000-4000-8000-00000000a001', null, null),
 ('aaaa0000-0000-4000-8000-00000000b001', 'school_admin', 'bbbb0000-0000-4000-8000-00000000b001', null, null),
 ('aaaa0000-0000-4000-8000-00000000b002', 'teacher',      'bbbb0000-0000-4000-8000-00000000b001', null, null);
insert into user_school_roles (user_id, role, school_id, district_id, region_id) values
 ('aaaa0000-0000-4000-8000-00000000a007', 'district_admin', null, 101, null),
 ('aaaa0000-0000-4000-8000-00000000c001', 'super_admin',    null, null, null),
 ('aaaa0000-0000-4000-8000-00000000c002', 'methodologist',  null, null, null);

-- ---- profiles ----
insert into profiles (user_id, first_name, last_name, phone) values
 ('aaaa0000-0000-4000-8000-00000000a001', 'Oybek',    'Rahimov',   '+998901000001'),
 ('aaaa0000-0000-4000-8000-00000000a002', 'Nodira',   'Sattorova', '+998901000002'),
 ('aaaa0000-0000-4000-8000-00000000a003', 'Jasur',    'Tolipov',   '+998901000003'),
 ('aaaa0000-0000-4000-8000-00000000a004', 'Bekzod',   'Karimov',   '+998901000004'),
 ('aaaa0000-0000-4000-8000-00000000a008', 'Shahzod',  'Ergashev',  '+998901000008'),
 ('aaaa0000-0000-4000-8000-00000000a005', 'Dilshoda', 'Yusupova',  '+998901000005'),
 ('aaaa0000-0000-4000-8000-00000000a006', 'Jasur',    'Yusupov',   '+998901000006'),
 ('aaaa0000-0000-4000-8000-00000000a007', 'Kamola',   'Nazirova',  '+998901000007'),
 ('aaaa0000-0000-4000-8000-00000000b001', 'Zafar',    'Umarov',    '+998901000009'),
 ('aaaa0000-0000-4000-8000-00000000b002', 'Gulnora',  'Ahmedova',  '+998901000010');

-- ---- academic calendar & subjects ----
insert into academic_years (id, start_date, end_date, is_current) values
 (2026, '2026-09-01', '2027-05-31', true);
insert into terms (id, academic_year_id, number, start_date, end_date, is_current) values
 ('ffff0000-0000-4000-8000-00000000a001', 2026, 1, '2026-09-01', '2026-11-15', true);
insert into subjects (id, name_uz, name_ru, code) values
 (1, 'Matematika',  'Математика',  'MATH'),
 (2, 'Ingliz tili', 'Английский',  'ENG');

-- ---- teachers ----
insert into teachers (id, school_id, user_id) values
 ('cccc0000-0000-4000-8000-00000000a001', 'bbbb0000-0000-4000-8000-00000000a001', 'aaaa0000-0000-4000-8000-00000000a004'),  -- teachA
 ('cccc0000-0000-4000-8000-00000000a002', 'bbbb0000-0000-4000-8000-00000000a001', 'aaaa0000-0000-4000-8000-00000000a008'),  -- teachA2 (no assignments)
 ('cccc0000-0000-4000-8000-00000000b001', 'bbbb0000-0000-4000-8000-00000000b001', 'aaaa0000-0000-4000-8000-00000000b002');  -- teachB

-- ---- classes ----
insert into classes (id, school_id, academic_year_id, grade_level, letter, class_teacher_id) values
 ('dddd0000-0000-4000-8000-00000000a001', 'bbbb0000-0000-4000-8000-00000000a001', 2026, 5, 'A', 'cccc0000-0000-4000-8000-00000000a001'),  -- 5-A, teachA is sinf rahbari
 ('dddd0000-0000-4000-8000-00000000b001', 'bbbb0000-0000-4000-8000-00000000b001', 2026, 5, 'B', 'cccc0000-0000-4000-8000-00000000b001');  -- 5-B

-- ---- students ----
insert into students (id, school_id, user_id, first_name, last_name, gender, birth_date) values
 ('eeee0000-0000-4000-8000-00000000a001', 'bbbb0000-0000-4000-8000-00000000a001', 'aaaa0000-0000-4000-8000-00000000a006', 'Jasur',  'Yusupov', 'm', '2015-03-10'),  -- sA1 with login
 ('eeee0000-0000-4000-8000-00000000a002', 'bbbb0000-0000-4000-8000-00000000a001', null, 'Malika', 'Qodirova', 'f', '2015-07-22'),                                        -- sA2 no login
 ('eeee0000-0000-4000-8000-00000000b001', 'bbbb0000-0000-4000-8000-00000000b001', null, 'Sardor', 'Bekmatov', 'm', '2015-01-05');                                          -- sB1

-- ---- guardians ----
insert into guardians (parent_user_id, student_id, relation, is_primary) values
 ('aaaa0000-0000-4000-8000-00000000a005', 'eeee0000-0000-4000-8000-00000000a001', 'mother', true);  -- parentA → sA1

-- ---- class members ----
insert into class_members (class_id, student_id) values
 ('dddd0000-0000-4000-8000-00000000a001', 'eeee0000-0000-4000-8000-00000000a001'),  -- sA1 in 5-A
 ('dddd0000-0000-4000-8000-00000000a001', 'eeee0000-0000-4000-8000-00000000a002'),  -- sA2 in 5-A
 ('dddd0000-0000-4000-8000-00000000b001', 'eeee0000-0000-4000-8000-00000000b001');  -- sB1 in 5-B

-- ---- teacher assignments ----
insert into teacher_assignments (teacher_id, class_id, subject_id, academic_year_id) values
 ('cccc0000-0000-4000-8000-00000000a001', 'dddd0000-0000-4000-8000-00000000a001', 1, 2026),  -- teachA: MATH 5-A
 ('cccc0000-0000-4000-8000-00000000b001', 'dddd0000-0000-4000-8000-00000000b001', 1, 2026);  -- teachB: MATH 5-B

-- ---- timetable sample ----
insert into bell_periods (school_id, number, start_time, end_time) values
 ('bbbb0000-0000-4000-8000-00000000a001', 1, '08:00', '08:45'),
 ('bbbb0000-0000-4000-8000-00000000a001', 2, '08:55', '09:40');
insert into rooms (school_id, name) values
 ('bbbb0000-0000-4000-8000-00000000a001', '204-xona');
insert into timetable_slots (class_id, day_of_week, period, subject_id, teacher_id, effective_from) values
 ('dddd0000-0000-4000-8000-00000000a001', 1, 1, 1, 'cccc0000-0000-4000-8000-00000000a001', '2026-09-01');  -- Mon, lesson 1, MATH, teachA (V3.1: valid from start of year)
