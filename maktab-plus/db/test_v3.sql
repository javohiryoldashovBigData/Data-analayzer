-- ============================================================================
-- MAKTAB+ — V3 test scenarios (included from test_rls.sql; do not run alone)
--
--   A1–A11  attacks that worked against v2 — every one must now be BLOCKED
--   W*      one window per school
--   P*      parents see teacher names only; contact goes through the office
--   X*      privilege escalation, audit, drafts, meta checks
--
-- Short names used below:
--   adminA a001, directorA a002, zavuchA a003, teachA a004, parentA a005,
--   studA1 a006, dadminA a007, teachA2 a008, adminB b001, teachB b002,
--   superU c001, methodU c002
--   school A = bbbb…a001 (private, slug school-a), school B = bbbb…b001 (government)
--   sA1 Jasur = eeee…a001 (child of parentA), sA2 Malika = eeee…a002, sB1 Sardor = eeee…b001
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Setup as the service role (owner)
-- ---------------------------------------------------------------------------
reset role;

-- a second published test (for the A5 attack) and a draft test (X4)
insert into weekly_tests (id, school_id, class_id, subject_id, teacher_id, term_id, test_date, topic, status) values
 ('99990000-0000-4000-8000-000000000002','bbbb0000-0000-4000-8000-00000000a001','dddd0000-0000-4000-8000-00000000a001',1,
  'cccc0000-0000-4000-8000-00000000a001','ffff0000-0000-4000-8000-00000000a001', current_date+2, 'Foizlar','published'),
 ('99990000-0000-4000-8000-000000000003','bbbb0000-0000-4000-8000-00000000a001','dddd0000-0000-4000-8000-00000000a001',1,
  'cccc0000-0000-4000-8000-00000000a001','ffff0000-0000-4000-8000-00000000a001', current_date+9, 'Tenglamalar (draft)','draft');

-- the private "who to ask first" list on a lesson card
update lesson_cards set questions = '{"ask_first":["Malika: no homework, grades falling"]}' where topic = 'Kasrlar';

-- an integrity flag on Jasur's attempt (detection job)
insert into integrity_flags (test_id, attempt_id, student_id, kind, details)
select ta.test_id, ta.id, ta.student_id, 'similar_answers', '{"other":"Malika"}'
from test_attempts ta where ta.student_id = 'eeee0000-0000-4000-8000-00000000a001';

-- library: an AI-made item from school B, and a checked item from the platform
insert into library_items (id, subject_id, topic, kind, title, status, author_user_id, origin_school_id) values
 ('88880000-0000-4000-8000-000000000001',1,'Kasrlar','animation','Kasrlar (school B, AI-made)','ai_made',
  'aaaa0000-0000-4000-8000-00000000b002','bbbb0000-0000-4000-8000-00000000b001'),
 ('88880000-0000-4000-8000-000000000002',1,'Kasrlar','animation','Kasrlar (checked)','checked',
  null, null);

-- homework for 5-A and for 5-B
insert into homework (class_id, subject_id, teacher_id, due_date, description) values
 ('dddd0000-0000-4000-8000-00000000a001',1,'cccc0000-0000-4000-8000-00000000a001', current_date+1, '57-bet 1-5'),
 ('dddd0000-0000-4000-8000-00000000b001',1,'cccc0000-0000-4000-8000-00000000b001', current_date+1, '12-bet 3-4');

-- a platform-level audit row (no school)
insert into audit_log (table_name, row_id, action) values ('schools', 'x', 'platform_note');

grant usage on schema test to anon;
grant execute on all functions in schema test to anon;

-- ===========================================================================
-- A1–A11: the attacks that worked against v2
-- ===========================================================================
set role authenticated;

select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
select test.check('A1a parent CANNOT file an absence report for another school''s child',
  not test.rows($q$ insert into parent_absence_reports (school_id, student_id, parent_user_id, absence_date, reason)
     values ('bbbb0000-0000-4000-8000-00000000b001','eeee0000-0000-4000-8000-00000000b001',
             'aaaa0000-0000-4000-8000-00000000a005', current_date+1,'x') $q$));
