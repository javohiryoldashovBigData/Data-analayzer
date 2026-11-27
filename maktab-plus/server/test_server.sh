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

# ---- step 4: weekly tests online, My class, zavuch check
SH="authorization: Bearer $(tok sardor.r)"
TID=$(curl -s $API/api/student/tests -H "$SH" | J "[t for t in d if t['status']=='published'][0]['test_id']")
START=$(curl -s -X POST $API/api/student/tests/start -H "$SH" -d "{\"test_id\":\"$TID\"}")
ok "W1 student starts the published test (5 questions)" "$(echo "$START" | J "len(d['questions'])")" 5
ok "W2 no answer keys are sent to the student"           "$(echo "$START" | grep -c -i correct)" 0
AID=$(echo "$START" | J "d['attempt_id']")
for QID in $(echo "$START" | J "' '.join(q['id'] for q in d['questions'])"); do
  curl -s -X POST $API/api/student/tests/answer -H "$SH" -d "{\"attempt_id\":\"$AID\",\"question_id\":\"$QID\",\"choice\":0}" >/dev/null; done
ok "W3 the server scores it (a number 0–100)"            "$(curl -s -X POST $API/api/student/tests/submit -H "$SH" -d "{\"attempt_id\":\"$AID\"}" | J "0 <= d['score'] <= 100")" True
ok "W4 a second submit is refused"                      "$(curl -s -X POST $API/api/student/tests/submit -H "$SH" -d "{\"attempt_id\":\"$AID\"}" | J "d['error']")" not_allowed
ok "W5 a parent cannot take the child's test"           "$(curl -s -X POST $API/api/student/tests/start -H "$PH" -d "{\"test_id\":\"$TID\"}" | J "d['error']")" not_allowed
AZ="authorization: Bearer $(tok 900000111)"
ok "W6 teacher sees results incl. Sardor's attempt"     "$(curl -s "$API/api/teacher/tests/results?test=$TID" -H "$AZ" | J "len([s for s in d['students'] if s['submitted_at']]) >= 1")" True
NEW=$(curl -s -X POST $API/api/teacher/tests/generate -H "$AZ" -d "{\"class_id\":\"$CLS7\",\"subject_id\":1,\"topic\":\"Chiziqli tenglamalar\",\"test_date\":\"$TODAY\",\"n_new\":6,\"n_review\":3}")
ok "W7 generator brings back an old topic for review"   "$(echo "$NEW" | J "'Kasrlar' in d['review_topics']")" True
NTID=$(echo "$NEW" | J "d['test_id']")
ok "W8 another teacher cannot publish Aziza's test"     "$(curl -s -X POST $API/api/teacher/tests/status -H "authorization: Bearer $(tok 900000114)" -d "{\"test_id\":\"$NTID\",\"status\":\"published\"}" | J "d['error']")" not_allowed
ok "W9 Aziza publishes it"                              "$(curl -s -X POST $API/api/teacher/tests/status -H "$AZ" -d "{\"test_id\":\"$NTID\",\"status\":\"published\"}" | J "d['status']")" published
ok "W10 My class: Aziza sees 7-A, Bekzod has signals"   "$(curl -s $API/api/teacher/myclass -H "$AZ" | J "d['class']+':'+str(len([s for s in d['students'] if s['last_name']=='Tursunov' and s['signals']]))")" 7-A:1
ZV="authorization: Bearer $(tok 900000102)"
ok "W11 zavuch's daily check lists all 6 teachers"      "$(curl -s "$API/api/office/daycheck?date=$TODAY" -H "$ZV" | J "len(d)")" 6
ok "W12 a teacher cannot open the zavuch check"         "$(curl -s "$API/api/office/daycheck?date=$TODAY" -H "$AZ" | J "d['error']")" not_allowed
PRB=$(curl -s $API/api/home -H "$ZV" | J "d['problems'][0]['id']")
ok "W13 a teacher cannot handle problems"               "$(curl -s -X POST $API/api/office/problem -H "$AZ" -d "{\"id\":\"$PRB\",\"status\":\"handled\"}" | J "d['error']")" not_allowed
ok "W14 zavuch escalates a problem to the director"     "$(curl -s -X POST $API/api/office/problem -H "$ZV" -d "{\"id\":\"$PRB\",\"status\":\"escalated\",\"note\":\"Ota-ona bilan uchrashuv\"}" | J "d['status']")" escalated

