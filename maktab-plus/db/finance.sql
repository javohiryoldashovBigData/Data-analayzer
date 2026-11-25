-- ============================================================================
-- MAKTAB+ — step 7: school fees, payments, debts + the ACCOUNTANT role
-- Load after final_grades.sql (needs round4_roles_signals.sql).
--
-- Decisions (user, Nov 2026):
--   * money is seen by the director, the school admin and the ACCOUNTANT only —
--     never by the zavuch, teachers or students;
--   * the accountant sees money, never grades or attendance;
--   * children are NEVER blocked at the gate (or anywhere) over debt, and debt
--     is never shown to children or in any list other staff can see;
--   * reminders go to parents only, gently, at most once a week per invoice.
-- Online payments (Click / Payme) come later, through their webhooks with the
-- service role, once the school has a merchant contract. Here: cash and bank.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Types (each ALTER TYPE commits on its own in psql)
-- ---------------------------------------------------------------------------
alter type user_role    add value if not exists 'accountant';
alter type pay_provider add value if not exists 'bank';
alter type pay_status   add value if not exists 'cancelled';

-- The accountant ranks like the zavuch: only the school admin or director can
-- appoint one (zavuch cannot write roles at all; nobody can grant themselves).
-- Full previous body kept + accountant (see round4_roles_signals.sql).
create or replace function app.role_rank(p_role user_role)
returns int language sql immutable as $$
  select case p_role when 'director' then 3 when 'school_admin' then 2
                     when 'zavuch' then 1 when 'accountant' then 1 else 0 end
$$;

-- The accountant is a school-scoped role (same check as schema.sql + accountant).
alter table user_school_roles drop constraint if exists role_scope_chk;
alter table user_school_roles add constraint role_scope_chk check (
    ( role in ('school_admin','director','zavuch','teacher','student','parent','accountant')
      and school_id is not null and district_id is null and region_id is null )
    or ( role = 'district_admin' and district_id is not null and school_id is null and region_id is null )
    or ( role = 'region_admin' and region_id is not null and school_id is null and district_id is null )
    or ( role in ('super_admin','methodologist') and school_id is null and district_id is null and region_id is null ));

-- School admin / director may appoint an accountant (same policy as schema.sql
-- roles_write, with 'accountant' added to the list).
drop policy if exists roles_write on user_school_roles;
create policy roles_write on user_school_roles for all to authenticated using (
  app.is_super() or (school_id is not null and app.is_school_admin(school_id))
) with check (
  app.is_super()
  or ( school_id is not null and app.is_school_admin(school_id)
       and role in ('school_admin','director','zavuch','teacher','student','parent','accountant') )
);

