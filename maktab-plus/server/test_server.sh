#!/usr/bin/env bash
# MAKTAB+ — API server smoke + security test (runs against a fresh demo database).
# Usage: API=http://localhost:8787 ./server/test_server.sh      Exit 0 = all passed.
set -u
API=${API:-http://localhost:8787}; P=0; F=0
ok()  { if [ "$2" = "$3" ]; then P=$((P+1)); echo "PASS  $1"; else F=$((F+1)); echo "FAIL  $1 (got: $2, want: $3)"; fi; }
J()   { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }
login() { curl -s -X POST $API/api/login -d "{\"slug\":\"$1\",\"login\":\"$2\",\"password\":\"$3\"}"; }
tok()   { login demo "$1" maktab2026 | J "d['token']"; }
TODAY=$(date +%F)

ok "S1 wrong password refused"            "$(login demo 900000111 nope | J "d['error']")" bad_credentials
ok "S2 login refused in another window"   "$(login school-a 900000111 maktab2026 | J "d['error']")" bad_credentials
ok "S3 no session → 401"                  "$(curl -s -o /dev/null -w '%{http_code}' $API/api/home)" 401
ok "S4 forged session → 401"              "$(curl -s -o /dev/null -w '%{http_code}' $API/api/home -H 'authorization: Bearer abc.def')" 401
ST=$(tok sardor.r)
ok "S5 student asking for director screen gets student" "$(curl -s "$API/api/home?role=director" -H "authorization: Bearer $ST" | J "d['role']")" student
ok "S6 multi-role user sees both roles"   "$(login demo 900000112 maktab2026 | J "','.join(d['roles'])")" teacher,parent

TT=$(tok 900000111); H="authorization: Bearer $TT"
L=$(curl -s $API/api/home -H "$H" | J "json.dumps({'class_id':d['day']['lessons'][0]['class_id'],'subject_id':d['day']['lessons'][0]['subject_id'],'period':d['day']['lessons'][0]['period'],'date':'$TODAY'})")
CARD=$(curl -s -X POST $API/api/teacher/open -H "$H" -d "$L" | J "d['card']['id']")
ok "T1 teacher opens own lesson card"     "$([ ${#CARD} = 36 ] && echo yes)" yes
ok "T2 parent cannot open a lesson card"  "$(curl -s -X POST $API/api/teacher/open -H "authorization: Bearer $(tok 900000121)" -d "$L" | J "d['error']")" not_allowed
ok "T3 other teacher cannot read the card" "$(curl -s "$API/api/teacher/lesson?card=$CARD" -H "authorization: Bearer $(tok 900000114)" | J "d['error']")" not_allowed
OP=$(python3 -c "import uuid;print(uuid.uuid4())")
BODY="{\"card_id\":\"$CARD\",\"payload\":{\"client_op_id\":\"$OP\",\"absent\":[],\"topic\":\"Test\"}}"
ok "T4 after-lesson save works"           "$(curl -s -X POST $API/api/teacher/finish -H "$H" -d "$BODY" | J "d['ok']")" True
ok "T5 same save again (offline retry) is accepted" "$(curl -s -X POST $API/api/teacher/finish -H "$H" -d "$BODY" | J "d['ok']")" True
ok "T6 broken input → 400"                "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/teacher/finish -H "$H" -d '{"card_id":"x","payload":{}}')" 400
ok "T7 checklist answers"                 "$(curl -s "$API/api/teacher/checklist?date=$TODAY" -H "$H" | J "'total' in d")" True
ok "T8 finished for today"                "$(curl -s -X POST $API/api/teacher/close -H "$H" -d "{\"date\":\"$TODAY\"}" | J "d['closed']")" True

# ---- step 3: parents, class teacher, school office
PT=$(tok 900000121); PH="authorization: Bearer $PT"
SARDOR=d4000000-0000-4000-8000-000000000801; OTHER=d4000000-0000-4000-8000-000000000702
TOMORROW=$(date -d tomorrow +%F 2>/dev/null || date -v+1d +%F)
ok "P1 parent reports own child's absence"        "$(curl -s -X POST $API/api/family/absence -H "$PH" -d "{\"student_id\":\"$SARDOR\",\"date\":\"$TOMORROW\",\"reason\":\"Shifokor\"}" | J "d['status']")" pending
ok "P2 parent cannot report another child"        "$(curl -s -X POST $API/api/family/absence -H "$PH" -d "{\"student_id\":\"$OTHER\",\"date\":\"$TOMORROW\",\"reason\":\"x\"}" | J "d['error']")" not_allowed
ok "P3 parent cannot report a past date"          "$(curl -s -X POST $API/api/family/absence -H "$PH" -d "{\"student_id\":\"$SARDOR\",\"date\":\"2026-01-05\",\"reason\":\"x\"}" | J "d['error']")" not_allowed
ok "P4 parent writes to the school office"        "$(curl -s -X POST $API/api/family/message -H "$PH" -d "{\"student_id\":\"$SARDOR\",\"topic\":\"Uy vazifasi\",\"body\":\"Savol bor\"}" | J "d['status']")" open
ok "P5 parent cannot write about another child"   "$(curl -s -X POST $API/api/family/message -H "$PH" -d "{\"student_id\":\"$OTHER\",\"topic\":\"x\",\"body\":\"x\"}" | J "d['error']")" not_allowed
CLS8=d3000000-0000-4000-8000-000000000008; CLS7=d3000000-0000-4000-8000-000000000007
ok "P6 parent reads the child's diary week"       "$(curl -s "$API/api/family/week?class=$CLS8&start=$TODAY" -H "$PH" | J "len(d) > 0")" True
ok "P7 parent cannot read another class's diary"  "$(curl -s "$API/api/family/week?class=$CLS7&start=$TODAY" -H "$PH" | J "d['error']")" not_allowed
RID=$(curl -s $API/api/home -H "authorization: Bearer $(tok 900000113)" | J "d['absenceToReview'][0]['id']")
ok "P8 another teacher cannot decide the report"  "$(curl -s -X POST $API/api/teacher/absence -H "authorization: Bearer $(tok 900000114)" -d "{\"id\":\"$RID\",\"status\":\"accepted\"}" | J "d['error']")" not_allowed
ok "P9 the class teacher accepts it"              "$(curl -s -X POST $API/api/teacher/absence -H "authorization: Bearer $(tok 900000113)" -d "{\"id\":\"$RID\",\"status\":\"accepted\"}" | J "d['status']")" accepted
MID=$(curl -s $API/api/home -H "authorization: Bearer $(tok 900000102)" | J "[m for m in d['inbox'] if m['topic']=='Uy vazifasi'][0]['id']")
ok "P10 a teacher cannot answer office messages"  "$(curl -s -X POST $API/api/office/reply -H "authorization: Bearer $(tok 900000114)" -d "{\"id\":\"$MID\",\"reply\":\"x\"}" | J "d['error']")" not_allowed
ok "P11 the zavuch answers the parent"            "$(curl -s -X POST $API/api/office/reply -H "authorization: Bearer $(tok 900000102)" -d "{\"id\":\"$MID\",\"reply\":\"Ertaga ustoz bilan gaplashamiz\"}" | J "d['status']")" answered
ok "P12 the parent sees the answer"               "$(curl -s $API/api/home -H "$PH" | J "[m for m in d['messages'] if m['id']=='$MID'][0]['reply'] is not None")" True

for k in 1 2 3 4 5; do login demo 900000116 bad$k >/dev/null; done
ok "S7 6th try after 5 wrong passwords is paused" "$(login demo 900000116 maktab2026 | J "d['error']")" too_many_attempts
echo "RESULT: $P passed, $F failed"; [ $F = 0 ]