select test.check('A1b ... nor for a classmate who is not their child',
  not test.rows($q$ insert into parent_absence_reports (school_id, student_id, parent_user_id, absence_date, reason)
     values ('bbbb0000-0000-4000-8000-00000000a001','eeee0000-0000-4000-8000-00000000a002',
             'aaaa0000-0000-4000-8000-00000000a005', current_date+1,'x') $q$));
select test.check('A1c ... nor mark their own report as already accepted',
  not test.rows($q$ insert into parent_absence_reports (school_id, student_id, parent_user_id, absence_date, status, reviewed_by)
     values ('bbbb0000-0000-4000-8000-00000000a001','eeee0000-0000-4000-8000-00000000a001',
             'aaaa0000-0000-4000-8000-00000000a005', current_date+2,'accepted','aaaa0000-0000-4000-8000-00000000a005') $q$));
select test.check('A2a parent CANNOT read lesson cards ("who to ask first" list)',
  test.count('select count(*) from lesson_cards') = 0);
select test.check('A3a parent CANNOT see integrity flags',
  test.count('select count(*) from integrity_flags') = 0);

select test.asuser('aaaa0000-0000-4000-8000-00000000a006');  -- studA1
select test.check('A2b student CANNOT read lesson cards',
  test.count('select count(*) from lesson_cards') = 0);
select test.check('A3b student CANNOT see integrity flags',
  test.count('select count(*) from integrity_flags') = 0);
select test.check('A4a student CANNOT read the answer key of a published test',
  test.count('select count(*) from test_answer_keys') = 0);
select test.check('A4b student CAN read the questions of a published test of own class',
  test.count($q$ select count(*) from test_questions q join weekly_tests wt on wt.id = q.test_id
               where wt.topic = 'Kasrlar' $q$) = 2);
select test.check('A5a student CANNOT create an attempt with score = 100',
  not test.rows($q$ insert into test_attempts (test_id, student_id, mode, score)
     values ('99990000-0000-4000-8000-000000000002','eeee0000-0000-4000-8000-00000000a001','online',100) $q$));
select test.check('A5b student CANNOT create an attempt that is already submitted',
  not test.rows($q$ insert into test_attempts (test_id, student_id, mode, submitted_at)
     values ('99990000-0000-4000-8000-000000000002','eeee0000-0000-4000-8000-00000000a001','online', now()) $q$));
select test.check('A5c student CANNOT start an attempt on a DRAFT test',
  not test.rows($q$ insert into test_attempts (test_id, student_id, mode)
     values ('99990000-0000-4000-8000-000000000003','eeee0000-0000-4000-8000-00000000a001','online') $q$));
select test.check('A5d student CANNOT set their own score afterwards',
  not test.rows($q$ update test_attempts set score = 100
     where student_id = 'eeee0000-0000-4000-8000-00000000a001' $q$));
select test.check('A5e student CAN start a normal (empty) attempt on a published test',
  test.rows($q$ insert into test_attempts (test_id, student_id, mode)
     values ('99990000-0000-4000-8000-000000000002','eeee0000-0000-4000-8000-00000000a001','online') $q$));
select test.check('A6a student CANNOT insert an answer marked is_correct = true',
  not test.rows($q$ insert into attempt_answers (attempt_id, question_id, position, answer, is_correct)
     select a.id, '99990000-0000-4000-8000-0000000000e2', 2, '1', true from test_attempts a
     where a.student_id = 'eeee0000-0000-4000-8000-00000000a001' $q$));
select test.check('A6b student CAN save normal answers (q1 right, q2 wrong)',
  test.rows($q$ insert into attempt_answers (attempt_id, question_id, position, answer)
     select a.id, q.id, q.position, case q.position when 1 then '0' else '1' end::jsonb
     from test_attempts a join test_questions q on q.test_id = a.test_id
     where a.student_id = 'eeee0000-0000-4000-8000-00000000a001'
       and a.test_id <> '99990000-0000-4000-8000-000000000002' $q$));
select test.check('A6c student CANNOT flip an answer to is_correct = true',
  not test.rows($q$ update attempt_answers set is_correct = true $q$));
select test.check('A6d server scores the attempt: 1 of 2 correct = 50',
  test.count($q$ select app.submit_attempt(a.id)::bigint from test_attempts a
               where a.student_id = 'eeee0000-0000-4000-8000-00000000a001'
                 and a.test_id <> '99990000-0000-4000-8000-000000000002' $q$) = 50);
