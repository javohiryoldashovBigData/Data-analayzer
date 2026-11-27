-- ============================================================================
-- MAKTAB+ — demo LEARNING CENTER (step 10). Load after demo_seed.sql.
-- Everything here is invented. Window: ?school=demo-markaz
-- Logins (password maktab2026): director +998 90 000 02 01, manager 02 03,
-- teachers 02 11 / 02 12 / 02 13, parent 02 21, adult student 02 31.
-- ============================================================================
create or replace function pg_temp.rnd(t text) returns int language sql immutable as $$
  select abs(hashtext(t)) $$;

insert into schools (id, district_id, name, mode, slug, brand_color, plan, ai_monthly_cap_cents, org_kind) values
 ('e5000000-0000-4000-8000-000000000001', 101, 'Bilim Plus o''quv markazi', 'private', 'demo-markaz', '#b45309', 'standard', 800, 'center');

-- lesson times of a center (morning to evening)
insert into bell_periods (school_id, number, start_time, end_time) values
 ('e5000000-0000-4000-8000-000000000001', 1, '09:00', '10:20'), ('e5000000-0000-4000-8000-000000000001', 2, '10:30', '11:50'),
 ('e5000000-0000-4000-8000-000000000001', 3, '12:00', '13:20'), ('e5000000-0000-4000-8000-000000000001', 4, '14:00', '15:20'),
 ('e5000000-0000-4000-8000-000000000001', 5, '15:30', '16:50'), ('e5000000-0000-4000-8000-000000000001', 6, '17:00', '18:20'),
 ('e5000000-0000-4000-8000-000000000001', 7, '18:30', '19:50'), ('e5000000-0000-4000-8000-000000000001', 8, '20:00', '21:20');
insert into rooms (school_id, name) values ('e5000000-0000-4000-8000-000000000001', '1-xona'), ('e5000000-0000-4000-8000-000000000001', '2-xona');

create temp table c_people (id uuid, first text, last text, phone text, role user_role);
insert into c_people values
 ('e1000000-0000-4000-8000-000000000001', 'Shaxlo', 'Umarova',   '+998900000201', 'director'),
 ('e1000000-0000-4000-8000-000000000003', 'Anvar',  'Qodirov',   '+998900000203', 'school_admin'),
 ('e1000000-0000-4000-8000-000000000011', 'Nilufar','Rashidova', '+998900000211', 'teacher'),   -- IELTS
 ('e1000000-0000-4000-8000-000000000012', 'Bobur',  'Aliyev',    '+998900000212', 'teacher'),   -- Math DTM
 ('e1000000-0000-4000-8000-000000000013', 'Diana',  'Kim',       '+998900000213', 'teacher'),   -- English for kids
 ('e1000000-0000-4000-8000-000000000021', 'Malika', 'Saidova',   '+998900000221', 'parent'),
 ('e1000000-0000-4000-8000-000000000031', 'Jasur',  'Toshmatov', '+998900000231', 'student');   -- adult, his own login
insert into auth.users (id, email) select id, 'c' || right(phone, 3) || '@demo-markaz.test' from c_people;
insert into profiles (user_id, first_name, last_name, phone) select id, first, last, phone from c_people;
insert into user_school_roles (user_id, role, school_id) select id, role, 'e5000000-0000-4000-8000-000000000001' from c_people;
insert into teachers (id, school_id, user_id) values
 ('e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000011'),
 ('e2000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000012'),
 ('e2000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000013');

-- groups (subject 2 = Ingliz tili, 1 = Matematika)
insert into classes (id, school_id, academic_year_id, name, course, subject_id, class_teacher_id, starts_on, ends_on, capacity) values
 ('e3000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', 2026, 'IELTS 6.5 — kechki', 'IELTS', 2,
  'e2000000-0000-4000-8000-000000000001', '2026-10-05', '2027-01-30', 12),
 ('e3000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000001', 2026, 'General English A2 — bolalar', 'Ingliz tili (bolalar)', 2,
  'e2000000-0000-4000-8000-000000000003', '2026-09-14', '2027-05-29', 10),
 ('e3000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000001', 2026, 'Matematika DTM', 'Abituriyent', 1,
  'e2000000-0000-4000-8000-000000000002', '2026-10-01', '2027-06-30', 15);
insert into timetable_slots (class_id, day_of_week, period, subject_id, teacher_id, effective_from)
select g, d, p, s, t, '2026-09-01' from (values
  ('e3000000-0000-4000-8000-000000000001'::uuid, 1, 7, 2, 'e2000000-0000-4000-8000-000000000001'::uuid),
  ('e3000000-0000-4000-8000-000000000001'::uuid, 3, 7, 2, 'e2000000-0000-4000-8000-000000000001'::uuid),
  ('e3000000-0000-4000-8000-000000000001'::uuid, 5, 7, 2, 'e2000000-0000-4000-8000-000000000001'::uuid),
  ('e3000000-0000-4000-8000-000000000002'::uuid, 2, 5, 2, 'e2000000-0000-4000-8000-000000000003'::uuid),
  ('e3000000-0000-4000-8000-000000000002'::uuid, 4, 5, 2, 'e2000000-0000-4000-8000-000000000003'::uuid),
  ('e3000000-0000-4000-8000-000000000002'::uuid, 6, 4, 2, 'e2000000-0000-4000-8000-000000000003'::uuid),
  ('e3000000-0000-4000-8000-000000000003'::uuid, 2, 6, 1, 'e2000000-0000-4000-8000-000000000002'::uuid),
  ('e3000000-0000-4000-8000-000000000003'::uuid, 4, 6, 1, 'e2000000-0000-4000-8000-000000000002'::uuid),
  ('e3000000-0000-4000-8000-000000000003'::uuid, 6, 6, 1, 'e2000000-0000-4000-8000-000000000002'::uuid)) v(g, d, p, s, t);
