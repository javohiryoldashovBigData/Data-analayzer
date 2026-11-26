# Maktab+ — Project Brief (v2, for our team: Javohir + Claude + Perplexity)

*Paste this whole document into Perplexity together with the `maktab-plus/db/` folder. We work as one team: each of us finds problems, fixes them and checks the other's work. Nothing is accepted until it is tested.*

## 1. The goal in one paragraph

Maktab+ is a school platform for Uzbekistan: an electronic diary and gradebook like Kundalik, but faster, more flexible, with **teaching methods from the world's top school systems built in**, and AI where it truly helps. Its main promises are: **parents always know whether their child is at school**, **teachers finish their work at school instead of at home**, and **students learn with proven methods**. We start with **private schools** (fast decisions, they pay), then serve government schools from the same platform.

## 2. Rules every design must follow

1. **AI suggests, people decide.** AI never gives a final grade or punishes anyone on its own.
2. **No phones in the lesson.** Students don't use phones in class. The teacher uses a tablet or phone as little as possible.
3. **Work ends when school ends.** Every teacher feature must save time, not add work.
4. **Privacy first.** Each person sees only what they are allowed to see. No GPS, only school entry and exit. Data of Uzbek citizens is stored in Uzbekistan (check with a lawyer).
5. **Simple.** Uzbek (Latin) first, also Russian and English. Big buttons, few steps.
6. **One window per school.** Each school has its own address, look, people and data. No other school can see its window. *(new)*
7. **AI costs stay low.** Use our own code first, the Library second and AI third. *(new)*

## 3. Roles

| Role | What they do |
|---|---|
| **Teacher** | "My day" screen; one-page lesson card per lesson (plan, who to ask first, questions, homework); weekly lesson preparation; 1–2 minute "after lesson" screen; weekly tests; "Finished for today" checklist; quiet hours after 18:00 |
| **Zavuch** | Checks daily that grades, topics, homework and plans are entered; problem inbox (serious problems go to the director); timetable and substitutions; approves lesson plans; **confirms final (yearly) grades**; shares the best lesson cards (Lesson Study) |
| **Director / school admin** | Escalated problems and key numbers; staff, roles, school settings, logo and colours; payments (private schools) |
| **Student** | Diary, grades, homework, weekly tests, Library; AI tutor in Pro only |
| **Parent** | Live alerts (arrived, late, left, skipped a lesson); reports an absence in advance; grades and diary; fee payments (private); sees teachers' **names only** and contacts teachers **through the school office** |
| **Accountant** (built, step 7) | Fees, payments, receipts, debts, gentle reminders to parents; **sees money, never grades or attendance**; appointed only by the director / school admin |
| **Owner** (planned, later) | For schools with several branches: numbers across branches, no children's names by default |
| **Methodologist** | Platform-level expert who checks Library items before they become "checked" |
| **Government** (later) | Numbers only, never names. Private schools share numbers only if they agree |

## 4. Key features

- **Shared attendance:** QR/NFC at the school gate; instant parent alert; "skipped lesson" alert when the student is in the building but absent from a lesson; absence reports in advance.
- **Who to ask first:** a private list for the teacher only, made by our own code (missing homework, falling grades, missed lessons, weak weekly test, not asked for a long time).
- **Weekly tests:** different question and option order per student; the answer key is hidden and scoring happens on the server; independent-work signals (similar answers, big level jump, very fast answers, pasted text, leaving the window) go to the teacher only, and the teacher decides.
- **The Library (core idea):** made once, checked by a methodologist, used by everyone: 1-minute animations, Photo → Board (exact graphs on the projector), Photo → Learn, lesson cards, worksheets, tests. AI-made items are labelled "AI-made, not yet checked".
- **Maktab+ Yordamchi:** one helper box. Rule: **Library first, AI second.**
- **Parent → school office messages:** the office answers or forwards to the teacher.

## 5. Research-backed teaching methods (our main selling point)

