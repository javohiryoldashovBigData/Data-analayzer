-- ============================================================================
-- MAKTAB+ — tests for final_grades.sql (step 6: quarter + yearly grades).
-- Fresh database with the full stack + seed.sql, then this file.
-- ============================================================================
create schema if not exists test;
select set_config('test.passed', '0', false), set_config('test.failed', '0', false);
create or replace function test.asuser(p_user uuid) returns void language plpgsql as $$
begin perform set_config('app.current_user_id', p_user::text, false); end $$;
create or replace function test.val(p_sql text) returns text language plpgsql as $$
declare v text; begin execute p_sql into v; return v; end $$;
create or replace function test.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'no error'; exception when others then return sqlerrm; end $$;
create or replace function test.rows(p_sql text) returns boolean language plpgsql as $$
declare n bigint; begin execute p_sql; get diagnostics n = row_count; return n > 0;
exception when others then return false; end $$;
create or replace function test.check(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then
    perform set_config('test.passed', (current_setting('test.passed')::int + 1)::text, false);
    raise notice 'PASS  %', p_name;
  else
    perform set_config('test.failed', (current_setting('test.failed')::int + 1)::text, false);
    raise warning 'FAIL  %', p_name;
  end if;
end $$;
grant usage on schema test to authenticated;
grant execute on all functions in schema test to authenticated;

-- ids
--  school A bbbb…a001, class 5-A dddd…a001, MATH = 1, term ffff…a001
--  Jasur (sA1) eeee…a001, Malika (sA2) eeee…a002; teachA cccc…a001 (user a004)
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, created_by) values
 ('eeee0000-0000-4000-8000-00000000a001', 1, 'ffff0000-0000-4000-8000-00000000a001', 'current', 5, 'cccc0000-0000-4000-8000-00000000a001', 'aaaa0000-0000-4000-8000-00000000a004'),
 ('eeee0000-0000-4000-8000-00000000a001', 1, 'ffff0000-0000-4000-8000-00000000a001', 'current', 4, 'cccc0000-0000-4000-8000-00000000a001', 'aaaa0000-0000-4000-8000-00000000a004'),
 ('eeee0000-0000-4000-8000-00000000a001', 1, 'ffff0000-0000-4000-8000-00000000a001', 'current', 5, 'cccc0000-0000-4000-8000-00000000a001', 'aaaa0000-0000-4000-8000-00000000a004'),
 ('eeee0000-0000-4000-8000-00000000a002', 1, 'ffff0000-0000-4000-8000-00000000a001', 'current', 3, 'cccc0000-0000-4000-8000-00000000a001', 'aaaa0000-0000-4000-8000-00000000a004'),
 ('eeee0000-0000-4000-8000-00000000a002', 1, 'ffff0000-0000-4000-8000-00000000a001', 'current', 4, 'cccc0000-0000-4000-8000-00000000a001', 'aaaa0000-0000-4000-8000-00000000a004');

-- ---- quarter grades ---------------------------------------------------------
select test.check('F1 quarter sheet suggests 5 for Jasur (5,4,5) and nothing for Malika (only 2 grades)',
  test.val($q$ select string_agg(coalesce(x->>'suggested','none'), ',' order by x->>'last_name')
               from jsonb_array_elements(api.quarter_sheet('dddd0000-0000-4000-8000-00000000a001', 1::smallint)->'students') x $q$)
  = 'none,5');   -- Qodirova, Yusupov
select test.check('F2 the suggested grade is saved without a reason',
  test.err($q$ select api.save_quarter_grades('dddd0000-0000-4000-8000-00000000a001', 1::smallint, 'ffff0000-0000-4000-8000-00000000a001',
      '[{"student_id":"eeee0000-0000-4000-8000-00000000a001","value":5}]') $q$) = 'no error');
select test.check('F3 a grade without enough marks needs a short reason',
  test.err($q$ select api.save_quarter_grades('dddd0000-0000-4000-8000-00000000a001', 1::smallint, 'ffff0000-0000-4000-8000-00000000a001',
      '[{"student_id":"eeee0000-0000-4000-8000-00000000a002","value":3}]') $q$) = 'reason_required');
select test.check('F4 … with the reason it is saved',
  test.err($q$ select api.save_quarter_grades('dddd0000-0000-4000-8000-00000000a001', 1::smallint, 'ffff0000-0000-4000-8000-00000000a001',
      '[{"student_id":"eeee0000-0000-4000-8000-00000000a002","value":3,"note":"Kasal bo''ldi, og''zaki so''raldi"}]') $q$) = 'no error');
