-- ============================================================================
-- MAKTAB+ — tests for finance.sql (step 7: fees, payments, debts, accountant).
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

-- a new person who will become the accountant of school A
insert into auth.users (id, email) values ('aaaa0000-0000-4000-8000-00000000a009', 'accA@maktab.test');
insert into profiles (user_id, first_name, last_name, phone) values ('aaaa0000-0000-4000-8000-00000000a009', 'Barno', 'Xasanova', '+998901000011');
-- some grades + attendance exist (the accountant must NOT see them)
insert into grades (student_id, subject_id, term_id, grade_type, value, teacher_id, created_by) values
 ('eeee0000-0000-4000-8000-00000000a001', 1, 'ffff0000-0000-4000-8000-00000000a001', 'current', 5,
  'cccc0000-0000-4000-8000-00000000a001', 'aaaa0000-0000-4000-8000-00000000a004');

-- ---- appointing the accountant ----------------------------------------------
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
select test.check('M1 a zavuch cannot appoint an accountant',
  not test.rows($q$ insert into user_school_roles (user_id, role, school_id)
      values ('aaaa0000-0000-4000-8000-00000000a009', 'accountant', 'bbbb0000-0000-4000-8000-00000000a001') $q$));
select test.check('M2 … nor make themselves one',
  not test.rows($q$ insert into user_school_roles (user_id, role, school_id)
      values ('aaaa0000-0000-4000-8000-00000000a003', 'accountant', 'bbbb0000-0000-4000-8000-00000000a001') $q$));
select test.asuser('aaaa0000-0000-4000-8000-00000000a001');  -- adminA
select test.check('M3 the school admin appoints the accountant',
  test.rows($q$ insert into user_school_roles (user_id, role, school_id)
      values ('aaaa0000-0000-4000-8000-00000000a009', 'accountant', 'bbbb0000-0000-4000-8000-00000000a001') $q$));
reset role;
select test.check('M4 the director is told that someone got money access',
  (select count(*) from notification_outbox where recipient_id = 'aaaa0000-0000-4000-8000-00000000a002'
     and payload->>'event' = 'leader_role_changed' and payload->>'role' = 'accountant') = 1);
set role authenticated;

-- ---- fee settings ------------------------------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a009');  -- accountant
select test.check('M5 the accountant sets the 5th-grade monthly fee',
  test.err($q$ select api.set_fee_rate(5::smallint, 2000000) $q$) = 'no error');
select test.check('M6 a discount needs a reason',
  test.err($q$ select api.set_discount('eeee0000-0000-4000-8000-00000000a001', 10::smallint, '') $q$) = 'reason_required');
select test.check('M7 … with a reason (siblings) it is saved',
  test.err($q$ select api.set_discount('eeee0000-0000-4000-8000-00000000a001', 10::smallint, 'Aka-uka: ikkinchi farzand') $q$) = 'no error');
select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
select test.check('M8 the zavuch cannot see or change money',
  test.err($q$ select api.set_fee_rate(5::smallint, 1) $q$) = 'not_allowed'
  and test.err($q$ select api.finance_overview() $q$) = 'not_allowed'
  and test.val('select count(*) from fee_rates') = '0');

-- ---- invoices ----------------------------------------------------------------
select test.asuser('aaaa0000-0000-4000-8000-00000000a009');  -- accountant
select test.check('M9 this month''s invoices: one per student; 10% discount applied',
  test.val($q$ select api.generate_invoices()->>'created' $q$) = '2'
  and test.val($q$ select amount::int from fee_invoices where student_id = 'eeee0000-0000-4000-8000-00000000a001' $q$) = '1800000');
select test.check('M10 running it again creates nothing twice',
  test.val($q$ select api.generate_invoices()->>'created' $q$) = '0');
select set_config('test.inv', (select id::text from fee_invoices where student_id = 'eeee0000-0000-4000-8000-00000000a001'), false);
select set_config('test.inv2', (select id::text from fee_invoices where student_id = 'eeee0000-0000-4000-8000-00000000a002'), false);

-- ---- payments ----------------------------------------------------------------
select test.check('M11 cannot take more than is owed',
  test.err(format($q$ select api.record_payment(%L, 2000000, 'cash') $q$, current_setting('test.inv'))) = 'bad_amount');
select test.check('M12 a partial cash payment gives a receipt; the invoice stays open',
  test.val(format($q$ select (api.record_payment(%L, 1000000, 'cash')->>'remaining')::numeric::int $q$, current_setting('test.inv'))) = '800000'
  and test.val(format('select status from fee_invoices where id = %L', current_setting('test.inv'))) = 'issued');
select test.check('M13 paying the rest by bank closes it',
  test.val(format($q$ select (api.record_payment(%L, 800000, 'bank', 'Bank o''tkazmasi')->>'remaining')::numeric::int $q$, current_setting('test.inv'))) = '0'
  and test.val(format('select status from fee_invoices where id = %L', current_setting('test.inv'))) = 'paid');
select test.check('M14 a payment can never be edited',
  test.err($q$ update payments set amount = 1 where amount = 800000 $q$) = 'payment_is_final');
select test.check('M15 Click / Payme cannot be typed in by staff (only their webhooks)',
  not test.rows(format($q$ insert into payments (invoice_id, amount, provider, status, recorded_by)
      values (%L, 1000, 'click', 'completed', auth.uid()) $q$, current_setting('test.inv2'))));
