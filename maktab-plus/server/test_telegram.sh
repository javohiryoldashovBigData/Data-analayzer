#!/usr/bin/env bash
# MAKTAB+ — Telegram end-to-end test with the FAKE Bot API (no token, no real messages).
# Needs: fresh demo DB (with telegram.sql), API server on :8787 started with
# TELEGRAM_BOT_USERNAME=MaktabDemoBot, fake Telegram on :8798.
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres DEMO_DB=maktab_demo ./server/test_telegram.sh
set -u
cd "$(dirname "$0")/.."
API=${API:-http://localhost:8787}; TG=${TG:-http://localhost:8798}; DB=${DEMO_DB:-maktab_demo}; P=0; F=0
ok() { if [ "$2" = "$3" ]; then P=$((P+1)); echo "PASS  $1"; else F=$((F+1)); echo "FAIL  $1 (got: $2, want: $3)"; fi; }
J() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }
tok() { curl -s -X POST $API/api/login -d "{\"slug\":\"demo\",\"login\":\"$1\",\"password\":\"maktab2026\"}" | J "d['token']"; }
sql() { psql -X -At -d "$DB" -c "$1"; }
worker() { DATABASE_SERVICE_URL="postgres://${PGUSER}@${PGHOST}:${PGPORT}/$DB" TELEGRAM_BOT_TOKEN=test-not-real TELEGRAM_API_BASE=$TG node server/telegram-worker.mjs once; }
say() { curl -s -X POST $TG/test/update -d "$1" >/dev/null; }      # an incoming Telegram message
last_to() { curl -s $TG/test/sent | J "([m['text'] for m in d if str(m['chat_id'])=='$1'] or [''])[-1]"; }
curl -s -X POST $TG/test/reset >/dev/null
worker >/dev/null                                                   # old seed rows: nobody linked yet → no_channel
PH="authorization: Bearer $(tok 900000121)"                         # Dilshod (parent of Sardor 8-A, Temur 5-A)