-- Money access is sensitive: the director and school admin are told when an
-- accountant is appointed or removed (same body as round4, list extended).
create or replace function app.log_role_change(p_op text, p_old jsonb, p_new jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row jsonb := coalesce(p_new, p_old); v_school uuid := (v_row->>'school_id')::uuid;
begin
  insert into audit_log (user_id, school_id, table_name, row_id, action, old_value, new_value)
  values (auth.uid(), v_school, 'user_school_roles', v_row->>'id', p_op, p_old, p_new);
  if v_school is not null and (v_row->>'role') in ('director','school_admin','accountant') then
    insert into notification_outbox (recipient_id, payload)
    select distinct r.user_id, jsonb_build_object('kind','system','event','leader_role_changed',
             'school_id', v_school, 'role', v_row->>'role', 'op', p_op,
             'target_user', v_row->>'user_id', 'by', auth.uid())
    from user_school_roles r
    where r.school_id = v_school and r.is_active and r.role in ('director','school_admin');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Who sees money
-- ---------------------------------------------------------------------------
create or replace function app.sees_money(p_school_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_school_roles r
    join schools s on s.id = r.school_id and s.is_active
    where r.user_id = auth.uid() and r.is_active
      and r.role in ('school_admin','director','accountant')
      and r.school_id = p_school_id)
$$;

-- the caller's school where they see money (one window per school)
create or replace function app.my_money_school()
returns uuid language sql stable security definer set search_path = public as $$
  select r.school_id from user_school_roles r join schools s on s.id = r.school_id and s.is_active
  where r.user_id = auth.uid() and r.is_active and r.role in ('school_admin','director','accountant')
  limit 1
$$;

-- Names + class of the school's students, for the money screens ONLY.
-- DEFINER because the accountant may not read the students table (that would
-- open birth dates, PINFL, grades links). Returns nothing to anyone else.
create or replace function app.finance_students(p_school_id uuid)
returns table (student_id uuid, first_name text, last_name text, class_id uuid, class text, grade_level smallint)
language sql stable security definer set search_path = public as $$
  select s.id, s.first_name, s.last_name, c.id, c.grade_level || '-' || c.letter, c.grade_level
  from students s
  join class_members cm on cm.student_id = s.id and cm.status = 'active'
  join classes c on c.id = cm.class_id
  join academic_years y on y.id = c.academic_year_id and y.is_current
  where s.school_id = p_school_id and c.school_id = p_school_id and app.sees_money(p_school_id)
$$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
alter table schools add column if not exists fee_due_day smallint not null default 10 check (fee_due_day between 1 and 28);

create table if not exists fee_rates (
  school_id      uuid not null references schools(id) on delete cascade,
  grade_level    smallint not null check (grade_level between 1 and 11),
  monthly_amount numeric(12,2) not null check (monthly_amount >= 0),
  updated_by     uuid references auth.users(id),
  updated_at     timestamptz not null default now(),
  primary key (school_id, grade_level)
);
create table if not exists fee_discounts (
  student_id uuid primary key references students(id) on delete cascade,
  school_id  uuid not null references schools(id) on delete cascade,
  percent    smallint not null check (percent between 1 and 100),
  reason     text not null check (length(btrim(reason)) between 3 and 300),
  set_by     uuid references auth.users(id),
  set_at     timestamptz not null default now()
);
alter table fee_invoices add column if not exists base_amount      numeric(12,2);
alter table fee_invoices add column if not exists discount_percent smallint not null default 0;
alter table fee_invoices add column if not exists cancelled_reason text;
alter table fee_invoices add column if not exists last_reminder_at timestamptz;
alter table payments add column if not exists recorded_by      uuid references auth.users(id);
alter table payments add column if not exists note             text check (length(note) <= 300);
alter table payments add column if not exists cancelled_reason text check (length(cancelled_reason) <= 300);
alter table payments add column if not exists receipt_no       bigint generated always as identity;

-- ---------------------------------------------------------------------------
-- 3. Row-level security
-- ---------------------------------------------------------------------------
alter table fee_rates enable row level security;
alter table fee_discounts enable row level security;
drop policy if exists rates_rw on fee_rates;
create policy rates_rw on fee_rates for all to authenticated
  using (app.sees_money(school_id)) with check (app.sees_money(school_id) and updated_by = auth.uid());
drop policy if exists discounts_rw on fee_discounts;
create policy discounts_rw on fee_discounts for all to authenticated
  using (app.sees_money(school_id))
  with check (app.sees_money(school_id) and set_by = auth.uid()
              and school_id = app.student_school(student_id));
grant select, insert, update, delete on fee_rates, fee_discounts to authenticated;

-- invoices: money roles of the school, or the child's parent (never the child)
drop policy if exists invoices_select on fee_invoices;
create policy invoices_select on fee_invoices for select to authenticated using (
  app.sees_money(school_id)
  or exists (select 1 from guardians g where g.student_id = fee_invoices.student_id and g.parent_user_id = auth.uid()));
drop policy if exists invoices_insert on fee_invoices;
create policy invoices_insert on fee_invoices for insert to authenticated with check (
  app.sees_money(school_id) and status = 'issued'
  and school_id = app.student_school(student_id));
drop policy if exists invoices_update on fee_invoices;
create policy invoices_update on fee_invoices for update to authenticated
  using (app.sees_money(school_id))
  with check (app.sees_money(school_id) and school_id = app.student_school(student_id));
grant select, insert, update on fee_invoices to authenticated;

drop policy if exists payments_select on payments;
create policy payments_select on payments for select to authenticated using (
  app.sees_money((select fi.school_id from fee_invoices fi where fi.id = payments.invoice_id))
  or exists (select 1 from fee_invoices fi join guardians g on g.student_id = fi.student_id
             where fi.id = payments.invoice_id and g.parent_user_id = auth.uid()));
-- staff record cash / bank only; Click / Payme come from the providers' webhooks (service role)
drop policy if exists payments_insert on payments;
create policy payments_insert on payments for insert to authenticated with check (
  app.sees_money((select fi.school_id from fee_invoices fi where fi.id = payments.invoice_id))
  and provider in ('cash','bank') and status = 'completed' and recorded_by = auth.uid() and cancelled_reason is null);
drop policy if exists payments_update on payments;
create policy payments_update on payments for update to authenticated
  using (app.sees_money((select fi.school_id from fee_invoices fi where fi.id = payments.invoice_id)))
  with check (app.sees_money((select fi.school_id from fee_invoices fi where fi.id = payments.invoice_id)));
grant select, insert, update on payments to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Guards, invoice status, audit (DEFINER triggers)
-- ---------------------------------------------------------------------------
-- A payment is never edited: the only change allowed is completed → cancelled
-- with a reason. Money facts stay as they were (bookkeeping rule).
create or replace function app.guard_payment_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;            -- service role / webhooks
  if new.invoice_id <> old.invoice_id or new.amount <> old.amount or new.provider <> old.provider
     or new.provider_ref is distinct from old.provider_ref or new.paid_at is distinct from old.paid_at
     or new.recorded_by is distinct from old.recorded_by or new.note is distinct from old.note then
    raise exception 'payment_is_final' using errcode = '42501';
  end if;
  if not (old.status = 'completed' and new.status = 'cancelled' and length(btrim(coalesce(new.cancelled_reason, ''))) >= 3) then
    raise exception 'payment_is_final' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists payments_guard on payments;
create trigger payments_guard before update on payments for each row execute function app.guard_payment_update();

-- An invoice's amount is fixed once it has a payment; student/month never move.
create or replace function app.guard_invoice_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.student_id <> old.student_id or new.period_month <> old.period_month or new.school_id <> old.school_id then
    raise exception 'invoice_fixed' using errcode = '42501';
  end if;
  if new.amount <> old.amount and exists (select 1 from payments p where p.invoice_id = old.id and p.status = 'completed') then
    raise exception 'invoice_has_payments' using errcode = '22023';
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    if length(btrim(coalesce(new.cancelled_reason, ''))) < 3 then raise exception 'reason_required' using errcode = '22023'; end if;
    if exists (select 1 from payments p where p.invoice_id = old.id and p.status = 'completed') then
      raise exception 'invoice_has_payments' using errcode = '22023';
    end if;
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then raise exception 'invoice_fixed' using errcode = '42501'; end if;
  -- 'paid' / 'issued' only follow real payments (set by app.refresh_invoice_status,
  -- which runs one trigger level deeper); a person can only cancel.
  if new.status <> old.status and new.status <> 'cancelled' and pg_trigger_depth() = 1 then
    raise exception 'status_follows_payments' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists invoices_guard on fee_invoices;
create trigger invoices_guard before update on fee_invoices for each row execute function app.guard_invoice_update();

-- paid when completed payments cover the amount (partial payments allowed)
create or replace function app.refresh_invoice_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_inv uuid := coalesce(new.invoice_id, old.invoice_id); v_paid numeric;
begin
  select coalesce(sum(amount), 0) into v_paid from payments where invoice_id = v_inv and status = 'completed';
  update fee_invoices set status = case when v_paid >= amount then 'paid'::invoice_status else 'issued'::invoice_status end
   where id = v_inv and status <> 'cancelled'
     and status is distinct from case when v_paid >= amount then 'paid'::invoice_status else 'issued'::invoice_status end;
  return null;
end $$;
drop trigger if exists payments_status on payments;
create trigger payments_status after insert or update on payments for each row execute function app.refresh_invoice_status();

create or replace function app.audit_money()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_row jsonb := coalesce(to_jsonb(new), to_jsonb(old)); v_school uuid;
begin
  if tg_table_name = 'payments' then
    select school_id into v_school from fee_invoices where id = (v_row->>'invoice_id')::uuid;
  else
    v_school := (v_row->>'school_id')::uuid;
  end if;
  insert into audit_log (user_id, school_id, table_name, row_id, action, old_value, new_value)
  values (auth.uid(), v_school, tg_table_name,
          coalesce(to_jsonb(new), to_jsonb(old)) ->> case when tg_table_name in ('fee_rates') then 'grade_level'
                                                          when tg_table_name = 'fee_discounts' then 'student_id' else 'id' end,
          lower(tg_op), case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;
drop trigger if exists audit_payments on payments;
create trigger audit_payments after insert or update on payments for each row execute function app.audit_money();
drop trigger if exists audit_invoices on fee_invoices;
create trigger audit_invoices after insert or update on fee_invoices for each row execute function app.audit_money();
drop trigger if exists audit_rates on fee_rates;
create trigger audit_rates after insert or update or delete on fee_rates for each row execute function app.audit_money();
drop trigger if exists audit_discounts on fee_discounts;
create trigger audit_discounts after insert or update or delete on fee_discounts for each row execute function app.audit_money();

-- ---------------------------------------------------------------------------
-- 5. API (SECURITY INVOKER; RLS + app.sees_money decide)
-- ---------------------------------------------------------------------------
create or replace function app.money_school_or_fail()
returns uuid language plpgsql stable security invoker set search_path = public as $$
declare v uuid := app.my_money_school();
begin
  if v is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  return v;
end $$;

-- Fee settings: rates per grade + discounts
create or replace function api.fee_settings()
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_school uuid := app.money_school_or_fail();
begin
  return jsonb_build_object(
    'due_day', (select fee_due_day from schools where id = v_school),
    'grades', coalesce((select jsonb_agg(jsonb_build_object('grade_level', g.grade_level, 'students', g.n,
                 'monthly_amount', r.monthly_amount) order by g.grade_level)
               from (select grade_level, count(*) as n from app.finance_students(v_school) group by grade_level) g
               left join fee_rates r on r.school_id = v_school and r.grade_level = g.grade_level), '[]'::jsonb),
    'discounts', coalesce((select jsonb_agg(jsonb_build_object('student_id', d.student_id, 'name', fs.last_name || ' ' || fs.first_name,
                 'class', fs.class, 'percent', d.percent, 'reason', d.reason) order by fs.last_name)
               from fee_discounts d join app.finance_students(v_school) fs on fs.student_id = d.student_id
               where d.school_id = v_school), '[]'::jsonb));
end $$;

create or replace function api.set_fee_rate(p_grade smallint, p_amount numeric)
returns void language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_school uuid := app.money_school_or_fail();
begin
  if p_amount is null or p_amount < 0 or p_amount > 100000000 then raise exception 'bad_amount' using errcode = '22023'; end if;
  insert into fee_rates (school_id, grade_level, monthly_amount, updated_by) values (v_school, p_grade, p_amount, auth.uid())
  on conflict (school_id, grade_level) do update set monthly_amount = excluded.monthly_amount, updated_by = auth.uid(), updated_at = now();
end $$;

create or replace function api.set_discount(p_student uuid, p_percent smallint, p_reason text)
returns void language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_school uuid := app.money_school_or_fail();
begin
  if not exists (select 1 from app.finance_students(v_school) where student_id = p_student) then
    raise exception 'not_found' using errcode = '22023';
  end if;
  if coalesce(p_percent, 0) = 0 then delete from fee_discounts where student_id = p_student; return; end if;
  if p_percent not between 1 and 100 then raise exception 'bad_percent' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required' using errcode = '22023'; end if;
  insert into fee_discounts (student_id, school_id, percent, reason, set_by) values (p_student, v_school, p_percent, btrim(p_reason), auth.uid())
  on conflict (student_id) do update set percent = excluded.percent, reason = excluded.reason, set_by = auth.uid(), set_at = now();
end $$;

-- Create this month's invoices for every active student (safe to run twice).
create or replace function api.generate_invoices(p_month date default current_date)
returns jsonb language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_school uuid := app.money_school_or_fail(); v_month date := date_trunc('month', p_month)::date;
        v_due date; v_new int; v_norate int;
begin
  if v_month > date_trunc('month', current_date + 31)::date then raise exception 'too_far_ahead' using errcode = '22023'; end if;
  v_due := v_month + ((select fee_due_day from schools where id = v_school) - 1);
  with ins as (
    insert into fee_invoices (school_id, student_id, period_month, amount, base_amount, discount_percent, due_date)
    select v_school, fs.student_id, v_month,
           round(r.monthly_amount * (100 - coalesce(d.percent, 0)) / 100.0, -3),   -- to 1,000 so'm
           r.monthly_amount, coalesce(d.percent, 0), v_due
    from app.finance_students(v_school) fs
    join fee_rates r on r.school_id = v_school and r.grade_level = fs.grade_level
    left join fee_discounts d on d.student_id = fs.student_id
    on conflict (school_id, student_id, period_month) do nothing
    returning 1)
  select count(*) into v_new from ins;
  select count(*) into v_norate from app.finance_students(v_school) fs
   where not exists (select 1 from fee_rates r where r.school_id = v_school and r.grade_level = fs.grade_level);
  return jsonb_build_object('created', v_new, 'month', v_month, 'due_date', v_due, 'no_rate', v_norate);
end $$;

-- Record a cash / bank payment (partial allowed, never more than what is owed)
create or replace function api.record_payment(p_invoice uuid, p_amount numeric, p_method text, p_note text default null)
returns jsonb language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_inv fee_invoices%rowtype; v_paid numeric; v_id uuid; v_no bigint;
begin
  select * into v_inv from fee_invoices where id = p_invoice for update;
  if v_inv.id is null or not app.sees_money(v_inv.school_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if v_inv.status = 'cancelled' then raise exception 'invoice_cancelled' using errcode = '22023'; end if;
  if p_method not in ('cash','bank') then raise exception 'bad_method' using errcode = '22023'; end if;
  select coalesce(sum(amount), 0) into v_paid from payments where invoice_id = p_invoice and status = 'completed';
  if p_amount is null or p_amount <= 0 or p_amount > v_inv.amount - v_paid then raise exception 'bad_amount' using errcode = '22023'; end if;
  insert into payments (invoice_id, amount, provider, status, paid_at, recorded_by, note)
  values (p_invoice, p_amount, p_method::pay_provider, 'completed', now(), auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id, receipt_no into v_id, v_no;
  return jsonb_build_object('payment_id', v_id, 'receipt_no', v_no, 'remaining', v_inv.amount - v_paid - p_amount);
end $$;

create or replace function api.cancel_payment(p_payment uuid, p_reason text)
returns void language plpgsql volatile security invoker set search_path = public, pg_temp as $$
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required' using errcode = '22023'; end if;
  update payments set status = 'cancelled', cancelled_reason = btrim(p_reason) where id = p_payment and status = 'completed';
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
end $$;

create or replace function api.cancel_invoice(p_invoice uuid, p_reason text)
returns void language plpgsql volatile security invoker set search_path = public, pg_temp as $$
begin
  update fee_invoices set status = 'cancelled', cancelled_reason = btrim(coalesce(p_reason, '')) where id = p_invoice and status <> 'cancelled';
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
end $$;

-- one row per invoice, with what is paid and what is left
create or replace function app.invoice_rows(p_school uuid)
returns table (id uuid, student_id uuid, period_month date, amount numeric, due_date date, status invoice_status,
               paid numeric, remaining numeric, overdue boolean, last_reminder_at timestamptz, discount_percent smallint)
language sql stable security invoker set search_path = public as $$
  select fi.id, fi.student_id, fi.period_month, fi.amount, fi.due_date, fi.status,
         coalesce(p.paid, 0), greatest(fi.amount - coalesce(p.paid, 0), 0),
         fi.status = 'issued' and fi.due_date < current_date, fi.last_reminder_at, fi.discount_percent
  from fee_invoices fi
  left join lateral (select sum(amount) as paid from payments where invoice_id = fi.id and status = 'completed') p on true
  where fi.school_id = p_school and fi.status <> 'cancelled'
$$;

-- The accountant's / director's main screen.
create or replace function api.finance_overview(p_month date default current_date)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_school uuid := app.money_school_or_fail(); v_month date := date_trunc('month', p_month)::date;
begin
  return jsonb_build_object(
    'month', v_month,
    'this_month', (select jsonb_build_object('invoices', count(*), 'billed', coalesce(sum(amount), 0), 'paid', coalesce(sum(paid), 0),
                     'remaining', coalesce(sum(remaining), 0), 'paid_count', count(*) filter (where status = 'paid'))
                   from app.invoice_rows(v_school) where period_month = v_month),
    'total_debt', (select coalesce(sum(remaining), 0) from app.invoice_rows(v_school) where overdue),
    'families_in_debt', (select count(distinct student_id) from app.invoice_rows(v_school) where overdue),
    'by_class', coalesce((select jsonb_agg(x order by x->>'class') from (
        select jsonb_build_object('class', fs.class, 'billed', sum(ir.amount), 'paid', sum(ir.paid)) as x
        from app.invoice_rows(v_school) ir join app.finance_students(v_school) fs on fs.student_id = ir.student_id
        where ir.period_month = v_month group by fs.class) y), '[]'::jsonb),
    'debtors', coalesce((select jsonb_agg(x order by (x->>'owed')::numeric desc) from (
        select jsonb_build_object('student_id', fs.student_id, 'name', fs.last_name || ' ' || fs.first_name, 'class', fs.class,
                 'months', count(*), 'owed', sum(ir.remaining), 'oldest_due', min(ir.due_date),
                 'last_reminder_at', max(ir.last_reminder_at)) as x
        from app.invoice_rows(v_school) ir join app.finance_students(v_school) fs on fs.student_id = ir.student_id
        where ir.overdue group by fs.student_id, fs.last_name, fs.first_name, fs.class) y), '[]'::jsonb),
    'recent_payments', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
        select jsonb_build_object('id', p.id, 'receipt_no', p.receipt_no, 'amount', p.amount, 'provider', p.provider,
                 'status', p.status, 'created_at', p.created_at, 'name', fs.last_name || ' ' || fs.first_name,
                 'class', fs.class, 'period_month', fi.period_month) as x
        from payments p join fee_invoices fi on fi.id = p.invoice_id
        join app.finance_students(v_school) fs on fs.student_id = fi.student_id
        where fi.school_id = v_school order by p.created_at desc limit 10) y), '[]'::jsonb));
end $$;

-- One student's account (money roles), for the "take a payment" screen.
create or replace function api.student_account(p_student uuid)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_school uuid := app.money_school_or_fail(); v_st record;
begin
  select * into v_st from app.finance_students(v_school) where student_id = p_student;
  if v_st.student_id is null then raise exception 'not_found' using errcode = '22023'; end if;
  return jsonb_build_object('student_id', p_student, 'name', v_st.last_name || ' ' || v_st.first_name, 'class', v_st.class,
    'discount', (select jsonb_build_object('percent', percent, 'reason', reason) from fee_discounts where student_id = p_student),
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', ir.id, 'period_month', ir.period_month, 'amount', ir.amount,
                 'paid', ir.paid, 'remaining', ir.remaining, 'due_date', ir.due_date, 'status', ir.status, 'overdue', ir.overdue,
                 'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'receipt_no', p.receipt_no, 'amount', p.amount,
                                'provider', p.provider, 'status', p.status, 'created_at', p.created_at, 'cancelled_reason', p.cancelled_reason)
                                order by p.created_at), '[]'::jsonb) from payments p where p.invoice_id = ir.id))
               order by ir.period_month desc) from app.invoice_rows(v_school) ir where ir.student_id = p_student), '[]'::jsonb));
