# Maktab+

A school platform for Uzbekistan: e-diary, gradebook, live attendance shared with parents, and AI helpers for teachers and students. This folder is **Phase 0, the interactive prototype**. It runs entirely in the browser on sample school data.

## Run it

```bash
cd maktab-plus
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ (works from any folder or static host)
```

Interface languages: Uzbek (default), Russian and English. Light and dark themes. Works on phones.

## Roles and features

| Role | What they can do |
|---|---|
| **Parent** | Live status (arrived, late, left school), alerts when a child skips a lesson while in the building, report an absence in advance (full or part day), choose alert channels (app, Telegram, SMS), multi-child switcher, diary, grades, AI report |
| **Teacher** | Gradebook (topics, homework, CSV export), lesson attendance next to gate-scan data, **who to ask first**, **AI exam checking** (answer sheet photos → suggested points and grade, teacher approves), **AI lesson studio** (plan, virtual experiment, video storyboard, real-experiment guide with safety rules, quiz, slides), **weekly tests** with independent-work checks, AI watchlist, letters to parents |
| **Student** | Diary, grades with AI forecast, weekly tests (own question and option order, follow-up "explain your answer" question), virtual chemistry lab, AI tutor |
| **Director** | School dashboard, attendance by class, **entrance scanner** (QR/NFC simulation, simulate the morning, notify parents of missing students), at-risk students, test reviews |

### Independent-work check (weekly tests)
Signals: nearly identical written answers, identical wrong choices, a result far above the student's usual level, implausibly fast answers, pasted text, leaving the test window, and a weak answer to the AI follow-up question. Results are **flags for the teacher, never automatic penalties**. Flagged results get no grade until the teacher decides.

### Who to ask first
Ranks students by: missing homework, low recent grades, falling trend, missing the previous lesson, a weak weekly-test result. A second list shows students not asked for a long time, to keep the rotation fair. Only the teacher sees these lists.

## AI

Analytics, the readiness list, risk checks, independence checks, offline exam checking and the virtual lab all **work without an AI key**.

For generative features (reading photos of answer sheets, tutor chat, lesson plans, video storyboards, AI-written weekly tests), add an Anthropic API key in **Settings**. The app uses `claude-opus-5-5` via the official `@anthropic-ai/sdk`, with server-side refusal fallback (`fallbacks: "default"`).

> ⚠️ Prototype only: the key is stored in the browser and calls go directly from it. In Phase 1 these calls move to the Maktab+ backend so the key is never exposed.

## Demo walkthrough

1. **Director** → *Entrance scanner* → type `MK-1001` (Sardor) → Enter. Turn off "Use real time" first and pick 08:12 to see a late arrival.
2. **Parent** (Dilshod Rahimov) → the dashboard shows the live status and the Telegram-style alert. Switch between the two children at the top.
3. **Teacher** (Aziza Karimova, homeroom 8-A) → *Weekly tests* → the 8-A Chemistry test shows the planted cases: Jasur copied from Madina, Otabek's sudden 100% in seconds, Nilufar pasting text.
4. **Teacher** → *AI exam checking* → *Load sample answers* → *Check with AI* → adjust anything → *Approve and save*.
5. **Student** (Sardor) → *Weekly tests* → take the maths test → answer the follow-up question.
6. *Settings* → *Reset demo* restores the sample data at any time.

## Structure

```
src/
  data/       types, sample school (seed), question bank
  ai/         insights.ts (local analytics), claude.ts (Claude API), context.ts (role-scoped data for the AI)
  lib/        store (state + actions + notifications), i18n + dictionary, dates, queries
  components/ UI kit, charts, AI box, chemistry lab
  pages/      one file per screen
```

## Next (Phase 1)
Real backend (NestJS + PostgreSQL) hosted in Uzbekistan, OneID login, a Telegram bot and SMS gateway for alerts, a real QR/NFC scanner app for the gate tablet, AI calls through the server, and a pilot school.

## Live demo (step 1): real database + API server

The real app (`live.html`) talks to PostgreSQL through a small API server (`server/index.mjs`).
The server holds **no permission logic**: every request runs inside the database as the logged-in
user (`authenticated` + user id) or as a visitor (`anon`), so the tested row-level-security rules
decide what each person sees. It connects as `authenticator`, which can read nothing by itself.

```
PGHOST=localhost PGPORT=5432 PGUSER=postgres ./dev.sh
# open http://localhost:5173/live.html   (demo school "Maktab+ Namuna maktabi")
```

- `db/demo_seed.sql`: the public demo school (3 classes, 36 students, 6 teachers, director, zavuch, a
  parent with two children). All people are invented; dates are relative to today.
