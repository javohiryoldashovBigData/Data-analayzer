# 06 — Perplexity review of brief v2 (§11.1–§11.3)

Reviewer: Perplexity · Date: 15 Nov 2026 · Status: **for team check** (rule: nothing is accepted until it is tested)

## 0. Assumptions and limits (read first)

| # | Assumption / limit | Effect |
|---|---|---|
| A1 | The v3 `db/` folder (schema, seed, `test_rls.sql` with 133 scenarios, `CHANGES_V3.md`) was **not attached** — only the brief arrived. | I attacked **v2** (which v3 is built on) and wrote `db/test_v3.sql` against v2 table names and seed UUIDs. Some holes may already be fixed in v3; the test file will show that. |
| A2 | No PostgreSQL in my sandbox. | `test_v3.sql` is **parse-checked only** (pglast: 69 statements, 33 embedded attack queries, all PL/pgSQL bodies). **Not run.** Please run it on PG16 and send me the output. |
| A3 | "Same style" = the helpers in my `test_rls.sql` (`test.asuser`, `test.count`, `test.error`). | I added `test.attack` / `test.blocked` / `test.zero_or_denied` that **record** every result and fail loudly at the end, so one run shows all holes. Adapt to your v3 runner if it differs. |
| A4 | Prices: Claude API list prices of 15 Nov 2026; 1 USD ≈ 12,014 UZS ([CBU](https://cbu.uz/en/arkhiv-kursov-valyut/print/)). | All costs and prices below are **estimates**. |

---

## 1. Database: attacks (§11.1)

### What I changed
- **Added `db/test_v3.sql`** — 16 attack groups, 31 assertions + 1 SKIP guard for `app.ai_check`.
- **Did not edit `schema.sql`** — v3 is yours and I can't see it. Below is the fix I recommend for each hole; please apply in v3, then the attack must PASS.

### Holes found by reading the v2 policies (verified line by line)

| ID | Attack | Why it works in v2 | Severity | Fix for v3 |
|---|---|---|---|---|
| **A1** | Parent files an absence report for **any child in any school** | `absence_reports_insert`: `g.student_id = student_id` inside a subquery over `guardians g` — the unqualified `student_id` resolves to `g.student_id`, so the check is always true (same bug class as v1's parameter shadowing). `school_id` is never compared with the child's school. | **High** — fake "absence accepted" for a stranger's child; data in another school's window | `g.student_id = parent_absence_reports.student_id` **and** `school_id = (select s.school_id from students s where s.id = parent_absence_reports.student_id)` |
| **A2** | Teacher **re-points own attendance row** to a student in another school and sets `absent` | `attendance_update_chk` passes on `marked_by = auth.uid()` alone; the new `student_id`/`class_id` are never checked. Trigger then sends an absence alert to a stranger's parent. | **High** | `BEFORE UPDATE` trigger: `student_id, class_id, date, period` are immutable (raise if changed). Corrections = new row. |
| A2b | Teacher marks a lesson that is not in their timetable | `attendance_insert` checks "teaches this class/subject", not the slot | Medium — decide | Optional: check `timetable_slots` ∪ `substitutions` for that date/period |
| **A3** | Student reads the **answer key** | `questions_select` = any member of the school, all columns incl. `correct_index` | **High** — breaks weekly tests | `revoke select on test_questions from authenticated; grant select (id,test_id,question_text,options,points,position) …`; teachers read the key via an RPC |
| **A4** | Student **self-scores** (`score=100`), writes `is_correct=true`, starts attempts on other schools' or draft tests | `attempts_insert` / `answers_insert` only check "it's my attempt" | **High** | Revoke INSERT on `test_attempts`, `attempt_answers`; RPCs `start_attempt(test)` (checks class membership + `status='published'` + window), `submit_answer`, `submit_attempt` (server scores) |
| **A5** | Teacher enters or upgrades to a **final** grade | `grades_insert`/`grades_update` don't look at `grade_type` | High — breaks decision §9.3 | `grade_type <> 'final'` for teachers; final only via `confirm_final_grade()` for zavuch/director |
| **A6** | **Zavuch grants self director / school_admin**, or deactivates the director | `roles_write` = `manages_school()`, which includes zavuch, with no role ranking and no "not yourself" rule | **High** — privilege escalation | Remove direct writes; RPC `app.grant_role(user, role, school)` with a matrix (e.g. director → school_admin, zavuch, teacher; school_admin → teacher, student, parent; nobody grants to self or above own rank) |
| **A7** | Any zavuch in the country marks a Library item **checked** | `can_edit_library()` = any admin anywhere; no column rule on `status` | Medium | Only `methodologist` may set `checked`; school staff may insert with `under_review` |
| **A8** | **Super admin reads children's data** | `manages_school()` and `can_see_student()` include `super_admin` | **High** — breaks decision §9.2 | Remove super_admin from all child-data helpers; give it school setup tables + aggregate views only. Any "break-glass" access = logged + two people (check with a lawyer) |
| **A9** | District admin of a government school reads **names and grades** | district admins go through `manages_school()` | High — "numbers only" | District/region roles read only aggregate views (counts, averages). Suggest hiding cells with fewer than ~5 students (common practice; exact number is a team decision). **Note:** this contradicts my own v2 test **T8a** — update it. |
| A10 | Teacher creates a lesson card with **school_id of another school** → it appears in that school's window | `school_id` is denormalised and never checked against `class_id` | Medium — breaks "one window" | One trigger for every denormalised `school_id` (lesson_cards, weekly_tests, announcements, problems, absence reports, gate_events): `new.school_id := (select school_id from classes/students …)` |
| A11 | Parent reads **teacher phone** | `profiles` is row-level only; all columns visible | Medium — decision §9.1 (v3 says fixed; test confirms) | `teacher_directory` view with first/last name only; parents get no direct `profiles` access to staff |
| A12 | Parent still sees a **soft-deleted grade** | `grades_select` ignores `deleted_at` | Low–medium | Add `deleted_at is null` for parent/student reads |
| A13 | Zavuch posts an announcement **as the director** | `ann_write` lets managers set any `author_id` | Low | `author_id = auth.uid()` in WITH CHECK (default `auth.uid()`) |
| A14 | User deletes / fakes own AI usage or raises own quota | v2 has no write policy → should already be blocked | Regression | Keep: AI usage written by the server only |
| A15 | `app.ai_check` abuse: student on Standard; teacher checks a school they're not in; unknown feature; **two parallel calls at limit−1 both pass** | v3 only — can't see it | High if open | Default deny; check `member_at(school)`; replace check-then-log with **reserve → call → commit** (row lock on the quota, see doc 07 §5). The race needs a 2-connection test. |

### General hardening (not tests, but please check in v3)
1. **Qualify every column in policy subqueries.** A1 is the second time this bug class appeared. Add a CI lint: any policy subquery column without a table alias fails the build.
2. `grant execute on all functions in schema app to authenticated` also grants **future** functions. Prefer explicit grants, plus `alter default privileges in schema app revoke execute on functions from public`.
3. Every `SECURITY DEFINER` function, **including trigger functions**, should have `set search_path = public, pg_temp`.
4. Students and parents should **write only through RPCs** (absence report, test attempt). Fewer direct-table policies means fewer places to make mistakes.

---

## 2. Section 5: research check (§11.2)

Verdict key: ✅ solid · ⚠️ real but weaker or narrower than the pitch suggests · ❓ uncertain / I could not verify.

| Method | Verdict | What the research says | What I'd change |
|---|---|---|---|
| **Formative assessment** | ⚠️ keep | Black & Wiliam's often-quoted 0.4–0.7 effect is challenged: Kingston & Nash found a weighted mean of about **0.20**, and noted that only 13 of 300+ studies were usable ([Kingston & Nash 2011](https://onlinelibrary.wiley.com/doi/full/10.1111/j.1745-3992.2011.00220.x)). Their own erratum keeps the conclusion at about 0.20 ([erratum](https://onlinelibrary.wiley.com/doi/10.1111/emip.12075)). Critics in turn say that meta-analysis has its own method problems ([Briggs et al., ERIC](https://eric.ed.gov/?id=EJ988994)). | Keep, but **never quote 0.4–0.7**. The benefit comes from the teacher **acting** on the result, so the exit check must change tomorrow's lesson card (and "who to ask first"), not just be stored. ❓ "Finland" as a source: I found no basis. The method comes from UK research (Black & Wiliam). Drop Finland. |
| **Mastery learning** | ⚠️ keep, rename | EEF: about **+5 months** on average, but evidence security is **low**, with large variation. It works best when the bar is high (**80–90%**) ([EEF Toolkit](https://educationendowmentfoundation.org.uk/education-evidence/teaching-learning-toolkit/mastery-learning)). Results tend to be either little/no impact or up to +6 months, so "making mastery learning work effectively is challenging" ([EEF 2014 summary](https://www.teachertoolkit.co.uk/wp-content/uploads/2014/04/eef-eef-mastery-learning-28th-april-2014.pdf)). | A 10-minute review is **mastery-inspired**, not mastery learning: real mastery gives extra time and support until the bar is reached. Suggestion: mark a topic "not mastered" below 80% of the class, and add re-check questions in the next weekly test. ❓ "Singapore": uncertain; cite Bloom / EEF instead. |
| **Spaced repetition / retrieval practice** | ✅ strongest | Practice testing and distributed practice are the **only two of ten techniques rated "high utility"**, across ages and subjects ([Dunlosky et al. 2013](https://journals.sagepub.com/doi/10.1177/1529100612453266)). | Make this the headline method. Keep old-topic questions **low-stakes** (count little or nothing toward the grade). Cheap to build: our own code only, no AI. |
| **Feedback, not only grades** | ✅ with a big caution | EEF rates feedback at about **+6 months** ([EEF](https://educationendowmentfoundation.org.uk/education-evidence/teaching-learning-toolkit/feedback?x-craft-live-preview=4b213607b0ca7298c425ce59b9a512319fffe91f81236c30e002a5b3111b439dsbiglyqmye)). But in Kluger & DeNisi's meta-analysis, **over one-third of feedback interventions made performance worse**; feedback works less well the more it is about the self rather than the task ([Kluger & DeNisi 1996](https://psycnet.apa.org/record/1996-02773-003)). Butler (1988) found **comments alone** beat grades + comments ([Butler, PDF](https://cu-numpde.github.io/fall21/_downloads/90fd21a77254b465ecf26af8b7d81a34/Butler-EnhancingAndUnderminingIntrinsicMotivation-1988.pdf)). However, those grades were ranking-based, and the effect was mainly for low achievers ([Guskey](https://journals.sagepub.com/doi/full/10.1177/00317217221136597)). | Change the design: (1) the comment is **about the task + one next step** ("Check the common denominator"), never about the person ("lazy", "clever"). Give teachers 1-tap comment templates of this kind. (2) **Weekly tests show the comment and the topics, not a grade or a class rank.** (3) **Never show rankings** to students or parents. |
| CPA (Singapore Math) | ❓ | Not verified in this review. Widely used, but I can't cite a strong effect size. | Fine as a design pattern for animations; don't claim it in the pitch. |
| Lesson Study (Japan) | ⚠️ | A large EEF trial found **no evidence of impact** on maths/reading attainment, though teachers valued it ([EEF](https://educationendowmentfoundation.org.uk/projects-and-evaluation/projects/lesson-study)). UCL researchers argue the trial tested a basic version ([IOE blog](https://blogs.ucl.ac.uk/ioe/2017/12/18/lesson-study-new-evaluation-did-not-do-this-valuable-type-of-teacher-development-justice/)). | Keep as the "share the best lesson cards" feature (it saves teachers time). Don't sell it as proven to raise results. |
| Less, better homework (Finland) | ❓ | Not verified. | Keep the homework time limit as a **workload** feature, without the Finland claim. |
| Project-based learning | ❓ later | Not reviewed. | Fine as "later". |

**Add:** **interleaving** (mixing problem types in one test), rated "moderate utility" by [Dunlosky et al.](https://journals.sagepub.com/doi/10.1177/1529100612453266). It is almost free: weekly-test generator option "mix topics".

**Remove or reword in the pitch:** country labels ("Finland", "Singapore", "Japan"). They invite "prove it" questions we can't answer. Suggested pitch: **"Research-backed teaching methods, built into the teacher's day"**, with a one-page source list (the links above). This also fits your own rule "never promise their results".

---

## 3. Section 6: plans, cost saving, limits, pricing (§11.3)

### 3.1 Plan split: sensible, with two changes
- ✅ Standard = teacher AI only; Pro = everyone. This is the right split: teacher AI drives the main promise ("work ends when school ends"), and student and parent AI is where usage can explode.
- **Change 1: pool limits per school, with soft caps per person.** Per-person cents limits waste budget (half the teachers never use theirs) and are hard to explain. Suggestion: a school AI pool per month = f(plan, students). Each person gets a soft cap (e.g. 3× fair share) so one user can't drain the pool.
- **Change 2: show limits in actions, not money.** For example "4 weekly preparations, 8 test generations, 3 exam checks per class per month". Teachers understand actions. Keep money internally in `ai_plan_rules`.
- Pro exam checking must stay **AI suggests**: the AI proposes a mark per answer, and the teacher confirms before anything goes to the gradebook (rule 1).

### 3.2 Cost-saving ideas: all sensible. Additions:
1. **Batch API for weekly preparation**: batch prices are **50% of standard** (e.g. Sonnet 5.5 $1 / $5 per MTok vs $2 / $10) ([Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)). Weekly prep is not urgent, so it fits perfectly.
2. **Prompt caching** is real money: a Sonnet 5.5 cache hit costs $0.10/MTok vs $2 base input ([Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)). Put the curriculum and instructions first in the prompt, so they are cached.
3. **Cheapest model for routing**: Haiku 5.5 at $0.10 / $0.50 per MTok ([Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)) can decide "Library hit or AI needed?" and handle simple tutoring. Use Opus only for reading handwriting in exam photos.
4. **Weekly prep needs no student data at all.** Send class-level topic gaps ("62% mastered fractions"), not students. This matters because a Claude API call is processed **outside Uzbekistan**. Even pseudonymised data ("Student A") may still count as personal data, so **check with a lawyer** before any student text or exam photo with names goes to the API. Crop or blur names on exam photos before sending.

### 3.3 Placeholder limits and cost check (**estimates**)
Token sizes below are my guesses; measure in the pilot.

| Job | Assumption | Model | Est. cost |
|---|---|---|---|
| Weekly lesson prep | 5 class-subjects/teacher, ~10k in (8k cached) + 5k out each, batch | Sonnet 5.5 | **≈ $0.15/teacher/week → ≈ $0.6/month** |
| Weekly test creation | 4/month, ~5k in + 3k out | Sonnet 5.5 batch | ≈ $0.08/month |
| Exam check (Pro) | 30 students × 2 photos ≈ 100k in + 12k out | Opus 5.5 | **≈ $0.65 per class exam** |
| Student tutor (Pro) | 30% of students active, 15 sessions/month, ~4k in + 0.8k out | Sonnet 5.5 / Haiku 5.5 | ≈ $0.07 / $0.004 per enrolled student/month |

Prices from [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing). For a 400-student, 30-teacher school (**estimate**): Standard ≈ $20–40/month and Pro ≈ $50–100/month in AI. The brief's "$300–650 for 10 schools, AI for everyone" (≈ $30–65 per school) is in the same range. With batch + caching it is probably on the high side, which is fine for a placeholder.

### 3.4 Pricing model suggestion (**estimates — test in the pilot**)
Context: Tashkent private schools typically charge **4–8 million UZS per month** ([Goldenpages](https://www.goldenpages.uz/en/rubrics/?Id=101529)). State-programme full-day schools charge about **6.6–7.9 million UZS per month** in 2026/27 ([King's Academy](https://kings.uz/en/articles/private-schools-tashkent-2026-2027-fees-admission/)).

**Yes: per enrolled student per month, billed to the school, 10 billing months (Sep–Jun).**

| | Standard | Pro |
|---|---|---|
| Price per student / month (**hypothesis**) | **15,000 UZS** (≈ $1.25) | **30,000 UZS** (≈ $2.50) |
| Share of a 5M UZS tuition | 0.3% | 0.6% |
| 400-student school / month | 6.0M UZS (≈ $500) | 12.0M UZS (≈ $1,000) |
| Minimum per school | 2M UZS / month (covers onboarding + support for small schools) | same |
| Est. AI cost at that school | ≈ $20–40 | ≈ $50–100 |

Why per student: it scales with the school's own income (tuition is per student), it's one number for the director, and teacher count doesn't change the bill. The AI margin looks wide, but **hosting in Uzbekistan, support, SMS and gate hardware are not in these numbers** (I don't know their costs; please measure).

Extras: annual prepay −10%; exam-checking add-on for Standard, per class-exam pack; gate hardware sold or rented separately. Pilot: offer the pilot school **two price points** for after the trial and see which it accepts. Run the Pro trial **across a quarter-end** (chorak), so we measure report-card-week load and exam checking.

---

## 4. Things I'm unsure about
- Whether v3 already fixes A1–A13 (run `test_v3.sql`).
- Image token count per exam photo (assumed ~1.6k tokens per photo).
- Willingness to pay of Uzbek private schools: no data found; that's what the pilot is for.
- Legal: cross-border processing of children's data by an AI API, and whether private schools must share numbers with the government → **check with a lawyer**.
