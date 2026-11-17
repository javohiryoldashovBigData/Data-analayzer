-- ============================================================================
-- MAKTAB+ round 4 — (1) role-grant guard  (2) A2b soft signal
-- Run AFTER v3 schema + api_phase1.sql.  Parse-checked only (pglast), NOT run.
-- Lines marked V3-ADAPT may need a rename against Claude's v3.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (1) ROLE GRANTS — answer to §6.1: YES, block it. Rules (on top of v3 policies):
--   R1  nobody grants, edits or re-activates a role row for THEMSELVES
--       (they may only switch their own row off = resign)
--   R2  nobody grants a role at or above their own rank in that school
--       rank: director 3 > school_admin 2 > zavuch 1 > teacher/student/parent 0
--   R3  'director' is granted only by the platform (onboarding, service role /
--       super admin) — never from inside the school. A school can't make a
--       second director to outvote the first.
--   R4  nobody inside the school deletes or switches off a director row
--   R5  granted_by is always the real caller (no spoofing, like A13)
--   R6  every school_admin/director change is audited AND announced to every
--       school leader (own code, no AI) — a "second pair of eyes"
-- Trusted callers (seed scripts, migrations, service role) have auth.uid() null
-- and their role setting is not 'authenticated'/'anon'; they skip R1–R4.
-- ---------------------------------------------------------------------------

create or replace function app.role_rank(p_role user_role)
returns int language sql immutable as $$
  select case p_role when 'director' then 3 when 'school_admin' then 2
                     when 'zavuch' then 1 else 0 end
$$;

-- caller's highest rank at a school (definer: reads user_school_roles safely)
create or replace function app.my_rank_at(p_school_id uuid)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(max(app.role_rank(r.role)), -1) from user_school_roles r
  where r.user_id = auth.uid() and r.is_active and r.school_id = p_school_id
$$;