Pitch: **"Research-backed teaching methods, built into the teacher's day"**, with a one-page source list. **No country labels, and never promise results**; after the pilot we show our own numbers. *(Updated after Perplexity's research check, docs/06 §2.)*

| Method | Evidence (short) | In Maktab+ |
|---|---|---|
| **Retrieval practice and spaced repetition** (headline) | Strongest: rated "high utility" (Dunlosky et al. 2013) | Each weekly test adds 1–2 low-stakes questions from older topics (our own code, no AI) |
| **Formative assessment (exit check)** | Real but smaller than often quoted (≈0.2); works only if the teacher acts on it | 3 questions at the end of the lesson, answered by a show of hands. Results change tomorrow's card and "who to ask first" |
| **Mastery-inspired review** | Mixed evidence; works best with a high bar | A topic is "not mastered" below 80% of the class, giving a review in the next card and re-check questions in the next weekly test |
| **Feedback about the task** | Powerful, but feedback about the person can hurt | 1-tap comment templates: task plus one next step ("Check the common denominator"). Weekly tests show topics and comments, not ranks. **No rankings anywhere** |
| Interleaving | "Moderate utility" | "Mix topics" option in the weekly test |
| Sharing best lesson cards (from Lesson Study) | Saves time; no proven effect on results | Teachers rate and reuse cards; the best go to the Library |
| Homework time limit | Workload feature | Limit on the lesson card; director sees the daily load |

## 6. Plans: Standard and Pro

| | **Standard** | **Pro** |
|---|---|---|
| AI for | **Teachers only** (plus a small amount for the zavuch) | Teachers, zavuch, director, students, parents |
| Teacher AI | Lesson preparation, lesson cards, weekly test creation, Photo → Board, all with monthly limits | Same with higher limits, **plus AI exam checking** from photos |
| Students | No AI: Library, weekly tests, results | AI tutor at home (explains, never hands over answers), Photo → Learn |
| Parents | No AI: live alerts, grades, simple weekly summary made by our own code | Weekly AI report |
| Director | Numbers and charts from our own code | Monthly AI report |
| Price | Lower | Higher |

- **Most "smart" features are our own code and free**, so Standard still feels smart for everyone: who to ask first, risk alerts, copy signals, forecasts, attendance alerts, charts, the Library.
- **Pilot:** the first school gets Standard plus a **free 1–2 month Pro trial**. We measure real usage and cost, then set prices.
- **Later:** add-ons (e.g. exam checking only) for Standard schools.
- **Agreed next (after pilot data):** a school AI **pool** plus a soft cap per person; show limits as **actions** ("4 weekly preparations"), not money.
- **Pricing hypothesis (estimate, test in pilot):** about 15,000 UZS (Standard) / 30,000 UZS (Pro) per student per month, billed to the school, with a minimum per school; offer the pilot two price points.
- **Already in the database (v3):** `schools.plan`, `schools.pro_trial_until`, `ai_plan_rules` (which role gets which AI feature in which plan, with a monthly limit), and `app.ai_check(school, feature)`. The server calls it before every AI request and logs usage after. The limits are **placeholder estimates** until the pilot.

### Hard budget per school (decided 20 Nov 2026)
- **Every school has a hard monthly AI cap** (`schools.ai_monthly_cap_cents`), enforced in the database for all people and features together. When it's reached, AI stops until next month and the app says "use the Library". **AI spend can never pass the cap**, so the worst case is known in advance.
- **Rule of thumb:** cap ≤ **10% of what the school pays us**. Example: a school paying 3,000,000 so'm for 3 months pays 1,000,000 so'm/month (≈ $83 at ~12,000 so'm/$, estimate), so the cap is about **$8/month (≈ 100,000 so'm)**.
- **Standard uses Haiku 5.5** ($0.10 / $0.50 per MTok) for lesson-card drafts and topic reviews, through overnight batch (−50%). Estimate: ≈ $0.002 per lesson card, so $8 covers roughly 4,000 cards a month. Sonnet only in Pro.
- **AI runs only when a person asks** (the teacher presses "Prepare next week"); nothing runs automatically per student.
- **"Mavzuni takrorlash" (topic review):** when the teacher marks "didn't get it" or a class scores < 80% on a topic, one short AI explanation is made **per class and topic** overnight (not per student), shared by every student who needs it, then reused from the Library. The personal tutor chat is Pro only.

### Ways to keep AI cost low
1. **Our own code first, Library second, AI third.**
2. **Cheap models for simple jobs**, strong models only for hard jobs (e.g. reading exam photos).
3. **Monthly limit per person.** When it's reached: "Limit reached, try the Library".
4. **Batch work:** weekly lesson preparation runs once a week through the **Batch API** (cheaper, not urgent), not on every click.
5. **Prompt caching** for the parts that repeat (curriculum, instructions).
6. **Send the AI only what's needed,** without names ("Student A").
7. **Good AI results go to the Library** after review, so the next teacher gets them free.

Rough estimate before these savings: about $300–650 per month for 10 schools with AI for everyone. Standard (teachers only) should cost much less. **Estimate only; measure in the pilot.**

## 7. Technology

React + TypeScript web app (installable PWA, mobile apps later); self-hosted Supabase/PostgreSQL **in Uzbekistan**; all permission rules in the database (row-level security); AI (Claude via the API) called **only from our server**; Telegram bot, SMS and push for alerts; Click/Payme; QR/NFC scanner app on a tablet at the gate; offline-first attendance.

## 8. Current state

- **Prototype (Phase 0):** a working React demo with sample data covering 4 roles, gradebook, diary, live attendance and gate simulation, skipped-lesson alerts, absence reports, who to ask first, AI exam checking, lesson studio, chemistry lab, weekly tests, assistant, 3 languages, dark mode, phone layout.
- **Database v3.1** (`db/`): Perplexity's structure + joint fixes from two review rounds.
- **Phase 1 API** (`db/api_phase1.sql`): designed by Perplexity, wired and tested by Claude. It covers My day, the lesson card with exit check, After lesson (one idempotent call, offline-safe), Finished for today, and AI budget reserve → commit.
- **Live app steps 1–8** (`server/`, `src/live/`): login per school window, teacher's day, parents and students, zavuch/class teacher/weekly tests, **AI with a hard budget** (prepare next week, topic review, spend vs cap), **fees and payments with the Accountant role**, **quarter + yearly grades**, the **Telegram bot** (first real delivery channel) and **school setup from one Excel file** (teacher sets quarters with a suggestion; yearly: teacher proposes → zavuch/director confirms; report card).
- **All tests green** on PostgreSQL 16: `db/run_all_tests.sh` (133 role/plan scenarios + 35 Perplexity attacks + 30 API scenarios + a 2-connection race test). Round 2 results: `docs/08-reply-to-perplexity.md`.

## 9. Decisions made (please keep them)

1. Parents see teachers' **names only**; contact goes through the school office.
2. **One window per school**; government sees numbers only; the platform super admin can't read children's data.
3. **Final grades** are confirmed by the zavuch or director; teachers enter current, exam and quarter grades.
4. **Standard** = AI for teaching only; **Pro** = AI for everyone; the pilot gets a Pro trial.
5. Pilot methods: spaced repetition, exit check, mastery-inspired review, task feedback. No rankings.
6. Attendance outside the timetable is allowed (authority still checked), so teachers are never blocked.
7. **Payments** are seen by the director, school admin and (planned) accountant — not by the zavuch or teachers. Children are **never blocked at the gate** over debt.
8. **AI**: hard monthly cap per school (≤10% of its fee); Standard uses Haiku; AI runs only when a person asks or at night in one Batch; Library first; topic review once per class + topic, only for students who didn't get it.
9. **Grades fairness**: the system suggests quarter/yearly grades from the average; a grade 1+ point away needs a short reason (never blocks). Yearly grades open by the zavuch, proposed by the teacher, confirmed by the zavuch/director.

## 10. Open questions

1. Should methodologists be platform staff (current) or does each school have its own?
2. A teacher working in two schools: currently one school per teacher.
3. Must private schools share numbers with the government? (lawyer)
4. Real AI limits per plan: measure in the pilot.

## 11. What we need from you, Perplexity

See **docs/08-reply-to-perplexity.md §6** (round 3):
1. Should a school admin be blocked from granting themselves director?
2. Real code for the Edge Functions `ai-weekly-prep` and `ai-collect`.
3. A weekly test generator with spaced repetition and interleaving.
4. The quiet-hours rule for the outbox worker.

When you answer: list your assumptions, mark anything you are unsure about, and do not invent laws or statistics. Say "check with a lawyer" or "estimate" where needed. Send SQL as files; Claude runs everything.