- `db/auth_local.sql`: the `authenticator` role and **login with phone number (or a short login for
  children) + password**. Passwords are bcrypt hashes nobody can read; the only door is
  `app.password_login()`, which only lets you into a school where you have a role. Your roles come
  from the database; the "who are you today?" chooser appears only when you have more than one
  (e.g. a teacher who is also a parent). 5 wrong passwords → that login waits 1 minute.
- Demo logins (password `maktab2026`) are listed on the demo school's login page only.
- Each school opens in its own window: `school-a.maktabplus.uz` or `?school=school-a`.
- Database tests: `db/run_all_tests.sh` (all suites green).

## Step 2: the teacher's day

- **My day**: today's lessons, "ask first" names, absence reports, lesson status.
- **Lesson card**: topic, plan, homework, 3 exit-check questions; save or approve.
- **After lesson** (1–2 minutes): attendance for the whole class (children the gate did not see
  start as absent), optional grades with a task-focused comment, "didn't get it" taps from the
  exit check, topic, homework, private note. One call to `api.finish_lesson`.
- **Works offline**: without internet the save is kept on the device (`src/live/queue.ts`) and
  sent when the connection returns; the database answers a repeated save with the first result,
  so nothing is ever doubled (tested with two parallel connections in `db/test_api_race.sh`).
- **Finished for today**: checklist (attendance, topic, after-lesson per lesson, tomorrow's
  cards); never blocks; after closing, work messages wait until morning (quiet hours).
- Server tests: `API=http://localhost:8787 ./server/test_server.sh` (15 checks).

## Step 3: parents and students

- **Parent home**: arrived at school?, grades, attendance, homework, teachers (names only),
  switch between children.
- **Diary week** (`api.class_week`, `db/family_api.sql`): timetable, bell times, lesson topics,
  homework and grades per day. Lesson cards stay private: the diary never contains the teacher's
  "ask first" notes.
- **Report an absence in advance**: the class teacher accepts or rejects it on their "My day".
  An accepted report turns that day's "absent" into **excused** automatically, so the parent gets
  no needless alert.
- **Write to the school office**: parents never message teachers directly. The director, zavuch or
  admin answers or forwards to a teacher; the parent sees the answer under "Messages".
- Tests: `db/test_family.sql` (9), `server/test_server.sh` (27 incl. 12 for step 3).

## Step 4: zavuch, director, class teacher, weekly tests

