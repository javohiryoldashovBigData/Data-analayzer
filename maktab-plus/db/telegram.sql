-- ============================================================================
-- MAKTAB+ — step 8a: Telegram bot = the first real delivery channel for the
-- notification outbox. Load after finance.sql (needs quiet_hours.sql).
--
-- Two safe ways to connect a Telegram account to a Maktab+ person:
--  1. From the web app (logged in): a ONE-TIME link t.me/<bot>?start=<token>,
--     valid 15 minutes, stored only as a hash.
--  2. In the bot: "share my phone" — Telegram's contact button. The worker
--     accepts it only when the contact belongs to the sender himself, and links
--     only when exactly ONE person in Maktab+ has that phone.
-- Only the night/background worker (service role) links chats and sends.
-- Private chats only: nothing about a child ever goes to a group.
-- ============================================================================

create table if not exists telegram_links (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  chat_id     bigint not null unique,
  tg_user_id  bigint not null,
  lang        text not null default 'uz' check (lang in ('uz','ru','en')),
  linked_via  text not null check (linked_via in ('web_token','contact')),
  linked_at   timestamptz not null default now(),
  active      boolean not null default true
);
alter table telegram_links enable row level security;
drop policy if exists tg_self_read on telegram_links;
create policy tg_self_read on telegram_links for select to authenticated using (user_id = auth.uid());
drop policy if exists tg_self_delete on telegram_links;
create policy tg_self_delete on telegram_links for delete to authenticated using (user_id = auth.uid());
grant select, delete on telegram_links to authenticated;

-- one-time tokens: service-only table (RLS on, no policies → users can't read)
create table if not exists telegram_link_tokens (
  token_hash text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz
);
alter table telegram_link_tokens enable row level security;

create table if not exists telegram_state (key text primary key, value text not null);
alter table telegram_state enable row level security;

-- school setting: may the message show the grade value / child name, or only
-- "something new — open the app"? (default: details on; a school may turn off)
alter table schools add column if not exists telegram_details boolean not null default true;

-- outbox statuses used by the worker: pending → sending → sent | no_channel | failed

-- ---------------------------------------------------------------------------
-- Logged-in user
-- ---------------------------------------------------------------------------
-- Make a one-time connect token (DEFINER: the token table is closed to users).
create or replace function api.telegram_link_token()
returns text language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  -- at most 5 open tokens per person per hour (no token flooding)
  if (select count(*) from telegram_link_tokens where user_id = auth.uid() and expires_at > now() - interval '45 minutes') >= 5 then
    raise exception 'too_many_attempts' using errcode = '22023';
  end if;
  delete from telegram_link_tokens where expires_at < now() - interval '1 day';
  insert into telegram_link_tokens (token_hash, user_id, expires_at)
  values (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid(), now() + interval '15 minutes');
  return v_token;
end $$;

create or replace function api.telegram_status()
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce((select jsonb_build_object('linked', active, 'linked_at', linked_at, 'lang', lang, 'via', linked_via)
                   from telegram_links where user_id = auth.uid()), jsonb_build_object('linked', false))
$$;

create or replace function api.telegram_unlink()
returns void language sql volatile security invoker set search_path = public, pg_temp as $$
  delete from telegram_links where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Service role only (the Telegram worker)
-- ---------------------------------------------------------------------------
create or replace function app.tg_attach(p_user uuid, p_chat bigint, p_tg_user bigint, p_lang text, p_via text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  -- one Telegram chat = one Maktab+ person; the newest link wins
  delete from telegram_links where chat_id = p_chat and user_id <> p_user;
  insert into telegram_links (user_id, chat_id, tg_user_id, lang, linked_via)
  values (p_user, p_chat, p_tg_user, case when p_lang in ('uz','ru','en') then p_lang else 'uz' end, p_via)
  on conflict (user_id) do update set chat_id = excluded.chat_id, tg_user_id = excluded.tg_user_id,
    lang = excluded.lang, linked_via = excluded.linked_via, linked_at = now(), active = true;
end $$;

-- /start <token>  → first name of the person, or null (unknown / used / expired)
create or replace function app.tg_link_by_token(p_token text, p_chat bigint, p_tg_user bigint, p_lang text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid;
begin
  update telegram_link_tokens set used_at = now()
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
     and used_at is null and expires_at > now()
  returning user_id into v_user;
  if v_user is null then return null; end if;
  perform app.tg_attach(v_user, p_chat, p_tg_user, p_lang, 'web_token');
  return (select first_name from profiles where user_id = v_user);
end $$;

-- shared contact (the worker has already checked contact.user_id = sender)
create or replace function app.tg_link_by_phone(p_phone text, p_chat bigint, p_tg_user bigint, p_lang text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_digits text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9); v_users uuid[];
begin
  if length(v_digits) < 9 then return null; end if;
  select array_agg(user_id) into v_users from profiles
   where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = v_digits;
  if coalesce(array_length(v_users, 1), 0) <> 1 then return null; end if;   -- unknown or ambiguous: never guess
  perform app.tg_attach(v_users[1], p_chat, p_tg_user, p_lang, 'contact');
  return (select first_name from profiles where user_id = v_users[1]);
end $$;

-- /stop, or the user blocked the bot
create or replace function app.tg_unlink_chat(p_chat bigint)
returns void language sql volatile security definer set search_path = public as $$
  delete from telegram_links where chat_id = p_chat
$$;

-- Everything the worker needs to write one message: channel + facts.
-- Names come from OUR database, only for this recipient's own child.
create or replace function app.tg_message_facts(p_outbox_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'chat_id', l.chat_id, 'lang', l.lang,
    'school', sc.name, 'details', coalesce(sc.telegram_details, true),
    'child', st.first_name,
    'subject', coalesce(o.payload->>'subject', (select name_uz from subjects where id = (o.payload->>'subject_id')::smallint)),
    'kind', o.payload->>'kind', 'event', o.payload->>'event', 'payload', o.payload)
  from notification_outbox o
  left join telegram_links l on l.user_id = o.recipient_id and l.active
  left join schools sc on sc.id = o.school_id
  left join students st on st.id = (o.payload->>'student_id')::uuid
  where o.id = p_outbox_id
$$;

revoke execute on function app.tg_attach(uuid, bigint, bigint, text, text), app.tg_link_by_token(text, bigint, bigint, text),
  app.tg_link_by_phone(text, bigint, bigint, text), app.tg_unlink_chat(bigint), app.tg_message_facts(bigint) from public, authenticated;
revoke execute on function api.telegram_link_token(), api.telegram_status(), api.telegram_unlink() from public;
grant execute on function api.telegram_link_token(), api.telegram_status(), api.telegram_unlink() to authenticated;
