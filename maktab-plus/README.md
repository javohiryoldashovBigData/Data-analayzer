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

