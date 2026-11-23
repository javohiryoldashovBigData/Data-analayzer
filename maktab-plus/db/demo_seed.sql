-- ============================================================================
-- MAKTAB+ — DEMO SCHOOL ("Maktab+ Namuna maktabi", address: demo)
--
-- Sample data ONLY (invented people). Never load this into production.
-- Load order (fresh database):
--   local_compat → schema → api_phase1 → round4_roles_signals → weekly_tests_gen
--   → curriculum → quiet_hours → demo_seed → demo_login
-- Dates are RELATIVE to current_date, so the demo always looks "live".
--
-- 3 classes (5-A, 7-A, 8-A) × 12 students, 6 subject teachers, director,
-- zavuch, school admin, one parent (Dilshod) with two children (Sardor 8-A,
-- Temur 5-A); Sardor also has his own student login.
-- ============================================================================
-- deterministic "random" 0..999 from any text
create or replace function pg_temp.rnd(p text) returns int language sql immutable as
$$ select abs(('x' || substr(md5(p), 1, 8))::bit(32)::int) % 1000 $$;

-- partitions for the previous 2 months (schema creates current month onward)
do $$
declare d date; i int;
begin
  for i in 1..2 loop
    d := (date_trunc('month', current_date) - (i || ' months')::interval)::date;
    execute format('create table if not exists attendance_logs_%s partition of attendance_logs for values from (%L) to (%L)',
                   to_char(d, 'YYYY_MM'), d, (d + interval '1 month')::date);
    execute format('create table if not exists gate_events_%s partition of gate_events for values from (%L) to (%L)',
                   to_char(d, 'YYYY_MM'), d::timestamptz, (d + interval '1 month')::timestamptz);
  end loop;
end $$;

-- ---- geography, calendar, subjects ----------------------------------------
insert into regions (id, name_uz, name_ru) values (1, 'Toshkent shahri', 'Ташкент') on conflict do nothing;
insert into districts (id, region_id, name_uz, name_ru) values (101, 1, 'Yunusobod', 'Юнусабадский') on conflict do nothing;

insert into academic_years (id, start_date, end_date, is_current) values (2026, '2026-09-02', '2027-05-31', true)
on conflict do nothing;
insert into terms (id, academic_year_id, number, start_date, end_date, is_current) values
 ('d7000000-0000-4000-8000-000000000001', 2026, 1, '2026-09-02', '2026-11-01', false),
 ('d7000000-0000-4000-8000-000000000002', 2026, 2, '2026-11-09', '2026-12-28', true),
 ('d7000000-0000-4000-8000-000000000003', 2026, 3, '2027-01-11', '2027-03-20', false),
 ('d7000000-0000-4000-8000-000000000004', 2026, 4, '2027-03-30', '2027-05-31', false)
on conflict do nothing;

insert into subjects (id, name_uz, name_ru, code) values
 (1, 'Matematika',  'Математика',  'MATH'),
 (2, 'Ingliz tili', 'Английский',  'ENG'),
 (3, 'Ona tili',    'Родной язык', 'UZB'),
 (4, 'Fizika',      'Физика',      'PHYS'),
 (5, 'Tarix',       'История',     'HIST'),
 (6, 'Biologiya',   'Биология',    'BIO')
on conflict do nothing;

