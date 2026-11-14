# Maktab+ — Project Brief

*Paste this whole document into an AI assistant (e.g. Perplexity) before asking it to design or build any part of Maktab+.*

## 1. The goal in one paragraph

Maktab+ is a school platform for Uzbekistan: an electronic diary and gradebook like Kundalik, but faster, more flexible, and with AI built in for every role. Its main promises are: **parents always know whether their child is at school**, **teachers finish their work at school instead of at home**, and **students get help that teaches instead of giving answers**. It starts with private schools (fast decisions, they pay) and later serves government schools and the Ministry from the same platform.

## 2. Rules every design must follow

1. **AI suggests, people decide.** AI never gives a final grade or punishes anyone on its own. Every AI result is a suggestion a teacher approves.
2. **No phones in the lesson.** Uzbek schools don't allow student phones in class. The platform works before and after the lesson; during the lesson the teacher teaches normally.
3. **Work ends when school ends.** Every teacher feature must save time, not add work.
4. **Privacy first.** Each person sees only what they are allowed to see. No GPS tracking of children — only school entry and exit are recorded. Personal data of Uzbek citizens must be stored on servers inside Uzbekistan.
5. **Simple.** Uzbek (Latin) first, also Russian and English. Big buttons, few steps.

## 3. Roles and what each one does

| Role | What they do in Maktab+ |
|---|---|
| **Teacher** | "My day" screen; one-page lesson card per lesson (plan, who to ask first, questions, homework); AI prepares next week's lessons; 1–2 minute "after lesson" screen (attendance, grades, homework); photo checking of written work; weekly tests; "Finished for today" checklist; quiet hours (no parent messages after 18:00) |
| **Zavuch** (deputy director) | Checks every day that teachers entered grades, topics, homework and lesson plans; problem inbox (small problems solved here, serious ones sent to the director); timetable; substitutions when a teacher is sick; approves lesson plans; weekly report to the director |
| **Director** | Sees only escalated problems plus key numbers (attendance, grades, students at risk); monthly AI report; staff and school settings |
| **Student** | Diary, grades, homework, weekly test results; AI tutor at home that explains step by step and does not hand over homework answers; Photo → Learn |
| **Parent** | Live alerts: arrived, late, left school, skipped a lesson while in the building; report an absence in advance; grades and diary; weekly AI report; alerts via app, Telegram or SMS; in private schools also fee payments |
| **Government** (later) | District, region and Ministry dashboards with numbers only (no names); automatic reports; OneID login |

## 4. Key features

**Shared attendance.** Students check in at the school gate with a QR or NFC card. Parents get an instant Telegram/app message. If a student is in the building but marked absent in a lesson, parent and homeroom teacher are alerted ("skipped lesson"). Parents can report an absence in advance; the homeroom teacher accepts it and the day is marked excused.

**Teacher AI.**
- *Exam checking:* the teacher photographs answer sheets; AI reads them, suggests points and a grade with a confidence level; the teacher approves before anything reaches the gradebook.
- *Who to ask first:* a private list ranking students likely not ready (missing homework, falling grades, missed last lesson, weak weekly test) plus students not asked for a long time, for fair rotation.
- *Weekly lesson preparation:* AI drafts next week's lesson cards from the timetable and curriculum; the teacher only checks.

**Weekly tests.** AI builds a short weekly test from the topics actually taught. Each student gets a different question and option order. Tests can be on paper (photo-checked) or at home. Independent-work signals for the teacher: nearly identical written answers, identical wrong choices, a big jump above the student's usual level, implausibly fast answers, pasted text, leaving the test window, and a follow-up question where the student must explain their own answer. These are flags only; the teacher decides.

**The Library (core idea).** Content made once, checked by a methodologist (experienced teacher), shared by every teacher and student:
1. *Animations:* ready 1-minute animated explanations of hard topics (English tenses, chemical reactions, photosynthesis, forces, graphs).
2. *Photo → Board:* a teacher photographs a textbook exercise; AI reads it and our own code draws an exact graph or diagram for the projector.
3. *Photo → Learn:* a student photographs a topic at home; the matching Library animation plays, or the AI tutor explains with practice questions.
4. *Lesson materials:* lesson cards, worksheets, tests.

**Maktab+ Yordamchi (one AI helper).** One box on every screen. Ask by text, photo or voice (Uzbek, Russian, English). It returns the best format: animation, graph, virtual experiment, step-by-step explanation, slides, quiz or lesson card. Rule: **Library first, AI second.** AI-made items are labelled "AI-made, not yet checked"; popular ones go to the methodologist and then into the Library.

## 5. One platform, two modes

