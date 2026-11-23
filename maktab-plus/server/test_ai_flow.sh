#!/usr/bin/env bash
# MAKTAB+ — end-to-end AI test with the FAKE batch API (no key, no cost).
# Needs: fresh demo DB, API server on :8787, fake Anthropic on :8799.
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres DEMO_DB=maktab_demo ./server/test_ai_flow.sh
set -u
cd "$(dirname "$0")/.."
API=${API:-http://localhost:8787}; DB=${DEMO_DB:-maktab_demo}; P=0; F=0
ok() { if [ "$2" = "$3" ]; then P=$((P+1)); echo "PASS  $1"; else F=$((F+1)); echo "FAIL  $1 (got: $2, want: $3)"; fi; }
J() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }
tok() { curl -s -X POST $API/api/login -d "{\"slug\":\"demo\",\"login\":\"$1\",\"password\":\"maktab2026\"}" | J "d['token']"; }
worker() { DATABASE_SERVICE_URL="postgres://${PGUSER}@${PGHOST}:${PGPORT}/$DB" ANTHROPIC_API_KEY=test-not-real ANTHROPIC_BASE_URL=http://localhost:8799 node server/ai-worker.mjs once; }
sql() { psql -X -At -d "$DB" -c "$1"; }
AZ="authorization: Bearer $(tok 900000111)"
NEXTMON=$(date -d "next monday" +%F); TODAY=$(date +%F)

R=$(curl -s -X POST $API/api/teacher/ai/prep -H "$AZ" -d "{\"week_start\":\"$NEXTMON\"}")
ok "AI1 Library first: checked Library cards used for free"   "$(echo "$R" | J "d['from_library'] > 0")" True
ok "AI2 the rest is queued for AI (budget reserved)"          "$(echo "$R" | J "d['ai_queued'] > 0")" True
QUEUED=$(echo "$R" | J "d['ai_queued']")
ok "AI3 a second click queues nothing twice"                  "$(curl -s -X POST $API/api/teacher/ai/prep -H "$AZ" -d "{\"week_start\":\"$NEXTMON\"}" | J "d['ai_queued']")" 0
worker >/dev/null; worker >/dev/null
ok "AI4 worker stored one AI draft per queued lesson"         "$(sql "select count(*) from lesson_cards where status='ai_draft' and ai_generated")" "$QUEUED"
ok "AI5 Standard school uses the cheap model (Haiku)"         "$(sql "select string_agg(distinct model, ',') from ai_usage_log")" claude-haiku-5-5
ok "AI6 real cost committed, far below the school cap"        "$(sql "select (sum(cost_cents) < 1)::text from ai_usage_log")" true
ok "AI7 the topic in each draft comes from OUR curriculum"    "$(sql "select count(*) from lesson_cards where status='ai_draft' and topic not in (select topic from curriculum_topics)")" 0
ok "AI8 no student names were sent (prompts checked in DB)"   "$(sql "select count(*) from ai_reservations r, students s where r.payload::text like '%'||s.last_name||'%'")" 0

# topic review: Aziza marks Sardor "didn't get it" in today's 8-A lesson
L=$(curl -s $API/api/home -H "$AZ" | J "json.dumps([l for l in d['day']['lessons'] if l['class']=='8-A'][0])")
if [ -n "$L" ]; then
  CARD=$(curl -s -X POST $API/api/teacher/open -H "$AZ" -d "$(echo "$L" | python3 -c "import sys,json;l=json.load(sys.stdin);print(json.dumps({'class_id':l['class_id'],'subject_id':l['subject_id'],'period':l['period'],'date':'$TODAY'}))")" | J "d['card']['id']")
  curl -s -X POST $API/api/teacher/save -H "$AZ" -d "{\"card_id\":\"$CARD\",\"patch\":{\"topic\":\"Kvadrat ildizlar\",\"exit_questions\":[\"a\",\"b\",\"c\"]}}" >/dev/null
  OP=$(python3 -c "import uuid;print(uuid.uuid4())")
  curl -s -X POST $API/api/teacher/finish -H "$AZ" -d "{\"card_id\":\"$CARD\",\"payload\":{\"client_op_id\":\"$OP\",\"exit\":{\"results\":[{\"q\":1,\"got_it\":10,\"total\":12}],\"not_got\":[\"d4000000-0000-4000-8000-000000000801\"]}}}" >/dev/null
  worker >/dev/null; worker >/dev/null
  SH="authorization: Bearer $(tok sardor.r)"
  ok "AI9 Sardor (didn't get it) has a topic review at home"  "$(curl -s $API/api/home -H "$SH" | J "len(d['reviews'])")" 1
  ok "AI10 a classmate who understood does not get it"         "$(sql "select count(*) from topic_reviews where 'd4000000-0000-4000-8000-000000000802' = any(student_ids)")" 0
else echo "SKIP  AI9/AI10 (Aziza has no 8-A lesson today)"; fi

# hard cap: set the school cap below what is already spent → AI refused, everything else works
sql "update schools set ai_monthly_cap_cents = 0.01 where slug = 'demo'" >/dev/null
WEEK2=$(date -d "next monday + 7 days" +%F)
R2=$(curl -s -X POST $API/api/teacher/ai/prep -H "$AZ" -d "{\"week_start\":\"$WEEK2\"}")
ok "AI11 school cap reached → AI refused with a clear reason" "$(echo "$R2" | J "d.get('ai_blocked')")" school_budget_reached
ok "AI12 … but Library cards still work (no AI needed)"      "$(sql "select count(*) > 0 from lesson_cards where lesson_date >= '$WEEK2' and status='draft'")" t
sql "update schools set ai_monthly_cap_cents = 800 where slug = 'demo'" >/dev/null
echo "RESULT: $P passed, $F failed"; [ $F = 0 ]