-- ---- the school window ----------------------------------------------------
-- Standard plan (AI for teachers only, Haiku), hard AI cap $8/month (~10% of a
-- 1,000,000 so'm monthly fee — estimate). No Pro trial in the demo.
insert into schools (id, district_id, name, mode, slug, brand_color, plan, pro_trial_until, ai_monthly_cap_cents) values
 ('d5000000-0000-4000-8000-000000000001', 101, 'Maktab+ Namuna maktabi', 'private', 'demo', '#0f766e',
  'standard', null, 800);

-- ---- people with logins ---------------------------------------------------
create temp table demo_people (id uuid, first text, last text, phone text, role user_role, tag text);
insert into demo_people values
 ('d1000000-0000-4000-8000-000000000001','Nodira','Sattorova','+998900000101','director','director'),
 ('d1000000-0000-4000-8000-000000000002','Jamshid','Tolipov','+998900000102','zavuch','zavuch'),
 ('d1000000-0000-4000-8000-000000000003','Oybek','Rahimov','+998900000103','school_admin','admin'),
 ('d1000000-0000-4000-8000-000000000011','Aziza','Karimova','+998900000111','teacher','t1'),     -- maths, class teacher 7-A
 ('d1000000-0000-4000-8000-000000000012','Kamola','Yusupova','+998900000112','teacher','t2'),    -- English, class teacher 5-A
 ('d1000000-0000-4000-8000-000000000013','Shavkat','Ergashev','+998900000113','teacher','t3'),   -- Ona tili, class teacher 8-A
 ('d1000000-0000-4000-8000-000000000014','Bahodir','Nazarov','+998900000114','teacher','t4'),    -- Physics
 ('d1000000-0000-4000-8000-000000000015','Gulnora','Ahmedova','+998900000115','teacher','t5'),   -- History
 ('d1000000-0000-4000-8000-000000000016','Lola','Mirzayeva','+998900000116','teacher','t6'),     -- Biology
 ('d1000000-0000-4000-8000-000000000021','Dilshod','Rahimov','+998900000121','parent','parent'),
 ('d1000000-0000-4000-8000-000000000031','Sardor','Rahimov', null,           'student','student');

insert into auth.users (id, email) select id, tag || '@demo.maktab.test' from demo_people;
insert into profiles (user_id, first_name, last_name, phone) select id, first, last, phone from demo_people;
insert into user_school_roles (user_id, role, school_id)
select id, role, 'd5000000-0000-4000-8000-000000000001' from demo_people;

insert into teachers (id, school_id, user_id)
select ('d2000000-0000-4000-8000-00000000000' || right(tag, 1))::uuid, 'd5000000-0000-4000-8000-000000000001', id
from demo_people where role = 'teacher';
-- teacher dN teaches subject N

-- ---- classes ---------------------------------------------------------------
insert into classes (id, school_id, academic_year_id, grade_level, letter, class_teacher_id) values
 ('d3000000-0000-4000-8000-000000000005','d5000000-0000-4000-8000-000000000001',2026,5,'A','d2000000-0000-4000-8000-000000000002'),
 ('d3000000-0000-4000-8000-000000000007','d5000000-0000-4000-8000-000000000001',2026,7,'A','d2000000-0000-4000-8000-000000000001'),
 ('d3000000-0000-4000-8000-000000000008','d5000000-0000-4000-8000-000000000001',2026,8,'A','d2000000-0000-4000-8000-000000000003');

-- ---- students (12 per class) ------------------------------------------------
create temp table demo_names (cls int, n int, first text, last text, g gender);
insert into demo_names values
 (5,1,'Temur','Rahimov','m'),(5,2,'Madina','Aliyeva','f'),(5,3,'Jasur','Yusupov','m'),(5,4,'Sevara','Qodirova','f'),
 (5,5,'Ali','Karimov','m'),(5,6,'Zarina','Toshpo''latova','f'),(5,7,'Bobur','Saidov','m'),(5,8,'Malika','Hasanova','f'),
 (5,9,'Azizbek','Normatov','m'),(5,10,'Dilnoza','Ismoilova','f'),(5,11,'Sherzod','Xolmatov','m'),(5,12,'Nilufar','Ergasheva','f'),
 (7,1,'Bekzod','Tursunov','m'),(7,2,'Otabek','Karimov','m'),(7,3,'Shahzoda','Umarova','f'),(7,4,'Bobur','Mirzayev','m'),
 (7,5,'Doniyor','Xolmatov','m'),(7,6,'Islom','Sobirov','m'),(7,7,'Mohira','Abdullayeva','f'),(7,8,'Sardorbek','Qosimov','m'),
 (7,9,'Gulnoza','Rashidova','f'),(7,10,'Javohir','Ortiqov','m'),(7,11,'Kamila','Yo''ldosheva','f'),(7,12,'Ulug''bek','Nurmatov','m'),
 (8,1,'Sardor','Rahimov','m'),(8,2,'Laylo','Azimova','f'),(8,3,'Akmal','Hamidov','m'),(8,4,'Feruza','Sultonova','f'),
 (8,5,'Diyor','Raxmatov','m'),(8,6,'Munisa','Olimova','f'),(8,7,'Asadbek','Valiyev','m'),(8,8,'Charos','Jo''rayeva','f'),
 (8,9,'Shohruh','Mamatov','m'),(8,10,'Sabina','Yoqubova','f'),(8,11,'Firdavs','Bakirov','m'),(8,12,'Ozoda','Tojiyeva','f');

insert into students (id, school_id, user_id, first_name, last_name, gender, birth_date)
select ('d4000000-0000-4000-8000-0000000' || lpad((cls * 100 + n)::text, 5, '0'))::uuid,
       'd5000000-0000-4000-8000-000000000001',
       case when cls = 8 and n = 1 then 'd1000000-0000-4000-8000-000000000031'::uuid end,
       first, last, g, make_date(2026 - cls - 6, 1 + pg_temp.rnd(first || last) % 12, 1 + pg_temp.rnd(last) % 28)
from demo_names;

insert into class_members (class_id, student_id)
select ('d3000000-0000-4000-8000-00000000000' || cls)::uuid,
       ('d4000000-0000-4000-8000-0000000' || lpad((cls * 100 + n)::text, 5, '0'))::uuid
from demo_names;

insert into guardians (parent_user_id, student_id, relation, is_primary) values
 ('d1000000-0000-4000-8000-000000000021', 'd4000000-0000-4000-8000-000000000801', 'father', true),  -- Sardor 8-A
 ('d1000000-0000-4000-8000-000000000021', 'd4000000-0000-4000-8000-000000000501', 'father', true);  -- Temur 5-A

-- ---- teaching assignments, bells, rooms, timetable --------------------------
insert into teacher_assignments (teacher_id, class_id, subject_id, academic_year_id)
select ('d2000000-0000-4000-8000-00000000000' || s)::uuid, c.id, s, 2026
from generate_series(1, 6) s cross join classes c
where c.school_id = 'd5000000-0000-4000-8000-000000000001';

insert into bell_periods (school_id, number, start_time, end_time) values
 ('d5000000-0000-4000-8000-000000000001',1,'08:00','08:45'),
 ('d5000000-0000-4000-8000-000000000001',2,'08:55','09:40'),
 ('d5000000-0000-4000-8000-000000000001',3,'09:50','10:35'),
 ('d5000000-0000-4000-8000-000000000001',4,'10:55','11:40'),
 ('d5000000-0000-4000-8000-000000000001',5,'11:50','12:35');
insert into rooms (school_id, name) values
 ('d5000000-0000-4000-8000-000000000001','105-xona'),
 ('d5000000-0000-4000-8000-000000000001','115-xona'),
 ('d5000000-0000-4000-8000-000000000001','125-xona');

-- subject at (class index ci, day d, period p) = ((d + p + ci) mod 6) + 1
-- → at any moment the 3 classes have 3 different subjects, so no teacher clash.
insert into timetable_slots (class_id, day_of_week, period, subject_id, teacher_id, room_id, effective_from)
select c.id, d, p, s, ('d2000000-0000-4000-8000-00000000000' || s)::uuid,
       (select r.id from rooms r where r.school_id = c.school_id order by r.name offset ci limit 1),
       '2026-09-01'
from (select id, school_id, row_number() over (order by grade_level) - 1 as ci from classes
      where school_id = 'd5000000-0000-4000-8000-000000000001') c
cross join generate_series(1, 6) d
cross join generate_series(1, 5) p
cross join lateral (select ((d + p + c.ci) % 6)::int + 1 as s) x;

-- ---- lessons that already happened (last ~6 weeks) ---------------------------
create temp table demo_lessons as
select day::date as lesson_date, ts.class_id, ts.period, ts.subject_id, ts.teacher_id,
       (select t.id from terms t where day::date between t.start_date and t.end_date) as term_id
from generate_series(current_date - 42, current_date - 1, interval '1 day') day
join timetable_slots ts on ts.day_of_week = extract(isodow from day)::int
join classes c on c.id = ts.class_id and c.school_id = 'd5000000-0000-4000-8000-000000000001';

-- grades: about 1 in 4 students graded per lesson; each student has an
-- "ability" (3.2–4.8). Bekzod (7-A) falls in the last 3 weeks (shows as at risk).
insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, created_by, comment, created_at)
select cm.student_id, l.subject_id, l.term_id, 'current',
       greatest(2, least(5, round(
         3.2 + (pg_temp.rnd(cm.student_id::text) % 17) / 10.0
         + ((pg_temp.rnd(cm.student_id::text || l.lesson_date || l.period) % 100) - 50) / 55.0
         - case when cm.student_id = 'd4000000-0000-4000-8000-000000000701' and l.lesson_date > current_date - 21 then 1.6 else 0 end
       )))::smallint,
       l.teacher_id, (select t.user_id from teachers t where t.id = l.teacher_id),
       null, l.lesson_date + time '12:00'