# ---- step 6: quarter + yearly grades (Aziza, maths, 5-A; Temur's class) ----
C5=d3000000-0000-4000-8000-000000000005; ZV2="authorization: Bearer $(tok 900000102)"
QS=$(curl -s "$API/api/grades/quarter?class=$C5&subject=1" -H "$H")
ok "G1 teacher opens the quarter sheet (12 students, suggestions)" "$(echo "$QS" | J "len(d['students'])")" 12
ok "G2 a parent cannot open a grade sheet"  "$(curl -s "$API/api/grades/quarter?class=$C5&subject=1" -H "$PH" | J "d['error']")" not_allowed
TERM=$(echo "$QS" | J "d['term']['id']")
ROWS=$(echo "$QS" | J "json.dumps([{'student_id':x['student_id'],'value':x['suggested'] or 4,'note':'' if x['suggested'] else 'Kam baho, og\'zaki so\'raldi'} for x in d['students']])")
ok "G3 teacher saves the quarter grades"    "$(curl -s -X POST $API/api/grades/quarter -H "$H" -d "{\"class_id\":\"$C5\",\"subject_id\":1,\"term_id\":\"$TERM\",\"rows\":$ROWS}" | J "d['saved']")" 12
FAR=$(echo "$QS" | J "json.dumps([{'student_id':d['students'][0]['student_id'],'value':1}])")
ok "G4 a grade far from the suggestion asks for a reason (and says whose)" "$(curl -s -X POST $API/api/grades/quarter -H "$H" -d "{\"class_id\":\"$C5\",\"subject_id\":1,\"term_id\":\"$TERM\",\"rows\":$FAR}" | J "d['error']+'|'+str(len(d.get('student_id','')))")" "reason_required|36"
YS=$(curl -s "$API/api/grades/year?class=$C5&subject=1" -H "$H")
YROWS=$(echo "$YS" | J "json.dumps([{'student_id':x['student_id'],'value':x['suggested'] or 4,'note':'' if x['suggested'] else 'x'} for x in d['students']])")
ok "G5 yearly grades wait for the zavuch's window" "$(curl -s -X POST $API/api/grades/year/propose -H "$H" -d "{\"class_id\":\"$C5\",\"subject_id\":1,\"rows\":$YROWS}" | J "d['error']")" window_closed
ok "G6 a teacher cannot open the window"    "$(curl -s -X POST $API/api/office/grades/window -H "$H" -d '{"open":true}' | J "d['error']")" not_allowed
ok "G7 the zavuch opens the window"         "$(curl -s -X POST $API/api/office/grades/window -H "$ZV2" -d '{"open":true}' | J "d['open']")" True
ok "G8 the teacher proposes yearly grades"  "$(curl -s -X POST $API/api/grades/year/propose -H "$H" -d "{\"class_id\":\"$C5\",\"subject_id\":1,\"rows\":$YROWS}" | J "d['proposed']")" 12
ok "G9 the zavuch's overview shows 12 proposed for 5-A maths" "$(curl -s $API/api/office/grades -H "$ZV2" | J "[r['proposed'] for r in d['rows'] if r['class']=='5-A' and r['subject_id']==1][0]")" 12
ok "G10 another teacher cannot confirm"     "$(curl -s -X POST $API/api/office/grades/confirm -H "authorization: Bearer $(tok 900000114)" -d "{\"class_id\":\"$C5\",\"subject_id\":1}" | J "d['error']")" not_allowed
ok "G11 the zavuch confirms the class"      "$(curl -s -X POST $API/api/office/grades/confirm -H "$ZV2" -d "{\"class_id\":\"$C5\",\"subject_id\":1}" | J "d['confirmed']")" 12
TEMUR=$(curl -s $API/api/home -H "$PH" | J "[k['id'] for k in d['kids'] if k['class']=='5-A'][0]")
ok "G12 the parent sees Temur's yearly maths grade" "$(curl -s "$API/api/family/report?student=$TEMUR" -H "$PH" | J "[r['final'] is not None for r in d if r['subject_id']==1][0]")" True
ok "G13 … and nobody else's child"          "$(curl -s "$API/api/family/report?student=d4000000-0000-4000-8000-000000000701" -H "$PH" | J "len(d)")" 0
curl -s -X POST $API/api/office/grades/window -H "$ZV2" -d '{"open":false}' >/dev/null