select test.check('A6e after submitting, the student CANNOT change answers',
  not test.rows($q$ update attempt_answers set answer = '0' $q$));
select test.check('A6f ... and CANNOT submit a second time',
  test.error($q$ select app.submit_attempt(a.id) from test_attempts a
               where a.student_id = 'eeee0000-0000-4000-8000-00000000a001'
                 and a.test_id <> '99990000-0000-4000-8000-000000000002' $q$));

select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('A2c the teacher DOES see their own lesson card',
  test.count('select count(*) from lesson_cards') = 1);
select test.check('A3c the teacher DOES see the flag on their test, and decides',
  test.rows($q$ update integrity_flags set teacher_seen = true, decision = 'dismissed' $q$));
update weekly_tests set status = 'closed' where topic = 'Kasrlar';

select test.asuser('aaaa0000-0000-4000-8000-00000000a006');  -- studA1
select test.check('A4c after the test is CLOSED the student sees the answers',
  test.count('select count(*) from test_answer_keys') = 2);

select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
insert into attendance_logs (student_id, class_id, date, period, subject_id, teacher_id, status, marked_by)
values ('eeee0000-0000-4000-8000-00000000a001','dddd0000-0000-4000-8000-00000000a001', current_date, 3, 1,
        'cccc0000-0000-4000-8000-00000000a001','present','aaaa0000-0000-4000-8000-00000000a004');
select test.check('A7  teacher CANNOT move an attendance row onto another school''s student',
  not test.rows($q$ update attendance_logs set student_id = 'eeee0000-0000-4000-8000-00000000b001', status = 'absent'
     where student_id = 'eeee0000-0000-4000-8000-00000000a001' and period = 3 $q$));
select test.check('A8a subject teacher CANNOT post a FINAL grade',
  not test.rows($q$ insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, created_by)
     values ('eeee0000-0000-4000-8000-00000000a001',1,'ffff0000-0000-4000-8000-00000000a001','final',5,
             'cccc0000-0000-4000-8000-00000000a001','aaaa0000-0000-4000-8000-00000000a004') $q$));
select test.check('A8b subject teacher CANNOT turn an existing grade into a final one',
  not test.rows($q$ update grades set grade_type = 'final'
     where student_id = 'eeee0000-0000-4000-8000-00000000a001' $q$));
select test.check('A8c subject teacher CAN post a quarter grade',
  test.rows($q$ insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, created_by)
     values ('eeee0000-0000-4000-8000-00000000a001',1,'ffff0000-0000-4000-8000-00000000a001','quarter',5,
             'cccc0000-0000-4000-8000-00000000a001','aaaa0000-0000-4000-8000-00000000a004') $q$));
select test.check('A8d class teacher CANNOT grade a subject they do not teach (English)',
  not test.rows($q$ insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, created_by)
     values ('eeee0000-0000-4000-8000-00000000a001',2,'ffff0000-0000-4000-8000-00000000a001','current',5,
             'cccc0000-0000-4000-8000-00000000a001','aaaa0000-0000-4000-8000-00000000a004') $q$));
select test.check('A9b teacher CANNOT mark their own AI-made item as "checked"',
  not test.rows($q$ insert into library_items (subject_id, topic, kind, title, status, author_user_id, origin_school_id)
     values (1,'Kasrlar','animation','my item','checked','aaaa0000-0000-4000-8000-00000000a004','bbbb0000-0000-4000-8000-00000000a001') $q$));
select test.check('A9c teacher CAN add an AI-made item for their school',
  test.rows($q$ insert into library_items (subject_id, topic, kind, title, status, author_user_id, origin_school_id)
     values (1,'Kasrlar','animation','my item','ai_made','aaaa0000-0000-4000-8000-00000000a004','bbbb0000-0000-4000-8000-00000000a001') $q$));

select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
select test.check('A8e zavuch CAN confirm a final grade',
  test.rows($q$ insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, created_by)
     values ('eeee0000-0000-4000-8000-00000000a001',1,'ffff0000-0000-4000-8000-00000000a001','final',5,
             'cccc0000-0000-4000-8000-00000000a001','aaaa0000-0000-4000-8000-00000000a003') $q$));