from demo_lessons l
join class_members cm on cm.class_id = l.class_id
where l.term_id is not null
  and pg_temp.rnd(cm.student_id::text || l.lesson_date || l.period || 'g') % 4 = 0;

-- attendance for the last 3 weeks (whole roster per lesson)
insert into attendance_logs (student_id, class_id, date, period, subject_id, teacher_id, status, marked_by, marked_at)
select cm.student_id, l.class_id, l.lesson_date, l.period, l.subject_id, l.teacher_id,
       case
         when cm.student_id = 'd4000000-0000-4000-8000-000000000701'
              and pg_temp.rnd(cm.student_id::text || l.lesson_date) % 4 = 0 then 'absent'
         when pg_temp.rnd(cm.student_id::text || l.lesson_date) % 40 = 0 then 'absent'
         when pg_temp.rnd(cm.student_id::text || l.lesson_date || l.period) % 45 = 0 then 'late'
         else 'present' end::attendance_status,
       (select t.user_id from teachers t where t.id = l.teacher_id),
       l.lesson_date + time '13:00'
from demo_lessons l
join class_members cm on cm.class_id = l.class_id
where l.lesson_date >= current_date - 21;

-- gate check-ins: every school day of the last 3 weeks + today morning
insert into gate_events (school_id, student_id, direction, method, scanned_at)
select 'd5000000-0000-4000-8000-000000000001', cm.student_id, dir, 'qr',
       (day::date + case dir when 'in' then time '07:35' else time '13:40' end
        + make_interval(mins => pg_temp.rnd(cm.student_id::text || day || dir) % 22)) at time zone 'Asia/Tashkent'
