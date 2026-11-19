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

for k in 1 2 3 4 5; do login demo 900000116 bad$k >/dev/null; done
ok "S7 6th try after 5 wrong passwords is paused" "$(login demo 900000116 maktab2026 | J "d['error']")" too_many_attempts
echo "RESULT: $P passed, $F failed"; [ $F = 0 ]