select test.check('M16 a mistaken payment is cancelled with a reason → the invoice re-opens',
  test.err($q$ select api.cancel_payment((select id from payments where amount = 800000), 'x') $q$) = 'reason_required'
  and test.err($q$ select api.cancel_payment((select id from payments where amount = 800000), 'Noto''g''ri o''quvchiga yozilgan') $q$) = 'no error'
  and test.val(format('select status from fee_invoices where id = %L', current_setting('test.inv'))) = 'issued');
select test.check('M17 nobody can mark an invoice "paid" by hand',
  test.err(format($q$ update fee_invoices set status = 'paid' where id = %L $q$, current_setting('test.inv2'))) = 'status_follows_payments');
select test.check('M18 an invoice with payments cannot be cancelled; without payments it needs a reason',
  test.err(format($q$ select api.cancel_invoice(%L, 'O''quvchi ketdi') $q$, current_setting('test.inv'))) = 'invoice_has_payments'
  and test.err(format($q$ select api.cancel_invoice(%L, '') $q$, current_setting('test.inv2'))) = 'reason_required');

-- ---- who sees what -----------------------------------------------------------
select test.check('M19 the accountant sees NO grades, attendance or student records',
  test.val('select count(*) from grades') = '0' and test.val('select count(*) from attendance_logs') = '0'
  and test.val('select count(*) from students') = '0'
  and test.err($q$ select api.quarter_sheet('dddd0000-0000-4000-8000-00000000a001', 1::smallint) $q$) = 'not_allowed');
select test.check('M20 … but sees names + class on the money screen',
  test.val($q$ select jsonb_array_length(api.finance_students()) $q$) = '2');
select test.asuser('aaaa0000-0000-4000-8000-00000000a005');  -- parentA (Jasur's mother)
select test.check('M21 the parent sees only her child''s invoice and payments',
  test.val($q$ select jsonb_array_length(api.my_fees()) $q$) = '1'
  and test.val($q$ select (api.my_fees()->0->>'paid')::numeric::int $q$) = '1000000');
select test.check('M22 the parent cannot record a payment herself',
  not test.rows(format($q$ insert into payments (invoice_id, amount, provider, status, recorded_by)
      values (%L, 800000, 'cash', 'completed', auth.uid()) $q$, current_setting('test.inv'))));
select test.asuser('aaaa0000-0000-4000-8000-00000000a006');  -- studA1 (Jasur)
select test.check('M23 a child never sees money',
  test.val($q$ select jsonb_array_length(api.my_fees()) $q$) = '0' and test.val('select count(*) from fee_invoices') = '0');
select test.asuser('aaaa0000-0000-4000-8000-00000000a004');  -- teachA (class teacher of 5-A)
select test.check('M24 the class teacher never sees money',
  test.val('select count(*) from fee_invoices') = '0' and test.val('select count(*) from payments') = '0'
  and test.err($q$ select api.finance_students() $q$) = 'not_allowed');
select test.asuser('aaaa0000-0000-4000-8000-00000000b001');  -- adminB
select test.check('M25 another school sees nothing',
  test.val('select count(*) from fee_invoices') = '0' and test.val('select count(*) from app.finance_students(''bbbb0000-0000-4000-8000-00000000a001'')') = '0');
select test.asuser('aaaa0000-0000-4000-8000-00000000a002');  -- directorA
select test.check('M26 the director sees the money overview',
  test.val($q$ select (api.finance_overview()->'this_month'->>'invoices') $q$) = '2');

-- ---- debts + reminders -------------------------------------------------------
reset role;
update fee_invoices set due_date = current_date - 5;           -- both are now overdue
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a009');  -- accountant
select test.check('M27 overview: 2 families in debt, Jasur owes 800,000 (he paid part)',
  test.val($q$ select api.finance_overview()->>'families_in_debt' $q$) = '2'
  and test.val($q$ select (d->>'owed')::numeric::int from jsonb_array_elements(api.finance_overview()->'debtors') d where d->>'name' like 'Yusupov%' $q$) = '800000');
select test.check('M28 reminders go out (to parents only), once a week at most',
  test.val($q$ select api.send_fee_reminders()->>'invoices' $q$) = '2'
  and test.val($q$ select api.send_fee_reminders()->>'invoices' $q$) = '0');
reset role;
select test.check('M29 the reminder reached Jasur''s mother — not Jasur, not teachers',
  (select count(*) from notification_outbox where payload->>'event' = 'fee_reminder') = 1
  and (select recipient_id from notification_outbox where payload->>'event' = 'fee_reminder') = 'aaaa0000-0000-4000-8000-00000000a005');
select test.check('M30 every money change is in the audit log',
  (select count(*) from audit_log where table_name = 'payments') >= 3
  and (select count(*) from audit_log where table_name = 'fee_rates') = 1
  and (select count(*) from audit_log where table_name = 'fee_discounts') = 1);
set role authenticated;
select test.asuser('aaaa0000-0000-4000-8000-00000000a003');  -- zavuchA
select test.check('M31 a zavuch cannot trigger reminders',
  test.err($q$ select api.send_fee_reminders() $q$) = 'not_allowed'
  and test.err($q$ select app.send_fee_reminders('bbbb0000-0000-4000-8000-00000000a001') $q$) = 'not_allowed');

reset role;
do $$
declare p int := current_setting('test.passed')::int; f int := current_setting('test.failed')::int;
begin
  if f > 0 then raise exception 'FINANCE RESULT: % passed, % FAILED', p, f; end if;
  raise notice 'FINANCE RESULT: all % scenarios passed', p;
end $$;