from generate_series(current_date - 21, current_date, interval '1 day') day
join class_members cm on cm.class_id in (select id from classes where school_id = 'd5000000-0000-4000-8000-000000000001')
cross join (values ('in'::gate_direction), ('out'::gate_direction)) g(dir)
where extract(isodow from day) between 1 and 6
  and not (day::date = current_date and dir = 'out')                       -- today: nobody has left yet
  and not (day::date = current_date and cm.student_id in                   -- today: two have not arrived
           ('d4000000-0000-4000-8000-000000000507','d4000000-0000-4000-8000-000000000712'))
  and not exists (select 1 from attendance_logs a where a.student_id = cm.student_id and a.date = day::date
                  and a.status = 'absent' and a.period = 1
                  and pg_temp.rnd(cm.student_id::text || day) % 40 = 0);

-- ---- homework, a lesson card, a pending absence report, a problem -------------
insert into homework (class_id, subject_id, teacher_id, assigned_at, due_date, description)
select distinct on (l.class_id, l.subject_id) l.class_id, l.subject_id, l.teacher_id, l.lesson_date, l.lesson_date + 2,
       case l.subject_id when 1 then '45-bet, 1–6-misollar' when 2 then 'Unit 4: new words, exercise 3'
            when 3 then 'Insho: "Mening oilam" (1 bet)' when 4 then '§12 o''qish, 3-savol'
            when 5 then 'Amir Temur davri — konspekt' else 'Hujayra tuzilishi — rasm chizish' end
from demo_lessons l order by l.class_id, l.subject_id, l.lesson_date desc;

insert into parent_absence_reports (school_id, student_id, parent_user_id, absence_date, reason)
values ('d5000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000501',
        'd1000000-0000-4000-8000-000000000021', current_date + 1, 'Shifokor qabuli (tish shifokori)');

insert into problems (school_id, raised_by, category, severity, description) values
 ('d5000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000014','plan_missing','small',
  '8-A fizika: keyingi haftaning dars rejasi hali kiritilmagan'),
 ('d5000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000011','other','serious',
  '7-A: Bekzod Tursunov oxirgi 3 haftada baholari keskin pasaydi, ota-ona bilan uchrashuv kerak');