insert into teacher_assignments (teacher_id, class_id, subject_id, academic_year_id)
select distinct teacher_id, class_id, subject_id, 2026 from timetable_slots where class_id::text like 'e3000000%';

-- students: adults and children; some in two groups
create temp table c_students (n int, first text, last text, birth date, groups int[]);
insert into c_students values
 (1,'Jasur','Toshmatov','1996-03-11','{1}'), (2,'Dilnoza','Yusupova','1999-07-02','{1}'), (3,'Sardor','Mirzayev','2001-01-20','{1}'),
 (4,'Kamila','Ergasheva','2009-05-14','{1,3}'), (5,'Otabek','Nazarov','1994-11-30','{1}'), (6,'Madina','Rasulova','2000-08-08','{1}'),
 (7,'Shohruh','Hakimov','2010-02-17','{1,3}'), (8,'Laylo','Karimova','1998-12-01','{1}'),
 (9,'Ali','Saidov','2017-04-22','{2}'), (10,'Sevinch','Olimova','2016-09-09','{2}'), (11,'Temur','Bakirov','2017-01-15','{2}'),
 (12,'Mohira','Xolmatova','2016-06-30','{2}'), (13,'Asal','Rahimova','2017-10-05','{2}'), (14,'Doniyor','Usmonov','2016-12-12','{2}'),
 (15,'Bekzod','Saidov','2011-03-03','{3}'), (16,'Islom','Qodirov','2010-07-19','{3}'), (17,'Nodir','Tursunov','2010-05-25','{3}'),
 (18,'Feruza','Abdullayeva','2011-02-14','{3}');
insert into students (id, school_id, first_name, last_name, birth_date, gender, user_id)
select ('e4000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'e5000000-0000-4000-8000-000000000001', first, last, birth,
       (case when first in ('Dilnoza','Kamila','Madina','Laylo','Sevinch','Mohira','Asal','Feruza') then 'f' else 'm' end)::gender,
       case when n = 1 then 'e1000000-0000-4000-8000-000000000031'::uuid end
from c_students;
insert into class_members (class_id, student_id, enrolled_at)
select ('e3000000-0000-4000-8000-00000000000' || g)::uuid, ('e4000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '2026-10-05'
from c_students, unnest(groups) g;
-- Malika: mother of Ali (English for kids) and Bekzod (Math DTM)
insert into guardians (parent_user_id, student_id, relation, is_primary) values
 ('e1000000-0000-4000-8000-000000000021', 'e4000000-0000-4000-8000-000000000009', 'mother', true),
 ('e1000000-0000-4000-8000-000000000021', 'e4000000-0000-4000-8000-000000000015', 'mother', true);

-- the last 3 weeks of lessons: attendance + some grades
create temp table c_lessons as
select day::date as lesson_date, ts.class_id, ts.period, ts.subject_id, ts.teacher_id,
       (select t.id from terms t where day::date between t.start_date and t.end_date) as term_id
from generate_series(current_date - 21, current_date - 1, interval '1 day') day
join timetable_slots ts on ts.day_of_week = extract(isodow from day)::int and ts.class_id::text like 'e3000000%';
insert into attendance_logs (student_id, class_id, date, period, subject_id, teacher_id, status, marked_by, marked_at)
select cm.student_id, l.class_id, l.lesson_date, l.period, l.subject_id, l.teacher_id,
       (case when pg_temp.rnd(cm.student_id::text || l.lesson_date) % 13 = 0 then 'absent'
             when pg_temp.rnd(cm.student_id::text || l.lesson_date) % 11 = 0 then 'late' else 'present' end)::attendance_status,
       (select user_id from teachers where id = l.teacher_id), l.lesson_date + time '20:00'
from c_lessons l join class_members cm on cm.class_id = l.class_id;
insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, created_by, created_at)
select cm.student_id, l.subject_id, l.term_id, 'current',
       greatest(3, least(5, 3 + pg_temp.rnd(cm.student_id::text) % 3 + (pg_temp.rnd(cm.student_id::text || l.lesson_date) % 3 - 1)))::smallint,
       l.teacher_id, (select user_id from teachers where id = l.teacher_id), l.lesson_date + time '20:00'
from c_lessons l join class_members cm on cm.class_id = l.class_id
where l.term_id is not null and pg_temp.rnd(cm.student_id::text || l.lesson_date || 'g') % 3 = 0;

select app.set_password(id, phone, 'maktab2026') from c_people;
update notification_outbox set status = 'sent', processed_at = now() where status = 'pending';