end $$;

-- Students list for search (money roles): name, class, what is owed now.
create or replace function api.finance_students()
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_school uuid := app.money_school_or_fail();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('student_id', fs.student_id, 'name', fs.last_name || ' ' || fs.first_name,
            'class', fs.class, 'remaining', coalesce((select sum(remaining) from app.invoice_rows(v_school) ir where ir.student_id = fs.student_id), 0))
          order by fs.class, fs.last_name) from app.finance_students(v_school) fs), '[]'::jsonb);
end $$;

-- Gentle reminders to PARENTS of overdue invoices, at most once a week each.
-- DEFINER (outbox is closed to users) with an explicit money-role check.
create or replace function app.send_fee_reminders(p_school uuid)
returns int language plpgsql volatile security definer set search_path = public as $$
declare v_n int;
begin
  if not app.sees_money(p_school) then raise exception 'not_allowed' using errcode = '42501'; end if;
  with due as (
    update fee_invoices fi set last_reminder_at = now()
    where fi.school_id = p_school and fi.status = 'issued' and fi.due_date < current_date
      and (fi.last_reminder_at is null or fi.last_reminder_at < now() - interval '7 days')
    returning fi.id, fi.student_id, fi.period_month, fi.amount),
  sent as (
    insert into notification_outbox (recipient_id, payload)
    select g.parent_user_id, jsonb_build_object('kind', 'fee_due', 'event', 'fee_reminder', 'invoice_id', d.id,
             'student_id', d.student_id, 'period_month', d.period_month)
    from due d join guardians g on g.student_id = d.student_id
    returning 1)
  select count(*) into v_n from due;
  return v_n;