insert into library_items (subject_id, grade_level, topic, kind, title, status, language) values
 (1, 7, 'Chiziqli tenglamalar', 'animation', 'Chiziqli tenglama — tarozi misolida (1 daqiqa)', 'checked', 'uz'),
 (2, 8, 'Present Perfect Continuous', 'animation', 'Present Perfect Continuous — 1 daqiqada', 'checked', 'uz');

-- refresh last-touch so the outbox from the seed does not look like live alerts
update notification_outbox set status = 'sent', processed_at = now();

-- ---- demo logins (needs auth_local.sql loaded first) -------------------------
-- Same demo password for everyone: maktab2026. Shown on the demo login page.
-- Kamola (English teacher) is ALSO the mother of Madina (5-A): she sees the
-- "who are you today?" chooser after login.
insert into user_school_roles (user_id, role, school_id) values
 ('d1000000-0000-4000-8000-000000000012', 'parent', 'd5000000-0000-4000-8000-000000000001');
insert into guardians (parent_user_id, student_id, relation, is_primary) values
 ('d1000000-0000-4000-8000-000000000012', 'd4000000-0000-4000-8000-000000000502', 'mother', true);

select app.set_password(id, coalesce(phone, 'sardor.r'), 'maktab2026')
from demo_people where tag in ('director','zavuch','admin','t1','t2','t3','t4','t5','t6','parent','student');

-- ---- weekly tests (step 4) -------------------------------------------------
-- The school's own question bank (checked by the teacher who wrote them).
create temp table demo_q (grade int, topic text, q text, opts jsonb);
insert into demo_q values
 (7,'Chiziqli tenglamalar','2x + 4 = 10 bo''lsa, x = ?','["3","7","2","5"]'),
 (7,'Chiziqli tenglamalar','3x − 6 = 0 bo''lsa, x = ?','["2","−2","6","3"]'),
 (7,'Chiziqli tenglamalar','x/2 = 5 bo''lsa, x = ?','["10","2.5","7","3"]'),
 (7,'Chiziqli tenglamalar','5x = 3x + 8 bo''lsa, x = ?','["4","8","2","1"]'),
 (7,'Chiziqli tenglamalar','Tenglamaning ildizi nima?','["Tenglikni to''g''ri qiladigan son","Eng katta son","Koeffitsient","Ozod had"]'),
 (7,'Chiziqli tenglamalar','7 − x = 2 bo''lsa, x = ?','["5","9","−5","2"]'),
 (7,'Kasrlar','1/2 + 1/4 = ?','["3/4","2/6","1/8","1"]'),
 (7,'Kasrlar','2/3 − 1/3 = ?','["1/3","1","0","2/3"]'),
 (7,'Kasrlar','3/4 · 2 = ?','["3/2","6/8","3/8","5/4"]'),
 (7,'Kasrlar','5/6 va 2/3 dan qaysi biri katta?','["5/6","2/3","Teng","Aniqlab bo''lmaydi"]'),
 (7,'Foizlar','200 ning 10% i = ?','["20","10","2","200"]'),
 (7,'Foizlar','50 ning 50% i = ?','["25","50","5","100"]'),
 (7,'Foizlar','80 ni 25% ga oshirsak?','["100","105","60","85"]'),
 (8,'Kvadrat ildizlar','√49 = ?','["7","49","24.5","−49"]'),
 (8,'Kvadrat ildizlar','√16 + √9 = ?','["7","5","25","12"]'),
 (8,'Kvadrat ildizlar','√(25 · 4) = ?','["10","20","100","29"]'),
 (8,'Kvadrat ildizlar','√81 − √36 = ?','["3","45","9","15"]'),
 (8,'Kvadrat ildizlar','(√5)² = ?','["5","25","√5","10"]');
-- the right answer is always written first above; shuffle each question's options deterministically
create temp table demo_q2 as
select dq.*, (select jsonb_agg(o.v order by md5(dq.q || o.v::text)) from jsonb_array_elements(dq.opts) o(v)) as shuffled
from demo_q dq;
with ins as (
  insert into question_bank (school_id, subject_id, grade_level, topic, language, question_text, options, status, source, created_by, checked_by)
  select 'd5000000-0000-4000-8000-000000000001', 1, grade, topic, 'uz', q, shuffled, 'checked', 'teacher',
         'd1000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000011'
  from demo_q2 returning id, question_text, options)