select test.check('A9a zavuch of school A CANNOT mark school B''s AI item as "checked"',
  not test.rows($q$ update library_items set status = 'checked'
     where id = '88880000-0000-4000-8000-000000000001' $q$));
select test.check('A10a zavuch of school A CANNOT delete school B''s item',
  not test.rows($q$ delete from library_items where id = '88880000-0000-4000-8000-000000000001' $q$));
select test.check('A10b zavuch CANNOT delete a CHECKED shared item',
  not test.rows($q$ delete from library_items where id = '88880000-0000-4000-8000-000000000002' $q$));
select test.check('A10c school A does not even see school B''s unchecked item',
  test.count($q$ select count(*) from library_items where id = '88880000-0000-4000-8000-000000000001' $q$) = 0);

select test.asuser('aaaa0000-0000-4000-8000-00000000a006');  -- studA1
select test.check('A10d student sees the CHECKED item, not unchecked ones',
  test.count('select count(*) from library_items') = 1);

select test.asuser('aaaa0000-0000-4000-8000-00000000c002');  -- methodU
select test.check('A9d methodologist CAN mark an item "checked"',
  test.rows($q$ update library_items set status = 'checked', methodologist_id = 'aaaa0000-0000-4000-8000-00000000c002',
     reviewed_at = now() where id = '88880000-0000-4000-8000-000000000001' $q$));

reset role;
create table later_feature (id int, secret text);
insert into later_feature values (1, 'student health note');
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
select test.check('A11 a NEW table added later is CLOSED by default',
  test.error('select * from later_feature'));
reset role;
drop table later_feature;
select test.check('A11b every table in schema public has row-level security ON',
  test.count($q$ select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity $q$) = 0);