ok "TG1 the parent sees: not connected, bot name shown"  "$(curl -s $API/api/telegram/status -H "$PH" | J "str(d['linked'])+'|'+d['bot']")" "False|MaktabDemoBot"
URL=$(curl -s -X POST $API/api/telegram/link -H "$PH" | J "d['url']")
TOKEN=${URL##*start=}
ok "TG2 the app makes a one-time link t.me/<bot>?start=<token>" "$(echo "$URL" | grep -cE '^https://t.me/MaktabDemoBot\?start=[a-f0-9]{64}$')" 1
ok "TG3 the token is stored only as a hash"              "$(sql "select count(*) from telegram_link_tokens where token_hash = '$TOKEN'")|$(sql "select count(*) from telegram_link_tokens")" "0|1"
say "{\"chat\":{\"id\":5001,\"type\":\"private\"},\"from\":{\"id\":5001,\"language_code\":\"uz\"},\"text\":\"/start $TOKEN\"}"
worker >/dev/null
ok "TG4 /start <token> connects the parent, the bot greets him" "$(last_to 5001 | grep -c 'Rahmat, Dilshod')|$(curl -s $API/api/telegram/status -H "$PH" | J "str(d['linked'])+'|'+d['via']")" "1|True|web_token"
say "{\"chat\":{\"id\":5002,\"type\":\"private\"},\"from\":{\"id\":5002},\"text\":\"/start $TOKEN\"}"
worker >/dev/null
ok "TG5 the same link a second time (someone else) does nothing" "$(curl -s $TG/test/sent | J "sum('eskirgan' in m['text'] for m in d if m['chat_id']==5002)")|$(sql "select count(*) from telegram_links where chat_id = 5002")" "1|0"
say '{"chat":{"id":5003,"type":"private"},"from":{"id":5003,"language_code":"ru"},"contact":{"phone_number":"998900000111","user_id":5003}}'
worker >/dev/null
ok "TG6 sharing your OWN phone connects you (teacher Aziza, Russian)" "$(last_to 5003 | grep -c 'Спасибо, Aziza')|$(sql "select lang from telegram_links where chat_id = 5003")" "1|ru"
say '{"chat":{"id":5004,"type":"private"},"from":{"id":5004},"contact":{"phone_number":"998900000101","user_id":7777}}'
worker >/dev/null
ok "TG7 someone else's contact is refused (the director's phone)" "$(last_to 5004 | grep -c "o'zingizning")|$(sql "select count(*) from telegram_links where chat_id = 5004")" "1|0"
say '{"chat":{"id":5005,"type":"private"},"from":{"id":5005},"contact":{"phone_number":"+998 99 123 45 67","user_id":5005}}'
worker >/dev/null
ok "TG8 an unknown phone is not linked to anyone"        "$(last_to 5005 | grep -c 'topilmadi')|$(sql "select count(*) from telegram_links where chat_id = 5005")" "1|0"
say '{"chat":{"id":-100777,"type":"group"},"from":{"id":5001},"text":"/start"}'
worker >/dev/null
ok "TG9 the bot never answers in groups"                 "$(curl -s $TG/test/sent | J "sum(m['chat_id']==-100777 for m in d)")" 0

# ---- delivery ----
sql "insert into gate_events (school_id, student_id, direction) values ('d5000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000801', 'in')" >/dev/null
worker >/dev/null
ok "TG10 gate alert reaches the father at once"          "$(last_to 5001 | grep -c 'Sardor maktabga keldi')" 1
NC=$(sql "select count(*) from notification_outbox where status = 'no_channel'")
ok "TG11 people without Telegram are marked no_channel (not lost silently)" "$([ "$NC" -gt 0 ] && echo yes)" yes
sql "update schools set telegram_details = false" >/dev/null
sql "insert into notification_outbox (recipient_id, payload) values ('d1000000-0000-4000-8000-000000000021', '{\"kind\":\"gate_out\",\"student_id\":\"d4000000-0000-4000-8000-000000000801\",\"scanned_at\":\"2026-11-26T09:00:00Z\"}')" >/dev/null
worker >/dev/null
ok "TG12 school 'no details' setting: no child name in the message" "$(last_to 5001 | grep -c 'Sardor')|$(last_to 5001 | grep -c 'Farzandingiz maktabdan chiqdi')" "0|1"
sql "update schools set telegram_details = true" >/dev/null
sql "update telegram_links set chat_id = 429 where chat_id = 5003" >/dev/null
sql "insert into notification_outbox (recipient_id, payload) values ('d1000000-0000-4000-8000-000000000011', '{\"kind\":\"system\",\"event\":\"topic_review_ready\",\"topic\":\"Kasrlar\"}')" >/dev/null
sql "update notification_outbox set deliver_after = null where status = 'pending'" >/dev/null   # ignore quiet hours for this check
worker >/dev/null
ok "TG13 Telegram says 'too many' → retried later, not lost" "$(sql "select status || '|' || held_reason from notification_outbox where payload->>'topic' = 'Kasrlar'")" "pending|retry"
sql "update telegram_links set chat_id = 403 where chat_id = 429" >/dev/null
sql "update notification_outbox set deliver_after = now() - interval '1 second' where payload->>'topic' = 'Kasrlar'" >/dev/null
worker >/dev/null
ok "TG14 the user blocked the bot → link removed, message marked no_channel" "$(sql "select count(*) from telegram_links where chat_id = 403")|$(sql "select status from notification_outbox where payload->>'topic' = 'Kasrlar'")" "0|no_channel"

# ---- privacy ----
ok "TG15 a person sees only their own Telegram link"     "$(psql -X -At -d "$DB" -c "set role authenticated; select set_config('app.current_user_id','d1000000-0000-4000-8000-000000000001',false); select count(*) from telegram_links;" | tail -1)" 0
ok "TG16 nobody can read the one-time tokens"            "$(psql -X -At -d "$DB" -c "set role authenticated; select set_config('app.current_user_id','d1000000-0000-4000-8000-000000000021',false); select count(*) from telegram_link_tokens;" 2>&1 | grep -c 'permission denied')" 1
ok "TG17 logged-in users cannot call the bot's link functions" "$(psql -X -At -d "$DB" -c "set role authenticated; select set_config('app.current_user_id','d1000000-0000-4000-8000-000000000021',false); select app.tg_link_by_phone('998900000101', 1, 1, 'uz');" 2>&1 | grep -c 'permission denied')" 1
say '{"chat":{"id":5001,"type":"private"},"from":{"id":5001},"text":"/stop"}'
worker >/dev/null
ok "TG18 /stop disconnects"                              "$(curl -s $API/api/telegram/status -H "$PH" | J "d['linked']")" False
echo "RESULT: $P passed, $F failed"; [ $F = 0 ]