select test.check('F5 changing a quarter grade keeps ONE quarter grade (history in the audit log)',
  test.err($q$ select api.save_quarter_grades('dddd0000-0000-4000-8000-00000000a001', 1::smallint, 'ffff0000-0000-4000-8000-00000000a001',
      '[{"student_id":"eeee0000-0000-4000-8000-00000000a001","value":4,"note":"Oxirgi ishlar sustroq"}]') $q$) = 'no error'
  and test.val($q$ select count(*) from grades where student_id = 'eeee0000-0000-4000-8000-00000000a001' and grade_type = 'quarter' and deleted_at is null $q$) = '1');
select api.save_quarter_grades('dddd0000-0000-4000-8000-00000000a001', 1::smallint, 'ffff0000-0000-4000-8000-00000000a001',
      '[{"student_id":"eeee0000-0000-4000-8000-00000000a001","value":5}]');

select test.asuser('aaaa0000-0000-4000-8000-00000000a008');  -- teachA2: same school, does not teach 5-A
select test.check('F6 a teacher who does not teach the class can neither see nor save the sheet',
  test.err($q$ select api.quarter_sheet('dddd0000-0000-4000-8000-00000000a001', 1::smallint) $q$) = 'not_allowed'
  and test.err($q$ select api.save_quarter_grades('dddd0000-0000-4000-8000-00000000a001', 1::smallint, 'ffff0000-0000-4000-8000-00000000a001',
      '[{"student_id":"eeee0000-0000-4000-8000-00000000a001","value":2,"note":"x"}]') $q$) = 'not_allowed');
select test.asuser('aaaa0000-0000-4000-8000-00000000b002');  -- teachB: other school
select test.check('F7 another school''s teacher is refused',
  test.err($q$ select api.quarter_sheet('dddd0000-0000-4000-8000-00000000a001', 1::smallint) $q$) = 'not_allowed');
select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA (Jasur's mother)
select test.check('F8 the parent sees the quarter grade on the report card',
  test.val($q$ select api.report_card('eeee0000-0000-4000-8000-00000000a001')->0->'quarters'->>0 $q$) = '5');
select test.check('F9 … but not another child''s report card',
  test.val($q$ select jsonb_array_length(api.report_card('eeee0000-0000-4000-8000-00000000a002')) $q$) = '0');

-- ---- yearly grades ----------------------------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('F10 yearly grades cannot be proposed before the zavuch opens the window',
  test.err($q$ select api.propose_final_grades('dddd0000-0000-4000-8000-00000000a001', 1::smallint,
      '[{"student_id":"eeee0000-0000-4000-8000-00000000a001","value":5}]') $q$) = 'window_closed');
select test.check('F11 a teacher cannot open the window',
  test.err($q$ select api.set_final_window(true) $q$) = 'not_allowed');
select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
select test.check('F12 the zavuch opens the yearly-grades window',
  test.val($q$ select api.set_final_window(true)->>'open' $q$) = 'true');
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('F13 the teacher proposes the suggested yearly grade (5) without a reason',
  test.err($q$ select api.propose_final_grades('dddd0000-0000-4000-8000-00000000a001', 1::smallint,
      '[{"student_id":"eeee0000-0000-4000-8000-00000000a001","value":5}]') $q$) = 'no error');
select test.check('F14 the teacher can NOT write a yearly grade directly',
  not test.rows($q$ insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, created_by)
      values ('eeee0000-0000-4000-8000-00000000a001', 1, 'ffff0000-0000-4000-8000-00000000a001', 'final', 5,
              'cccc0000-0000-4000-8000-00000000a001', 'aaaa0000-0000-4000-8000-00000000a004') $q$));
select test.check('F15 … and can NOT mark own proposal as confirmed',
  not test.rows($q$ update final_grade_proposals set status = 'confirmed', confirmed_value = 5 $q$));
select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
select test.check('F16 the zavuch cannot confirm while a student has no proposal',
  test.err($q$ select api.confirm_final_grades('dddd0000-0000-4000-8000-00000000a001', 1::smallint) $q$) = 'proposals_missing');
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('F17 a yearly grade away from the suggestion needs a reason; with it, it is proposed',
  test.err($q$ select api.propose_final_grades('dddd0000-0000-4000-8000-00000000a001', 1::smallint,
      '[{"student_id":"eeee0000-0000-4000-8000-00000000a002","value":4}]') $q$) = 'reason_required'
  and test.err($q$ select api.propose_final_grades('dddd0000-0000-4000-8000-00000000a001', 1::smallint,
      '[{"student_id":"eeee0000-0000-4000-8000-00000000a002","value":4,"note":"Yil oxirida ancha o''sdi"}]') $q$) = 'no error');