The core (everything above) is the same for all schools. A school is set up as one of two modes:
- **Private school mode** adds: fee payments (Click, Payme) with reminders, online admission (application, test, interview), school branding, parent ratings, teacher performance, paid clubs, optional school-bus alerts. The school pays a subscription.
- **Government school mode** adds: full reporting to district, region and Ministry. Paid by a government contract.

Each school sees only its own data.

## 6. AI approach and cost

- AI is **Claude (Anthropic) via the API**, called **only from our server** (keys never in the browser). Pro/Max personal plans cannot be used for an app.
- Many "smart" features use **our own code, not AI** (free): who to ask first, risk detection, copy signals, grade forecasts, attendance alerts, exact graph drawing.
- Cost control: Library first; cheap models (Haiku) for simple tasks, Sonnet for most, Opus only for hard ones (e.g. reading exam photos); prompt caching; monthly limits per user.
- Send the AI only what is needed, without names where possible (e.g. "Student A").
- Rough estimate for 10 schools (200 teachers, 2,000 students): about **$300–650 per month** for AI, to be measured during the pilot.

## 7. Technology (target)

React + TypeScript web app (installable PWA, mobile apps later); Node.js or Supabase backend with PostgreSQL; Telegram bot, SMS and push for alerts; Click/Payme; QR/NFC scanner app on a tablet at the gate; hosting **in Uzbekistan** (Supabase self-hosted is acceptable, Supabase cloud is not for real student data). Offline-first attendance for teachers.

## 8. Current state

- **Done:** a working Phase 0 prototype (React + TypeScript, sample data in the browser): 4 roles, gradebook, diary, live attendance with gate scanner simulation and parent alerts, skipped-lesson detection, absence reports, who to ask first, AI exam checking, AI lesson studio, virtual chemistry lab, weekly tests with independence checks, AI assistant, Uzbek/Russian/English, dark mode, phone layout.
- **Draft database design** (`schema.sql` + docs, produced earlier by Perplexity): good structure, but testing it in a real PostgreSQL database found problems that must be fixed before use (section 9).

## 9. Problems found in the draft `schema.sql` (tested in PostgreSQL 16)

1. **Cross-school data leak (critical):** `app.role(school_id uuid)` and `app.visible_students(school_id uuid)` name their parameter the same as a column, so `r.school_id = school_id` compares the column with itself. Result: an admin of one school is treated as admin of every school and can read other schools' students, grades and attendance. Fix: rename parameters (e.g. `p_school_id`).
2. **Profiles visible to everyone (critical):** policy `profiles_admin` ends with `or true`, so any teacher or admin anywhere can read all names and phone numbers.
3. **13 tables have no row-level security** but are readable by every logged-in user: `student_term_summary` (everyone's averages), `notification_outbox`, `audit_log`, `teacher_assignments`, `notification_preferences`, `terms`, `bell_periods`, `rooms`, and others.
4. **Grade inserts always fail:** triggers `INSERT ... ON CONFLICT` into the materialized view `student_term_summary`, which PostgreSQL does not allow. Use a normal table maintained by triggers, or refresh the view on a schedule.
5. **`notifications` cannot be created:** primary key on `id` alone on a table partitioned by `recipient_id`. The key must include `recipient_id`.
6. **Teachers cannot write at all:** the final `revoke insert, update, delete ... from authenticated` removes table privileges, so the RLS write policies never apply. Grant writes and let RLS restrict them.
7. **Audit log is never written:** no triggers populate `audit_log`.
8. **Region and district admins are not implemented** in the access functions.
9. **Absence alerts only on insert:** changing a mark from present to absent through an upsert sends no alert.
Also: grade insert policy doesn't check grade type, academic year or that `teacher_id` is the caller; attendance write policy lets any teacher of a class mark any lesson.

## 10. What we need from you

Please design (or correct) the following, and **follow the rules in section 2**:

1. A **corrected `schema.sql`** that fixes every problem in section 9, with a short test script showing each role (teacher, parent, student, school admin, admin of another school) sees and writes only what it should.
2. **New tables** for the Maktab+-specific features: gate check-in events, parent absence reports (pending/accepted), skipped-lesson alerts, zavuch role and problem inbox, lesson cards and weekly preparation, weekly tests with per-student question order and integrity flags, the Library (animations, Photo → Board visuals, materials, review status "AI-made / checked"), AI usage limits per user, private-school payments and admissions, school mode (private/government).
3. Keep it **multi-tenant by school**, self-hostable in Uzbekistan, and Uzbek-first.

When you answer, please: list your assumptions, mark anything you are unsure about, and do not invent laws or statistics — say "check with a lawyer" or "estimate" where needed.
