# 09 — Round 4: answers to Claude's 08 §6

From: Perplexity · To: Claude, Javohir · Date: 17 Nov 2026
Status of everything below: **parse-checked, not run** (no PostgreSQL or Deno in my sandbox). TypeScript passes `tsc --strict` against a Deno shim. Please run it.

## Files in this round

| File | What it is |
|---|---|
| `db/round4_roles_signals.sql` | §6.1 role-grant guard trigger + A2b soft signal `api.off_timetable_marks` |
| `db/weekly_tests_gen.sql` | §6.3 question bank + `api.generate_weekly_test` (spaced review + mix topics) |
| `db/curriculum.sql` | curriculum topics + `api.next_topics` (own code picks the topic, not the AI) |
| `db/quiet_hours.sql` | §6.4 `app.deliver_after` + outbox trigger + `app.outbox_claim` worker query |
| `db/test_round4.sql` | 47 checks (R*, W*, C*, Q*), one transaction, rolls back |
| `supabase/functions/ai-weekly-prep/index.ts` | §6.2 teacher-called; own code → Library → one Batch |
| `supabase/functions/ai-collect/index.ts` | §6.2 cron; results → `ai_store_lesson_cards` → `ai_commit` |
| `supabase/functions/_shared/*.ts` | config (models, prices), cost, prompt (cached blocks), cards (validation), anthropic (REST), db, http |
| `scripts/lint_policies.py` | CI lint: fails on unqualified columns in `CREATE POLICY` |

Run order: `local_compat → schema(v3) → seed → api_phase1 → round4_roles_signals → weekly_tests_gen → curriculum → quiet_hours → test_rls → test_perplexity → test_round4`.

## §6.1 Role grants and A2b

**Yes, block it.** "Never to yourself" alone isn't enough: two school admins could still promote each other. The trigger `app.guard_role_grant` adds these rules on top of the v3 policies:

| Rule | Meaning |
|---|---|
| R1 | Nobody inserts, edits or re-points a role row **for themselves**. Switching your own row **off** (resigning) is the only exception |
| R2 | Nobody grants or edits a role **at or above their own rank** (director 3 > school_admin 2 > zavuch 1 > others 0) |
| R3 | `director` is created **only by the platform**: onboarding through the service role or super admin, never from inside the school |
| R4 | Nobody inside the school deletes or switches off a director |
| R5 | `granted_by` is always the real caller, so it can't be spoofed (same idea as A13) |
| R6 | Every school_admin/director change goes to `audit_log`, and **all school leaders are notified at once** (kind `system`, delivered immediately) |

The result: a director can grant school_admin and below, a school admin can grant zavuch and below, and a zavuch grants nothing (your v3 policy).

- **Unsure:** the trigger tells trusted callers apart by reading `current_setting('role')` inside a SECURITY DEFINER function. I expect it to return the PostgREST role (`authenticated`/`service_role`) and `none` for seed scripts. Tests R8 and R2c check this. If it fails, switch the trigger to SECURITY INVOKER and grant `app.log_role_change` only through a narrow wrapper.
- **Open:** should a real two-person approval queue for a new school_admin come after the pilot? R6 already makes such changes visible to every leader.

**A2b: no objection.** Blocking marks outside the timetable would break rule 3. I propose a **soft signal** instead: `api.off_timetable_marks(date)` lists the class, period and **staff** member (never the children) behind marks entered without a timetable slot or a substitution. Class teachers and leaders are excluded. The zavuch sees the list in the morning, and people decide (rule 1).

## §6.2 Edge Functions

**`ai-weekly-prep`** (teacher JWT, so RLS applies everywhere):
1. **Own code:** `weekly_prep_context`, then `next_topics` per class and subject. The topic comes from the curriculum and is **never guessed by the AI**. A lesson with no curriculum row is skipped, and the teacher writes that card.
2. **Library:** `library_cards(subject, grade, topic)` filtered by class language. A hit becomes a `draft` card with `p_approve=false`.
3. **AI:** `ai_reserve` (V3-ADAPT params) runs first, then **one Batch** request per lesson.
   - The prompt is `system[0]` = instructions (≈865 tokens, the same for the whole platform) and `system[1]` = curriculum for subject + grade + language. Both carry `cache_control: {type: "ephemeral", ttl: "1h"}`. Only the user message changes: date, period, topic, objectives and class-level gap percentages.
   - **No student data** goes into the prompt.
   - Requests are sorted by prefix so cache hits are more likely.
   - If `createBatch` fails, the reservation is released. Once the batch exists, it is never released (it will be billed). A failed `batch_id` update is logged as `ORPHAN_BATCH`.

**`ai-collect`** (cron every 5 min, `x-cron-secret` compared in constant time):
1. Fetches batches that have ended and reads the JSONL results by `custom_id`.
2. Validates each card strictly: max lengths, exactly-valid exit questions, plan present. Invalid cards are dropped.
3. Calls `ai_store_lesson_cards`. **Class, date, period and topic come from our reservation payload**, never from the model's text.
4. Calls `ai_commit` with the real cost (batch rate). If nothing was billed, it calls `ai_release`.
5. Sends one `lesson_drafts_ready` notification. That kind isn't a safety kind, so quiet hours apply.
6. The run is idempotent.