select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
select test.check('F18 parents never see proposals, and no yearly grade yet',
  test.val('select count(*) from final_grade_proposals') = '0'
  and test.val($q$ select api.report_card('eeee0000-0000-4000-8000-00000000a001')->0->>'final' $q$) is null);
select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
select test.check('F19 the overview shows 2 proposed and 1 to look at (Malika, with a reason)',
  test.val($q$ select (r->>'proposed') || '/' || (r->>'to_check') from jsonb_array_elements(api.grades_overview()->'rows') r $q$) = '2/1');
select test.check('F20 the zavuch changing a grade must give a reason',
  test.err($q$ select api.confirm_final_grades('dddd0000-0000-4000-8000-00000000a001', 1::smallint,
      '[{"student_id":"eeee0000-0000-4000-8000-00000000a002","value":3}]') $q$) = 'reason_required');
select test.check('F21 the zavuch confirms the class (one grade changed, with a reason)',
  test.val($q$ select api.confirm_final_grades('dddd0000-0000-4000-8000-00000000a001', 1::smallint,
      '[{"student_id":"eeee0000-0000-4000-8000-00000000a002","value":3,"reason":"Choraklar 3, imtihon yo''q"}]')->>'confirmed' $q$) = '2');
reset role;
select test.check('F22 two real yearly grades written; Malika''s is the zavuch''s 3',
  (select count(*) from grades where grade_type = 'final' and deleted_at is null) = 2
  and (select value from grades where grade_type = 'final' and student_id = 'eeee0000-0000-4000-8000-00000000a002') = 3);
select test.check('F23 Jasur and his mother are told the grades are confirmed',
  (select count(*) from notification_outbox where payload->>'event' = 'final_grades_confirmed'
     and recipient_id in ('aaaa0000-0000-4000-8000-00000000a005', 'aaaa0000-0000-4000-8000-00000000a006')) = 2);
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA
select test.check('F24 the parent now sees the yearly grade',
  test.val($q$ select api.report_card('eeee0000-0000-4000-8000-00000000a001')->0->>'final' $q$) = '5');
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA
select test.check('F25 after confirmation the teacher cannot change the proposal',
  test.err($q$ select api.propose_final_grades('dddd0000-0000-4000-8000-00000000a001', 1::smallint,
      '[{"student_id":"eeee0000-0000-4000-8000-00000000a001","value":2,"note":"x"}]') $q$) = 'already_confirmed'
  and not test.rows($q$ update final_grade_proposals set proposed = 2 $q$));
select test.check('F26 … nor the real yearly grade',
  not test.rows($q$ update grades set value = 2 where grade_type = 'final' $q$));
select test.asuser('aaaa0000-0000-4000-8000-00000000b001');  -- adminB: other school
select test.check('F27 another school''s admin sees none of it and cannot confirm',
  test.val($q$ select count(*) from jsonb_array_elements(api.grades_overview()->'rows') r
              where r->>'class_id' = 'dddd0000-0000-4000-8000-00000000a001' $q$) = '0'
  and test.val('select count(*) from final_grade_proposals') = '0'
  and test.err($q$ select api.confirm_final_grades('dddd0000-0000-4000-8000-00000000a001', 1::smallint) $q$) = 'not_allowed');
select test.asuser('aaaa0000-0000-4000-8000-00000000b002');  -- teachB
select test.check('F28 a teacher cannot slip a proposal into another school''s class',
  not test.rows($q$ insert into final_grade_proposals (school_id, academic_year_id, class_id, subject_id, student_id, teacher_id, proposed)
      values ('bbbb0000-0000-4000-8000-00000000a001', 2026, 'dddd0000-0000-4000-8000-00000000a001', 1,
              'eeee0000-0000-4000-8000-00000000a001', 'cccc0000-0000-4000-8000-00000000b001', 5) $q$));
select test.asuser('aaaa0000-0000-4000-8000-00000000a006');  -- studA1 (Jasur)
select test.check('F29 the student sees own report card, cannot open the window',
  test.val($q$ select api.report_card('eeee0000-0000-4000-8000-00000000a001')->0->>'final' $q$) = '5'
  and test.err($q$ select api.set_final_window(true) $q$) = 'not_allowed');

reset role;
do $$
declare p int := current_setting('test.passed')::int; f int := current_setting('test.failed')::int;
begin
  if f > 0 then raise exception 'FINAL GRADES RESULT: % passed, % FAILED', p, f; end if;
  raise notice 'FINAL GRADES RESULT: all % scenarios passed', p;
end $$;