insert into question_bank_keys (question_id, correct_index)
select ins.id, (select (o.i - 1)::smallint from jsonb_array_elements(ins.options) with ordinality o(v, i)
                where o.v = (select dq.opts->0 from demo_q2 dq where dq.q = ins.question_text limit 1))
from ins;

-- A past 7-A test on "Kasrlar" 3 weeks ago (class got ~60%), so the generator
-- brings fractions back as a REVIEW topic in this week's test.
insert into weekly_tests (id, school_id, class_id, subject_id, teacher_id, term_id, test_date, topic, status)
values ('d6000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000007',1,
        'd2000000-0000-4000-8000-000000000001',
        coalesce((select id from terms where current_date - 21 between start_date and end_date), 'd7000000-0000-4000-8000-000000000002'),
        current_date - 21, 'Kasrlar', 'closed');
with qs as (
  insert into test_questions (test_id, question_text, options, points, position, topic, bank_question_id)
  select 'd6000000-0000-4000-8000-000000000001', qb.question_text, qb.options, 1, row_number() over (order by qb.question_text), qb.topic, qb.id
  from question_bank qb where qb.topic = 'Kasrlar' returning id, bank_question_id)
insert into test_answer_keys (question_id, correct_index)
select qs.id, k.correct_index from qs join question_bank_keys k on k.question_id = qs.bank_question_id;
insert into test_attempts (test_id, student_id, mode, started_at, submitted_at)
select 'd6000000-0000-4000-8000-000000000001', cm.student_id, 'online', now() - interval '21 days', now() - interval '21 days'
from class_members cm where cm.class_id = 'd3000000-0000-4000-8000-000000000007';
insert into attempt_answers (attempt_id, question_id, position, answer, is_correct)
select ta.id, q.id, q.position,
       to_jsonb(case when pg_temp.rnd(ta.student_id::text || q.id) % 10 < 6 then k.correct_index else (k.correct_index + 1) % 4 end),
       pg_temp.rnd(ta.student_id::text || q.id) % 10 < 6
from test_attempts ta join test_questions q on q.test_id = ta.test_id join test_answer_keys k on k.question_id = q.id
where ta.test_id = 'd6000000-0000-4000-8000-000000000001';
update test_attempts ta set score = (select round(100.0 * count(*) filter (where aa.is_correct) / count(*), 2)
                                     from attempt_answers aa where aa.attempt_id = ta.id)
where ta.test_id = 'd6000000-0000-4000-8000-000000000001';

-- A PUBLISHED 8-A test this week on "Kvadrat ildizlar" for Sardor to take.
insert into weekly_tests (id, school_id, class_id, subject_id, teacher_id, term_id, test_date, topic, status)
values ('d6000000-0000-4000-8000-000000000002','d5000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000008',1,
        'd2000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000002', current_date, 'Kvadrat ildizlar', 'published');
with qs as (
  insert into test_questions (test_id, question_text, options, points, position, topic, bank_question_id)
  select 'd6000000-0000-4000-8000-000000000002', qb.question_text, qb.options, 1, row_number() over (order by qb.question_text), qb.topic, qb.id
  from question_bank qb where qb.topic = 'Kvadrat ildizlar' returning id, bank_question_id)
insert into test_answer_keys (question_id, correct_index)
select qs.id, k.correct_index from qs join question_bank_keys k on k.question_id = qs.bank_question_id;
-- some classmates have already finished it
insert into test_attempts (test_id, student_id, mode, submitted_at)
select 'd6000000-0000-4000-8000-000000000002', cm.student_id, 'online', now() - interval '2 hours'
from class_members cm where cm.class_id = 'd3000000-0000-4000-8000-000000000008'
  and cm.student_id <> 'd4000000-0000-4000-8000-000000000801' and pg_temp.rnd(cm.student_id::text) % 3 > 0;
insert into attempt_answers (attempt_id, question_id, position, answer, is_correct)
select ta.id, q.id, q.position,
       to_jsonb(case when pg_temp.rnd(ta.student_id::text || q.id) % 10 < 7 then k.correct_index else (k.correct_index + 1) % 4 end),
       pg_temp.rnd(ta.student_id::text || q.id) % 10 < 7
from test_attempts ta join test_questions q on q.test_id = ta.test_id join test_answer_keys k on k.question_id = q.id
where ta.test_id = 'd6000000-0000-4000-8000-000000000002';
update test_attempts ta set score = (select round(100.0 * count(*) filter (where aa.is_correct) / count(*), 2)
                                     from attempt_answers aa where aa.attempt_id = ta.id)