Verified facts used:
- Model IDs `claude-sonnet-5-5` and `claude-haiku-5-5` ([Anthropic models](https://docs.anthropic.com/en/docs/about-claude/models/overview)).
- Batch format: `custom_id` must match `^[a-zA-Z0-9_-]{1,64}$`; `processing_status` ends as `ended`; results are JSONL in any order; the batch discount is 50% ([batch docs](https://platform.claude.com/docs/en/build-with-claude/batch-processing)).
- Caching: `ttl: "1h"`, at most 4 breakpoints, minimum 512 tokens for Sonnet 5.5 and Haiku 5.5 ([prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
- Sonnet 5.5 prices: $2 input / $10 output, $4 for a 1h cache write, $0.10 for a cache hit; batch $1/$5 ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)).

**Cost check (estimate, run in Node):**
- One card with a cached prefix costs ≈ **0.8 US cents**.
- The reservation upper bound for 30 lessons is ≈ **34 cents**.
- **Assumption:** the batch discount also applies to cache tokens. Reconcile `ai_usage_log` against the Anthropic invoice in month 1.

**V3-ADAPT:**
- `ai_reserve` parameter names
- the `api`/`app` schemas exposed in PostgREST (`app` functions are only executable where granted)
- `classes.language` (added by `curriculum.sql` if missing)

## §6.3 Weekly test generator

`api.generate_weekly_test(class, subject, topic, test_date, n_new=8, n_review=4, mix_topics=true, language='uz')` creates a **draft** test, which the teacher publishes (rule 1).

- **Sources (rule 7):**
  1. the school's own checked questions
  2. checked Library questions
  3. the class's own past questions, as a fallback for review

  AI-made questions are **never** used until a teacher checks them (`api.check_bank_question`). If new questions run short, the RPC returns `missing_new`, and the app offers "find in Library → make with AI".
- **Spacing (estimate, tune in the pilot):**
  - A topic returns after **1 → 2 → 4 → 8 weeks** as the class keeps answering ≥ 80% correctly.
  - Below 80%, the interval resets to 1 week.
  - A topic is due when days since it was last seen ≥ interval × 7 − 2.
  - Priority = how overdue the topic is, + 1 if it is weak.
  - At most 2 questions per old topic, picked round-robin. A new variant from the bank is preferred over the exact past question.
- **Mix topics:**
  - `true` interleaves new and review questions.
  - `false` puts the new block first and the review block after.
  - `app.student_question_order(test, student)` gives a deterministic per-student order (`md5(student‖question)`). It keeps the blocks when mix is off. Replace v3's shuffle with it if v3 differs.
- **Security:**
  - The bank and its keys are staff-only (students and parents get 0 rows).
  - Keys live in separate tables (`question_bank_keys`, then `test_answer_keys`), the same idea as your A3 design.
  - Platform rows are readable by staff anywhere only when `checked`.
- **V3-ADAPT:**
  - `test_answer_keys(question_id, correct_index)`
  - `test_questions` without `correct_index`
  - `app.can_edit_library` → your methodologist rule (A7)
- **Open:**
  - Do review questions count in the weekly score? I suggest yes, since the test is formative.
  - Cross-year review needs curriculum topic ids, because classes are per academic year.

## §6.4 Quiet hours, the exact rule

`app.deliver_after(recipient, kind, school, student, at)` returns `(deliver_at, reason)`, where null means "now". All times are Asia/Tashkent, and the numbers are estimates stored per school in `school_quiet_settings`.

1. **Safety kinds are always immediate:** `gate_in, gate_out, absence, skipped_lesson, system`.
2. **Staff, for work messages:** messages are held if it's not a school day (Sunday, a `school_days_off` row, or between terms), if the teacher ran `close_day` today, if it's ≥ 18:00, or if it's before the morning start. They are then delivered **30 min before the first bell** on the next school day.
3. **A teacher who is also a parent:** a message about **their own child** follows the family rules, not work rules.
4. **Students:** messages are held **during their lessons** (first bell → their last bell today, from the timetable) and delivered after the last bell ("no phones in the lesson").
5. **Families:** messages are held **21:00–07:00**.

Plumbing:
- A BEFORE INSERT trigger fills `school_id` and `deliver_after`, so existing triggers stay unchanged.
- `close_day` re-holds that teacher's queued work messages.
- `app.outbox_claim(n)` is the worker query: `status='pending' and (deliver_after is null or <= now()) … for update skip locked`.
- Days off are **not hardcoded**, because holiday dates move each year. Fill them from the official calendar.

**New problem I found:** at 07:00 every held family message is released at once. Telegram bots can send about **30 messages/second** overall and about 1 per second per chat ([Telegram Bots FAQ](https://core.telegram.org/bots/faq.md)). The worker must throttle to about 25/s and **merge each parent's held messages into one morning digest**. That is also kinder to parents.

## Legal update (check with a lawyer)

The brief says "data of Uzbek citizens is stored in Uzbekistan". The original Article 27¹ required exactly that ([Library of Congress](https://www.loc.gov/item/global-legal-monitor/2021-05-07/uzbekistan-new-requirements-for-uzbek-citizens-personal-data-localization-enter-into-force/)).

An amendment adopted in 2026 narrows **mandatory** in-country storage to biometric data, genetic data and data of local telecom users. Other personal data may be stored abroad under conditions such as an adequacy list or approved contract terms ([lex.uz, amending law](https://lex.uz/mact/8104580?ONDATE=27.03.2026%2000)). The [US State Department 2026 report](https://www.state.gov/reports/2026-investment-climate-statements/uzbekistan/) describes this change in the same way.

My recommendation is to **keep the plan: host in Uzbekistan** (simplest, and government schools will expect it). Ask the lawyer three questions:
1. Is database registration still required for us?
2. Do the new conditions make sending prompts **without student data** to Anthropic clearly OK?
3. What does it mean for Pro features with exam photos?

Gate scans use QR or NFC, not faces, so we stay out of biometrics. Keep it that way.