create or replace function app.log_role_change(p_op text, p_old jsonb, p_new jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row jsonb := coalesce(p_new, p_old); v_school uuid := (v_row->>'school_id')::uuid;
begin
  insert into audit_log (user_id, school_id, table_name, row_id, action, old_value, new_value)
  values (auth.uid(), v_school, 'user_school_roles', v_row->>'id', p_op, p_old, p_new);
  if v_school is not null and (v_row->>'role') in ('director','school_admin') then
    insert into notification_outbox (recipient_id, payload)
    select distinct r.user_id, jsonb_build_object('kind','system','event','leader_role_changed',
             'school_id', v_school, 'role', v_row->>'role', 'op', p_op,
             'target_user', v_row->>'user_id', 'by', auth.uid())
    from user_school_roles r
    where r.school_id = v_school and r.is_active and r.role in ('director','school_admin');
  end if;
end $$;

-- SECURITY DEFINER (so it can write audit_log / outbox without granting those
-- helpers to users). The caller's role is read from the 'role' setting, which
-- PostgREST sets with SET LOCAL ROLE (authenticated / anon / service_role).
create or replace function app.guard_role_grant()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_trusted boolean := auth.uid() is null
                       and coalesce(nullif(current_setting('role', true), ''), 'none')
                           not in ('authenticated','anon');
  v_school  uuid;
begin
  if v_trusted then
    if tg_op <> 'DELETE' then
      perform app.log_role_change(lower(tg_op), case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
      return new;
    end if;
    perform app.log_role_change('delete', to_jsonb(old), null);
    return old;
  end if;
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    if old.role = 'director' then                                    -- R4
      raise exception 'director_change_platform_only' using errcode = '42501';
    end if;
    if app.role_rank(old.role) >= app.my_rank_at(old.school_id) and not app.is_super() then  -- R2
      raise exception 'rank_too_low' using errcode = '42501';
    end if;
    perform app.log_role_change('delete', to_jsonb(old), null);
    return old;
  end if;

  v_school := new.school_id;
  -- R1: own rows. Only allowed change: switch your own row OFF.
  if new.user_id = auth.uid() then
    if tg_op = 'UPDATE' and old.user_id = auth.uid() and old.is_active and not new.is_active
       and (to_jsonb(new) - 'is_active') = (to_jsonb(old) - 'is_active') then
      perform app.log_role_change('resign', to_jsonb(old), to_jsonb(new));
      return new;
    end if;
    raise exception 'no_self_grant' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.user_id = auth.uid() then
    raise exception 'no_self_grant' using errcode = '42501';            -- moving own row to someone
  end if;

  -- R3 / R4
  if new.role = 'director' and not app.is_super() then
    raise exception 'director_change_platform_only' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.role = 'director' and not app.is_super() then
    raise exception 'director_change_platform_only' using errcode = '42501';
  end if;

  -- R2: school-scoped roles only (district/region rows are handled by v3 policies)
  if v_school is not null and not app.is_super() then
    if app.role_rank(new.role) >= app.my_rank_at(v_school)
       or (tg_op = 'UPDATE' and app.role_rank(old.role) >= app.my_rank_at(old.school_id)) then
      raise exception 'rank_too_low' using errcode = '42501';
    end if;
  end if;

  new.granted_by := auth.uid();                                        -- R5
  if tg_op = 'INSERT' then new.granted_at := now(); end if;
  perform app.log_role_change(lower(tg_op), case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;

drop trigger if exists roles_guard on user_school_roles;
create trigger roles_guard before insert or update or delete on user_school_roles
  for each row execute function app.guard_role_grant();

-- Effect with v3 policies (v3: only school_admin/director may write roles):
--   director     → may grant school_admin, zavuch, teacher, student, parent (never director, never self)
--   school_admin → may grant zavuch, teacher, student, parent (never school_admin/director, never self)
--   zavuch       → nothing (v3 policy)
-- OPEN (team decision): should a director need a SECOND leader to approve a
-- new school_admin? R6 makes every such change visible to all leaders at once;
-- a real two-person approval queue can come after the pilot.

-- ---------------------------------------------------------------------------
-- (2) A2b — no objection to "not enforced". Proposal: a SOFT SIGNAL, not a block.
-- Marks entered by someone who had no timetable slot and no substitution for
-- that class+period show up in the zavuch's morning list. People decide (rule 1).
-- ---------------------------------------------------------------------------
create or replace function api.off_timetable_marks(p_date date default current_date - 1)
returns table (class_id uuid, period smallint, subject_id smallint,
               marked_by uuid, marks bigint, first_marked_at timestamptz)
language sql stable security invoker set search_path = public, pg_temp as $$
  select a.class_id, a.period, a.subject_id, a.marked_by, count(*), min(a.marked_at)
  from attendance_logs a
  join classes c on c.id = a.class_id
  where a.date = p_date
    and app.manages_school(c.school_id)
    and not exists (                                   -- regular slot of the marker
      select 1 from timetable_slots ts join teachers t on t.id = ts.teacher_id
      where ts.class_id = a.class_id and ts.period = a.period
        and ts.day_of_week = extract(isodow from p_date)::int
        and ts.effective_from <= p_date and (ts.effective_to is null or ts.effective_to >= p_date)
        and t.user_id = a.marked_by)
    and not exists (                                   -- or a substitution
      select 1 from substitutions s join teachers t on t.id = s.substitute_teacher_id
      where s.class_id = a.class_id and s.date = p_date and s.period = a.period
        and t.user_id = a.marked_by)
    and not exists (                                   -- class teacher / leaders may fix marks
      select 1 from user_school_roles r
      where r.user_id = a.marked_by and r.is_active and r.school_id = c.school_id
        and r.role in ('director','school_admin','zavuch'))
    and not exists (
      select 1 from teachers t where t.id = c.class_teacher_id and t.user_id = a.marked_by)
  group by a.class_id, a.period, a.subject_id, a.marked_by
  order by a.class_id, a.period
$$;
-- Note: the zavuch sees "who" (staff), never which child — children are not in the output.
-- Partition pruning: a.date = p_date hits one attendance_logs partition.

revoke execute on function api.off_timetable_marks(date) from public;
grant  execute on function api.off_timetable_marks(date) to authenticated;
revoke execute on function app.log_role_change(text, jsonb, jsonb) from public;
revoke execute on function app.guard_role_grant() from public;
grant  execute on function app.role_rank(user_role), app.my_rank_at(uuid) to authenticated;