where ta.test_id = 'd6000000-0000-4000-8000-000000000002';

-- ---- curriculum + past approved lesson cards (step 5) ------------------------
-- Our own code (api.next_topics) picks the next topic from the programme; the
-- AI only writes the plan. Sample programme, not the official one.
insert into curriculum_topics (subject_id, grade_level, language, seq, term_no, hours, topic, objectives) values
 (1,5,'uz',1,2,3,'Natural sonlar','Natural sonlarni taqqoslash va yaxlitlash'),
 (1,5,'uz',2,2,4,'Kasrlar','Oddiy kasrlarni qo''shish va ayirish'),
 (1,5,'uz',3,2,4,'O''nli kasrlar','O''nli kasrlarni yozish va taqqoslash'),
 (1,7,'uz',1,2,3,'Ratsional sonlar','Ratsional sonlar ustida amallar'),
 (1,7,'uz',2,2,3,'Kasrlar','Kasrlarni qo''shish, ayirish, ko''paytirish'),
 (1,7,'uz',3,2,2,'Foizlar','Sonning foizini topish'),
 (1,7,'uz',4,2,4,'Chiziqli tenglamalar','ax + b = 0 ko''rinishidagi tenglamalarni yechish'),
 (1,7,'uz',5,2,3,'Tengsizliklar','Chiziqli tengsizliklarni yechish'),
 (1,8,'uz',1,2,3,'Ko''phadlar','Ko''phadlarni qo''shish va ko''paytirish'),
 (1,8,'uz',2,2,3,'Ko''paytuvchilarga ajratish','Umumiy ko''paytuvchini qavsdan chiqarish'),
 (1,8,'uz',3,2,4,'Kvadrat ildizlar','Kvadrat ildiz xossalari va hisoblash'),
 (1,8,'uz',4,2,4,'Kvadrat tenglamalar','To''liq kvadrat tenglamalarni yechish');

-- the most recent past maths lessons of each class get approved cards with the
-- programme's earlier topics, so "next topic" continues from there
insert into lesson_cards (school_id, class_id, subject_id, teacher_id, lesson_date, period, topic, status, approved_by, approved_at)
select 'd5000000-0000-4000-8000-000000000001', x.class_id, 1, x.teacher_id, x.lesson_date, x.period, p.topic, 'approved',
       'd1000000-0000-4000-8000-000000000011', x.lesson_date + time '07:30'
from (select l.*, c.grade_level, row_number() over (partition by l.class_id order by l.lesson_date desc, l.period desc) as back
      from demo_lessons l join classes c on c.id = l.class_id where l.subject_id = 1) x
join (select ct.grade_level, ct.topic, row_number() over (partition by ct.grade_level order by ct.seq desc, g.i desc) as back
      from curriculum_topics ct cross join lateral generate_series(1, ct.hours) g(i)
      where ct.subject_id = 1 and ((ct.grade_level = 5 and ct.seq <= 1) or (ct.grade_level = 7 and ct.seq <= 3)
                                   or (ct.grade_level = 8 and ct.seq <= 2))) p
  on p.grade_level = x.grade_level and p.back = x.back
on conflict do nothing;

-- Library first: a CHECKED lesson card for 8th-grade "Kvadrat ildizlar" — used
-- with no AI cost when 8-A reaches that topic.
insert into library_items (subject_id, grade_level, topic, kind, title, status, language, content, methodologist_id) values
 (1, 8, 'Kvadrat ildizlar', 'lesson_card', 'Kvadrat ildizlar — dars kartasi (tekshirilgan)', 'checked', 'uz',
  '{"plan":"1) Takrorlash: kvadratga ko''tarish (5 daq)\n2) Yangi mavzu: √a — kvadrati a ga teng bo''lgan son; maydon misoli (15 daq)\n3) Juftlikda mashq: √16, √49, √(25·4) (15 daq)\n4) Xatolar ustida ishlash (5 daq)\n5) Chiqish savollari (5 daq)",
    "homework":"52-bet, 1–6-misollar",
    "exit_questions":["√64 = ?","√9 + √16 = ?","Nega √(−4) haqiqiy son emas?"]}', null);