select test.check('A11c every SECURITY DEFINER function pins search_path',
  test.count($q$ select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'app' and p.prosecdef
                 and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') $q$) = 0);

-- ===========================================================================
-- W: one window per school
-- ===========================================================================
set role anon;
select set_config('app.current_user_id', '', false);
select test.check('W1a login page of school-a gets its name, logo colour (not logged in)',
  test.count($q$ select count(*) from app.school_window('school-a') where brand_color = '#0f766e' $q$) = 1);
select test.check('W1b unknown address returns nothing',
  test.count($q$ select count(*) from app.school_window('no-such-school') $q$) = 0);
select test.check('W1c a visitor who is not logged in CANNOT read the schools table',
  test.error('select count(*) from schools'));
select test.check('W1d ... nor call any other function (e.g. school_stats)',
  test.error($q$ select * from app.school_stats('bbbb0000-0000-4000-8000-00000000b001') $q$));
reset role;

set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000b001');  -- adminB
select test.check('W2a school B admin sees only their own school (not school A''s window)',
  test.count('select count(*) from schools') = 1);
select test.check('W2b school B admin sees no school A classes, teachers, homework, cards, tests',
  test.count($q$ select (select count(*) from classes where school_id = 'bbbb0000-0000-4000-8000-00000000a001')
                      + (select count(*) from teachers where school_id = 'bbbb0000-0000-4000-8000-00000000a001')
                      + (select count(*) from homework h join classes c on c.id = h.class_id
                          where c.school_id = 'bbbb0000-0000-4000-8000-00000000a001')
                      + (select count(*) from lesson_cards where school_id = 'bbbb0000-0000-4000-8000-00000000a001')
                      + (select count(*) from weekly_tests where school_id = 'bbbb0000-0000-4000-8000-00000000a001') $q$) = 0);
select test.check('W2c school B admin CANNOT change school A''s settings',
  not test.rows($q$ update schools set brand_color = '#000000' where slug = 'school-a' $q$));
select test.check('W2d school B admin gets numbers for own school',
  test.count($q$ select students from app.school_stats('bbbb0000-0000-4000-8000-00000000b001') $q$) = 1);

select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
select test.check('W3  parent sees only own school',
  test.count('select count(*) from schools') = 1);

select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
select test.check('W4a zavuch CANNOT change the school''s branding (admin/director only)',
  not test.rows($q$ update schools set brand_color = '#000000' where slug = 'school-a' $q$));
select test.asuser('aaaa0000-0000-4000-8000-00000000a001');  -- adminA
select test.check('W4b school admin CAN set own logo and colour',
  test.rows($q$ update schools set logo_url = 'https://cdn.example/a.png', brand_color = '#115e59'
     where slug = 'school-a' $q$));

select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('W5  teacher''s school picker lists one window: school-a',
  test.count($q$ select count(*) from app.my_schools() where slug = 'school-a' $q$) = 1
  and test.count('select count(*) from app.my_schools()') = 1);

reset role;
update schools set is_active = false where slug = 'school-a';
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('W6a closed window: teacher of school A sees no students',
  test.count('select count(*) from students') = 0);
select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
select test.check('W6b closed window: parent sees no grades',
  test.count('select count(*) from grades') = 0);
reset role;
update schools set is_active = true where slug = 'school-a';
set role authenticated;

select test.asuser('aaaa0000-0000-4000-8000-00000000c001');  -- superU
select test.check('W7a platform super admin sees both schools (to run the platform)',
  test.count('select count(*) from schools') = 2);
select test.check('W7b ... but NO students, grades or attendance of any school',
  test.count($q$ select (select count(*) from students) + (select count(*) from grades)
                      + (select count(*) from attendance_logs) + (select count(*) from guardians) $q$) = 0);
select test.check('W7c super admin gets numbers for a government school',
  test.count($q$ select count(*) from app.school_stats('bbbb0000-0000-4000-8000-00000000b001') $q$) = 1);
select test.check('W7d ... but not for a private school that did not opt in',
  test.error($q$ select * from app.school_stats('bbbb0000-0000-4000-8000-00000000a001') $q$));

reset role;
update schools set share_stats_with_government = true where slug = 'school-a';
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a007');  -- dadminA
select test.check('W8a private school opted in → district admin gets NUMBERS (2 students)',
  test.count($q$ select students from app.school_stats('bbbb0000-0000-4000-8000-00000000a001') $q$) = 2);
select test.check('W8b ... still no names',
  test.count('select count(*) from students') = 0);
select test.check('W8c district admin of 101 gets nothing from school B (district 202)',
  test.error($q$ select * from app.school_stats('bbbb0000-0000-4000-8000-00000000b001') $q$));

-- ===========================================================================
-- P: parents see teacher NAMES only; contact goes through the school office
-- ===========================================================================
select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
select test.check('P1a parent sees the child''s teacher NAME (Bekzod Karimov)',
  test.count($q$ select count(*) from app.my_teachers()
               where first_name = 'Bekzod' and last_name = 'Karimov' $q$) >= 1);
select test.check('P1b the name list has no phone column at all',
  test.count($q$ select count(*) from information_schema.routines r
               join information_schema.parameters p on p.specific_name = r.specific_name
               where r.routine_schema = 'app' and r.routine_name = 'my_teachers'
                 and p.parameter_name ilike '%phone%' $q$) = 0);
select test.check('P1c parent CANNOT read the teachers table or teacher profiles directly',
  test.count($q$ select (select count(*) from teachers)
                      + (select count(*) from profiles where user_id <> auth.uid()) $q$) = 0);
select test.check('P2a parent CAN write to the school office about the math teacher',
  test.rows($q$ insert into contact_requests (school_id, student_id, parent_user_id, about_teacher_id, topic, body)
     values ('bbbb0000-0000-4000-8000-00000000a001','eeee0000-0000-4000-8000-00000000a001',
             'aaaa0000-0000-4000-8000-00000000a005','cccc0000-0000-4000-8000-00000000a001',
             'Uy vazifasi','Jasur uy vazifasini tushunmayapti') $q$));
select test.check('P2b parent CANNOT write about a child that is not theirs',
  not test.rows($q$ insert into contact_requests (school_id, student_id, parent_user_id, topic, body)
     values ('bbbb0000-0000-4000-8000-00000000a001','eeee0000-0000-4000-8000-00000000a002',
             'aaaa0000-0000-4000-8000-00000000a005','x','x') $q$));
select test.check('P2c parent CANNOT send it straight to a teacher (forwarding is the office''s job)',
  not test.rows($q$ insert into contact_requests (school_id, student_id, parent_user_id, topic, body, forwarded_to, status)
     values ('bbbb0000-0000-4000-8000-00000000a001','eeee0000-0000-4000-8000-00000000a001',
             'aaaa0000-0000-4000-8000-00000000a005','x','x','cccc0000-0000-4000-8000-00000000a001','forwarded') $q$));
select test.check('P2d parent sees own message',
  test.count('select count(*) from contact_requests') = 1);

select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('P3a teacher does NOT see the message before the office forwards it',
  test.count('select count(*) from contact_requests') = 0);
select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
select test.check('P3b school office (zavuch) sees it and forwards it to the teacher',
  test.rows($q$ update contact_requests set status = 'forwarded',
     forwarded_to = 'cccc0000-0000-4000-8000-00000000a001',
     handled_by = 'aaaa0000-0000-4000-8000-00000000a003' $q$));
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('P3c the teacher now sees the forwarded message',
  test.count('select count(*) from contact_requests') = 1);
select test.asuser('aaaa0000-0000-4000-8000-00000000a008');  -- teachA2
select test.check('P3d another teacher does not',
  test.count('select count(*) from contact_requests') = 0);
select test.asuser('aaaa0000-0000-4000-8000-00000000b001');  -- adminB
select test.check('P3e school B office does not',
  test.count('select count(*) from contact_requests') = 0);
reset role;
select test.check('P4  school office got a "parent_message" alert',
  test.count($q$ select count(*) from notification_outbox where payload->>'kind' = 'parent_message' $q$) >= 1);
set role authenticated;

select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
select test.check('P5a parent sees only own child''s class membership, not the full roster',
  test.count('select count(*) from class_members') = 1);
select test.check('P5b parent sees homework of own child''s class only (not 5-B)',
  test.count('select count(*) from homework') = 1);
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('P5c teacher CANNOT read a parent''s phone (contact goes through the office)',
  test.count($q$ select count(*) from profiles where user_id = 'aaaa0000-0000-4000-8000-00000000a005' $q$) = 0);
select test.check('P5d teacher CAN read a colleague''s profile (zavuch)',
  test.count($q$ select count(*) from profiles where user_id = 'aaaa0000-0000-4000-8000-00000000a003' $q$) = 1);

-- ===========================================================================
-- X: escalation, audit, drafts
-- ===========================================================================
select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
select test.check('X1a zavuch CANNOT make themselves school admin',
  not test.rows($q$ insert into user_school_roles (user_id, role, school_id)
     values ('aaaa0000-0000-4000-8000-00000000a003','school_admin','bbbb0000-0000-4000-8000-00000000a001') $q$));
select test.asuser('aaaa0000-0000-4000-8000-00000000a001');  -- adminA
select test.check('X1b school admin CAN make a teacher zavuch',
  test.rows($q$ insert into user_school_roles (user_id, role, school_id)
     values ('aaaa0000-0000-4000-8000-00000000a008','zavuch','bbbb0000-0000-4000-8000-00000000a001') $q$));
select test.check('X1c school admin CANNOT create a district admin',
  not test.rows($q$ insert into user_school_roles (user_id, role, district_id)
     values ('aaaa0000-0000-4000-8000-00000000a008','district_admin',101) $q$));
select test.check('X1d school admin CANNOT add roles in school B',
  not test.rows($q$ insert into user_school_roles (user_id, role, school_id)
     values ('aaaa0000-0000-4000-8000-00000000a008','teacher','bbbb0000-0000-4000-8000-00000000b001') $q$));
select test.check('X2a school admin sees own school''s audit trail',
  test.count($q$ select count(*) from audit_log where school_id = 'bbbb0000-0000-4000-8000-00000000a001' $q$) >= 1);
select test.check('X2b ... but not platform-level rows (no school)',
  test.count('select count(*) from audit_log where school_id is null') = 0);

select test.asuser('aaaa0000-0000-4000-8000-00000000a006');  -- studA1
select test.check('X3  student CANNOT see a DRAFT test or its questions',
  test.count($q$ select count(*) from weekly_tests where status = 'draft' $q$) = 0);
select test.check('X4  student CANNOT raise a staff problem',
  not test.rows($q$ insert into problems (school_id, raised_by, category, severity, description)
     values ('bbbb0000-0000-4000-8000-00000000a001','aaaa0000-0000-4000-8000-00000000a006','x','small','x') $q$));