- **Weekly tests** (`db/school_api.sql` + Perplexity's generator): the teacher picks class, subject
  and this week's topic; questions come from the school's own checked question bank (no AI), and
  old topics the class handled below 80% come back as review questions (spaced repetition).
  The teacher publishes; students take it online in their own question order; the server scores
  it; answer keys never reach the browser and are shown only after the teacher closes the test.
  Results show class mastery per topic and each student's score. No journal grade, no ranking.
- **My class** (class teacher): attendance, absences in 14 days, grade trend, and simple signals
  (attendance, grades falling) as prompts for a conversation. Payment data never appears here.
- **Zavuch's daily check**: per teacher, "after lesson" done, topics written, tomorrow's cards
  ready, day closed. **Problem inbox actions**: handled, or escalate to the director.
- Tests: `db/test_school.sql` (17), `server/test_server.sh` (41).


## Step 5: AI with a hard budget

- **Prepare next week** (teacher, My day): our own code picks the next topics from the programme.
  Checked **Library** cards are used first (free). Only the rest goes into **one** night job for
  the AI (Message Batches, 50% cheaper; Haiku on Standard). In the morning the teacher sees
  "AI draft" cards and checks them — AI never publishes anything by itself. A second click never
  queues the same lesson twice.
- **Topic review** (student + parent): made **only** for students the teacher marked "didn't get
  it" in the exit check — **once per class + topic**, shared by those students. Parents see it with
  "this is not a grade". Classmates who understood don't get it.
- **Hard budget**: each school has a monthly AI cap (`schools.ai_monthly_cap_cents`, demo $8).
  When it is reached, AI stops and **everything else keeps working** (Library cards are still
  filled in). The director and school admin see spend vs cap; the zavuch and teachers don't see money.
- **Privacy**: prompts carry the topic, grade, objectives and class-level numbers only — never
  student names. Class, date and topic come from our database, not from the model.
- **Who calls the AI**: only `server/ai-worker.mjs` (run at night: `node server/ai-worker.mjs once`)
  holds the API key. The web server never calls the AI.
- Tests: `db/test_ai.sql` (13), `server/test_ai_flow.sh` (12, against `server/fake-anthropic.mjs`
  — no key, no cost), and a race test for two teachers at the school cap.
  Run the flow test: start the API server and `PORT=8799 node server/fake-anthropic.mjs`, then
  `DEMO_DB=maktab_demo ./server/test_ai_flow.sh` on a fresh demo database.

Screens: `docs/screens/step5-*.png`.

## Step 6: quarter and yearly grades

- **Quarter grades (teacher, tab "Chorak va yillik baholar")**: for each class + subject the system
  suggests a grade (the average of current marks, 3.5 → 4; it needs at least 3 marks). The teacher
  decides. If the grade is 1+ point away from the suggestion (or there are too few marks), a short
  reason is required. It never blocks the teacher, and the zavuch can see why.
- **Yearly grades**: the zavuch or director **opens the window** (usually at the end of quarter 4).
  The teacher **proposes** (suggestion = average of quarter + exam grades). The zavuch/director
  **confirms** per class + subject; changing a grade needs a reason. Only a confirmed yearly grade
  becomes a real grade. Then students and parents are told and see it on the report card ("Tabel").
- **Rules in the database** (`db/final_grades.sql`): teachers can never write a yearly grade or
  confirm their own proposal; parents never see proposals; another school sees nothing; every
  change is in the audit log. No rankings.
- Tests: `db/test_final.sql` (29), `server/test_server.sh` G1–G13 (now 54 checks).
- Demo: 1st-quarter grades are already given; the 2nd quarter is open.

Screens: `docs/screens/step6-*.png`. (For the screenshots the zavuch opened the yearly window in
November, so the yearly grade uses quarters I–II only. In real use it opens in May.)

## Step 7: school fees, payments, debts + the Accountant role

- **Accountant** (new role, `db/finance.sql`): sees money only. No grades, attendance or student
  records; it gets just names + class on the money screens. Only the school admin or director can
  appoint one, and the director and school admin are notified when that happens.
- **Who sees money**: director, school admin, accountant. **Never** the zavuch, teachers or children.
  Debt is never shown at the gate and no child is ever stopped there.
- **Fees**: a monthly fee per grade and a due day (the 10th). Discounts (siblings, staff children)
  always need a reason. "Create this month's invoices" is safe to press twice.
- **Payments**: cash or bank, partial payments allowed, never more than owed; each gets a receipt
  number. A payment is never edited or deleted: a mistake is *cancelled with a reason*. Nobody can mark
  an invoice "paid" by hand; only payments do that. Every money change is in the audit log.
- **Debts and reminders**: overdue list for money roles only; "Remind parents" sends a gentle notice
  to parents (never to the child), at most once a week per invoice.
- **Parents**: a "To'lovlar" tab with each child's invoices and receipts.
- **Not yet**: online payment through Click / Payme. That needs the school's merchant contract and
  keys; their webhooks will write payments with the service role.
- Tests: `db/test_finance.sql` (31), `server/test_server.sh` Y1–Y11 (now 65 checks).
- Demo login: accountant `+998 90 000 01 04` (password `maktab2026`).

Screens: `docs/screens/step7-*.png`.

## Step 8a: Telegram bot (first real delivery channel)

- **Connect** in two safe ways: from the app ("Telegram'ni ulash" → a one-time link
  `t.me/<bot>?start=<token>`, valid 15 minutes, stored only as a hash), or in the bot by sharing
  **your own** phone (accepted only if the contact belongs to the sender and exactly one person in
  Maktab+ has that number). `/stop` disconnects.
- **Delivery**: `server/telegram-worker.mjs` (the only process holding the bot token) sends the
  notification queue (gate in/out, absences, skipped lessons, grades, topic review, yearly grades,
  fee reminders, parent messages, role-change alerts) in uz/ru/en. Quiet hours were already decided
  by the database. It sends plain text only, to private chats only, never to groups.
- **Failures are never silent**: no Telegram → `no_channel`; "too many requests" → retried later; the
  user blocked the bot → link removed; repeated errors → `failed` with the reason.
- **School setting** `telegram_details`: off → messages say only "new grade — see the app", with no
  child name or grade.
- Run: `TELEGRAM_BOT_TOKEN=… DATABASE_SERVICE_URL=… node server/telegram-worker.mjs loop`; the web
  server needs only the public bot name `TELEGRAM_BOT_USERNAME`.
- Tests: `server/test_telegram.sh` (18 checks) against `server/fake-telegram.mjs`. No token is needed
  and no real messages are sent.

## Step 8b: set up a school from one Excel file

- The director or school admin downloads the template (sheets O'qituvchilar / O'quvchilar /
  Dars jadvali plus an instructions sheet), fills it in and uploads it. The **browser** reads the file,
  so the server never opens uploaded files.
- `api.import_school` (`db/school_setup.sql`) checks **every row** and lists each problem in plain
  words (sheet, row, what is wrong, what was written). If anything is wrong, **nothing is saved**.
  When the file is correct, everything is saved in one go.
- It creates classes, teachers (class teacher too), students, parents (siblings share one parent),
  and the timetable plus teaching assignments. Existing people are found by phone and reused, so
  uploading the same file again creates nothing twice. It understands 5-A / 5a / 5-А (Cyrillic),
  21.05.2014 or Excel date cells, Dushanba…Shanba or 1–6, and o'g'il/qiz, ona/ota/buvi…
- New logins get an 8-character first password, **shown once** to the admin as an Excel slip list
  (a parent's slip names all their children). Only the school admin or director can import, only into
  their own school, and never themselves. Every import goes into the audit log.
- Try it: `docs/examples/namuna_6-A_sinf.xlsx` (correct) and `namuna_6-A_xatolar_bilan.xlsx` (with mistakes).
- Tests: `db/test_setup.sql` (18). A browser test with real LibreOffice-made .xlsx files also passed.

## Step 9: safe accounts for pilots + school or learning center

- **First passwords must be changed.** People created by the Excel import (or given a new password
  by the office) must set their own password at the first login. The **server** refuses every other
  request until they do (`password_change_required`), not only the screen. Passwords need at least 8
  characters and may not be the phone number, 12345678, the same as the old one, and so on.
- **Forgot your password?** The school admin or director finds the person ("Odamlar va parollar")
  and gives a new first password, shown once. This works only for people below them in their own
  school, never for themselves, and every reset goes into the audit log.
- **School or learning center**: every organisation has `org_kind` = `school` | `center`. The login
  page and header show it; school-only parts (quarter/yearly grades) are hidden for centers. The
  center screens themselves (groups, packages, trial lessons…) come in step 10.
- Tests: `db/test_accounts.sql` (18) and `server/test_server.sh` K1–K8 (now 73 checks).

## Step 10: learning centers — groups

- **A group is a class with a name** ("IELTS 6.5 — kechki"). `classes` gained `name` and a shared
  `label`, so everything built for schools works for groups too: attendance, lesson cards, the
  teacher's day, tests, grades, AI help and Telegram alerts. School classes ("5-A") are unchanged.
- **Groups** (`db/centers.sql`): course, subject, teacher, start/end dates, capacity, lesson days and
  times. The same name twice is refused, and so is a teacher in two groups at once. A full group says so.
- **Students of any age**: a child is reached through the parent; an adult (or a teen with a phone)
  gets their **own login** and receives messages directly. One student can be in **several groups**
  and stays one person.
- **Adding students**: search the center's students and add them to a group, or "Yangi o'quvchi".
  Both use the same checked import as the Excel file. In a center the "Sinf yoki guruh" column holds
  the group name, and a new last column holds the student's own phone.
- **Center wording** is used automatically ("guruh", "Markazga yozish", no school gate card).
- **Demo center**: `?school=demo-markaz` (logins listed on its login page, password `maktab2026`).
- Tests: `db/test_centers.sql` (15), `server/test_server.sh` Z1–Z8 (now 81 checks).

## Step 11: the public website + self sign-up

- **`index.html` is now the website**: what Maktab+ does for centers and schools, buttons to the
  two demos, the sign-up form and "log in to my school". The old prototype moved to `prototype.html`.
- **Self sign-up** (`db/signup.sql`): a director chooses school or learning center, the name, the
  region (all 14) and an address (`?school=<address>`, checked while typing), then their name, phone
  and password, and ticks a consent line. The organisation, its director, and default lesson times are
  created, and the director lands logged in in their own window.
- **Safety**: a website visitor can run exactly three things (regions, "is the address free", sign
  up). New api functions are closed by default. The role guard's single new exception (R0) only lets
  sign-up create the first director of an organisation made in the same transaction, and it cannot
  be used on an existing school, even with the mark set by hand. Limits: per address in the server,
  and 30 sign-ups per hour platform-wide in the database. Every sign-up is recorded.
- **First steps** card for a new director (teachers, groups/classes, students, Telegram) with a quick
  "add a teacher" form, no Excel needed.
- **Open item**: the phone number is not yet verified (no SMS / Telegram check at sign-up).
- Tests: `db/test_signup.sql` (15), `server/test_server.sh` U1–U7 (now 88 checks).