# ---- step 7: money (accountant Barno; zavuch, teacher, parent, student) ----
AC="authorization: Bearer $(tok 900000104)"
ok "Y1 the accountant's home is the money screen"  "$(curl -s $API/api/home -H "$AC" | J "d['role']+'|'+str(d['seesMoney'])")" "accountant|True"
OVR=$(curl -s $API/api/finance/overview -H "$AC")
ok "Y2 the accountant sees families in debt"        "$(echo "$OVR" | J "d['families_in_debt'] > 0")" True
ok "Y3 the zavuch never sees money"                 "$(curl -s $API/api/finance/overview -H "$ZV2" | J "d['error']")" not_allowed
ok "Y4 a teacher never sees money"                  "$(curl -s $API/api/finance/students -H "$H" | J "d['error']")" not_allowed
ok "Y5 the accountant cannot open grades"           "$(curl -s "$API/api/grades/quarter?class=$C5&subject=1" -H "$AC" | J "d['error']")" not_allowed
ok "Y6 the parent sees only his 2 children's fees"  "$(curl -s $API/api/family/fees -H "$PH" | J "len(set(x['student_id'] for x in d))")" 2
ok "Y7 a child never sees money"                    "$(curl -s $API/api/family/fees -H "authorization: Bearer $(tok sardor.r)" | J "len(d)")" 0
DEB=$(echo "$OVR" | J "d['debtors'][0]['student_id']")
INV=$(curl -s "$API/api/finance/student?id=$DEB" -H "$AC" | J "[x for x in d['invoices'] if x['overdue']][0]['id']")
ok "Y8 more than is owed is refused"                "$(curl -s -X POST $API/api/finance/pay -H "$AC" -d "{\"invoice_id\":\"$INV\",\"amount\":99000000,\"method\":\"cash\"}" | J "d['error']")" bad_amount
ok "Y9 a cash payment gives a receipt number"       "$(curl -s -X POST $API/api/finance/pay -H "$AC" -d "{\"invoice_id\":\"$INV\",\"amount\":500000,\"method\":\"cash\",\"note\":\"Kassaga\"}" | J "d['receipt_no'] > 0")" True
ok "Y10 a parent cannot record a payment"           "$(curl -s -X POST $API/api/finance/pay -H "$PH" -d "{\"invoice_id\":\"$INV\",\"amount\":1000,\"method\":\"cash\"}" | J "d['error']")" not_allowed
ok "Y11 reminders to parents: once a week at most"  "$(curl -s -X POST $API/api/finance/remind -H "$AC" | J "d['invoices'] > 0")|$(curl -s -X POST $API/api/finance/remind -H "$AC" | J "d['invoices']")" "True|0"

# ---- step 9: first password, office reset, school/center ----
AD="authorization: Bearer $(tok 900000103)"                          # school admin Oybek
TMP=$(curl -s -X POST $API/api/office/import -H "$AD" -d '{"commit":true,"data":{"teachers":[{"row":2,"last_name":"Sobirova","first_name":"Lola","phone":"+998 90 555 44 33"}]}}' | J "d['logins'][0]['password']")
LR=$(login demo "+998905554433" "$TMP")
ok "K1 a first password: the login says 'change it first'"   "$(echo "$LR" | J "d['mustChange']")" True
MT="authorization: Bearer $(echo "$LR" | J "d['token']")"
ok "K2 … and the server refuses everything else until then"  "$(curl -s $API/api/home -H "$MT" | J "d['error']")" password_change_required
ok "K3 the old password must be right"                       "$(curl -s -X POST $API/api/password/change -H "$MT" -d '{"old_password":"xxxxxxxx","new_password":"Yangi-parol-77"}' | J "d['error']")" wrong_password
NT=$(curl -s -X POST $API/api/password/change -H "$MT" -d "{\"old_password\":\"$TMP\",\"new_password\":\"Yangi-parol-77\"}" | J "d['token']")
ok "K4 after the change the new session works"               "$(curl -s $API/api/home -H "authorization: Bearer $NT" | J "d['role']")" teacher
ok "K5 next login: no 'change' step any more"                "$(login demo "+998905554433" "Yangi-parol-77" | J "d['mustChange']")" False
UID2=$(curl -s "$API/api/office/people?q=Sobirova" -H "$AD" | J "d[0]['user_id']")
RP=$(curl -s -X POST $API/api/office/reset-password -H "$AD" -d "{\"user_id\":\"$UID2\"}" | J "d['password']")
ok "K6 the office resets a forgotten password: old one dead, new one must be changed" "$(login demo "+998905554433" "Yangi-parol-77" | J "d['error']")|$(login demo "+998905554433" "$RP" | J "d['mustChange']")" "bad_credentials|True"
ok "K7 a zavuch cannot see the people list"                  "$(curl -s "$API/api/office/people?q=a" -H "$ZV2" | J "d['error']")" not_allowed
ok "K8 the login page knows: school or learning center"      "$(curl -s $API/api/window/demo | J "d['org_kind']")" school

for k in 1 2 3 4 5; do login demo 900000116 bad$k >/dev/null; done
ok "S7 6th try after 5 wrong passwords is paused" "$(login demo 900000116 maktab2026 | J "d['error']")" too_many_attempts
echo "RESULT: $P passed, $F failed"; [ $F = 0 ]