end $$;
create or replace function api.send_fee_reminders()
returns jsonb language plpgsql volatile security invoker set search_path = public, pg_temp as $$
begin
  return jsonb_build_object('invoices', app.send_fee_reminders(app.money_school_or_fail()));
end $$;

-- Parent: own children's invoices + payments (students never see money).
create or replace function api.my_fees()
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', fi.id, 'student_id', fi.student_id, 'period_month', fi.period_month,
           'amount', fi.amount, 'base_amount', fi.base_amount, 'discount_percent', fi.discount_percent,
           'due_date', fi.due_date, 'status', fi.status,
           'paid', coalesce((select sum(p.amount) from payments p where p.invoice_id = fi.id and p.status = 'completed'), 0),
           'payments', (select coalesce(jsonb_agg(jsonb_build_object('receipt_no', p.receipt_no, 'amount', p.amount,
                           'provider', p.provider, 'created_at', p.created_at) order by p.created_at), '[]'::jsonb)
                        from payments p where p.invoice_id = fi.id and p.status = 'completed'))
         order by fi.period_month desc), '[]'::jsonb)
  from fee_invoices fi
  where fi.status <> 'cancelled'
    and exists (select 1 from guardians g where g.student_id = fi.student_id and g.parent_user_id = auth.uid())
$$;

revoke execute on function app.send_fee_reminders(uuid) from public;
grant execute on function app.send_fee_reminders(uuid), app.sees_money(uuid), app.my_money_school(),
  app.finance_students(uuid), app.money_school_or_fail(), app.invoice_rows(uuid) to authenticated;
revoke execute on function api.fee_settings(), api.set_fee_rate(smallint, numeric), api.set_discount(uuid, smallint, text),
  api.generate_invoices(date), api.record_payment(uuid, numeric, text, text), api.cancel_payment(uuid, text),
  api.cancel_invoice(uuid, text), api.finance_overview(date), api.student_account(uuid), api.finance_students(),
  api.send_fee_reminders(), api.my_fees() from public;
grant execute on function api.fee_settings(), api.set_fee_rate(smallint, numeric), api.set_discount(uuid, smallint, text),
  api.generate_invoices(date), api.record_payment(uuid, numeric, text, text), api.cancel_payment(uuid, text),
  api.cancel_invoice(uuid, text), api.finance_overview(date), api.student_account(uuid), api.finance_students(),
  api.send_fee_reminders(), api.my_fees() to authenticated;
