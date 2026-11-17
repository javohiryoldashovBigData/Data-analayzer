# 10 — Start building: plan for Javohir + Claude Code + Perplexity

The design is done and tested on PG16 (133 + 35 + 30 scenarios green, race test green). This document turns it into a project. Durations are **estimates** for a small team. Change them freely.

## 1. Who does what

| Person | Owns | Checks |
|---|---|---|
| **Javohir** (product owner) | Pilot school(s), teachers' feedback, lawyer questions, prices, final "yes" on every feature | Every screen with a real teacher before it ships |
| **Claude Code** (builder) | Repo, migrations, RPCs, Edge Functions, PWA, Telegram bot, CI, test runs | Perplexity's SQL and attack tests: runs them and reports what fails |
| **Perplexity** (reviewer, research) | Attack tests, security review, research and prices, legal-question lists | Claude's diffs: reads every migration and policy and tries to break it |

The team rule stays: **nothing is accepted until it is tested**, and whoever finds a problem writes the test that shows it.

## 2. Repo layout

```
maktab-plus/
  supabase/
    migrations/            0001_schema_v3.sql, 0002_api_phase1.sql, 0003_round4_roles.sql,
                           0004_weekly_tests.sql, 0005_curriculum.sql, 0006_quiet_hours.sql …
    seed.sql               test fixtures only (never real people)
    functions/
      _shared/             config, cost, prompt, cards, anthropic, db, http
      ai-weekly-prep/      ai-collect/      outbox-worker/      gate-ingest/
  db/tests/                local_compat.sql, test_rls.sql, test_perplexity.sql, test_api.sql,
                           test_api_race.sh, test_round4.sql, run_all_tests.sh
  app/                     one PWA for every role (teacher / leader / parent / student)
    i18n/uz.json ru.json en.json      (uz Latin is the source; keys, never hardcoded text)
  bot/                     Telegram bot for parents (alerts, digest, absence report)
  scripts/lint_policies.py
  docs/                    01–10
  .github/workflows/ci.yml
```

**One rule for migrations:** never edit an old migration. Add a new one. `db/*.sql` from our rounds becomes numbered migrations once Claude has merged it with v3.

## 3. Environments

| Env | Where | Data |
|---|---|---|
| local | Supabase CLI (Docker) on the developer's machine | seed only |
| staging | self-hosted Supabase, **data center in Uzbekistan** | seed + anonymised copy (no real names) |
| production | self-hosted Supabase, data center in Uzbekistan, a second UZ location for backups | real |

- **Secrets:**
  - `ANTHROPIC_API_KEY`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` and the Telegram token live **only** in Edge Function env.
  - None of them is ever in the app or the repo.
  - The super admin account has no bypass to children's data (decision §9.2), and our tests check that.
- **Self-hosted Edge Functions** default to 150 MB of memory and a 60 s timeout ([Supabase self-hosting docs](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/self-hosting/self-hosted-functions.mdx)). That is why the AI uses Batch + `ai-collect` rather than waiting for the model inside a request.
- **Backups:** nightly full backup + WAL archiving; **test a restore every month** (a backup you never restored is not a backup).
- **Legal (check with a lawyer):** a 2026 amendment narrowed mandatory in-country storage ([lex.uz](https://lex.uz/mact/8104580?ONDATE=27.03.2026%2000)). We still host in Uzbekistan. Questions for the lawyer: database registration, AI prompts without student data, Pro exam photos.

## 4. CI (every push and every pull request)

1. Start `postgres:16`. Run `local_compat → migrations → seed → all test files` with `ON_ERROR_STOP=1`. Any FAIL blocks the merge.
2. Run `test_api_race.sh` (two connections). Exactly one may pass.
3. Run `python3 scripts/lint_policies.py supabase/migrations/*.sql`. It fails on any **unqualified column in a policy** (the A1 bug class).
   - Old v2 files show 94 hits, so run it **strict on new migrations only**. Fix the old ones once, then make it strict everywhere.
4. Run `deno check` and `deno test` for `supabase/functions` (unit tests for `cost.ts` and `cards.ts` with fake model output; no real API calls in CI).
5. Build the PWA and run its i18n check: every key exists in uz/ru/en.
6. **Never** call the real Anthropic API or Telegram from CI.

## 5. Milestones to the pilot (estimate: about 8 weeks)

| Week | Build | Done when (tested) |
|---|---|---|
| 0 | Repo, CI, local + staging, migrations from v3 + round 4 | CI green; staging reachable only through HTTPS |
| 1–2 | **Import** students/teachers/classes/timetable from the school's Excel (the real start of every school); roles; one window per school | A real school's file imports with 0 manual SQL; RLS tests still green |
| 3 | Teacher's day: `my_day`, lesson card, **after lesson** (one call, offline queue), `close_day` | A teacher marks a full day on a weak phone in airplane mode, and everything syncs once |
| 4 | Parents: Telegram bot + PWA; gate in/out (QR/NFC); absence report; grades; **quiet hours + morning digest** | Gate alert arrives in < 1 min; night messages arrive as one digest at 07:00 |
| 5 | Leaders: zavuch/director screens, final grades confirmed by zavuch/director, off-timetable signal, report-card view | The report-card query on full pilot data is fast (see doc 04) |
| 6 | Weekly tests: bank, generator, paper + online mode, per-student order, results, "mastered ≥ 80%" | A test made, taken and scored in one class; review topics come back the next week |
| 7 | AI: weekly prep (Library → Batch), drafts, budget; Pro trial switch | A teacher gets drafts by Monday morning, AI cost is logged, and the limit stops at the cap |
| 8 | **Dry run** with 2–3 teachers, fixes, training in Uzbek, parent consent forms (lawyer) | Teachers use it for 5 school days without calling us |

After week 8, run the pilot itself for 6–8 weeks in 1–2 schools.

**What not to build before the pilot:** payments, admissions, district dashboards, the AI tutor for students, native apps. They are all in the schema, so they can wait.

## 6. Pilot metrics (decide the targets with the school, before the start)

| Metric | How we measure it (own data, no extra tracking) |
|---|---|
| Teacher minutes saved per day | Before/after self-report (2-minute weekly form) + time from first to last "after lesson" call |
| "After lesson" completion rate | Lessons with a `finish_lesson` call ÷ lessons in the timetable |
| Lesson-card use | Cards approved ÷ lessons; share from Library vs AI vs teacher-made |
| AI cost per teacher per month | `ai_usage_log` sum ÷ active teachers (compare with the Anthropic invoice) |
| Parent alert latency | `notifications.created_at − gate_events.created_at`, 95th percentile |
| Work messages after hours | Count of staff messages delivered outside work time (goal: 0 except safety) |
| Retrieval effect (signal only) | Class % correct on review questions over the weeks (not a research claim, just a trend) |
| Parents connected | Parents with an active Telegram/PWA device ÷ students |

**No rankings anywhere**, including teacher dashboards. Metrics are per school or class, never a league table.

## 7. Risks (top 8)

| Risk | What we do |
|---|---|
| Legal: data storage, database registration, consent for children | Host in UZ; lawyer review before real data; consent form in uz/ru |
| Weak internet in classrooms | Offline-first "after lesson" queue with idempotent `client_op_id` (already in the API) |
| Telegram limits / morning burst | Worker throttles to ~25 msg/s; daily digest per parent ([Telegram limits](https://core.telegram.org/bots/faq.md)) |
| SMS cost for parents without Telegram | SMS only for gate/absence alerts; get local SMS provider quotes (**estimate needed**) |
| Teachers don't trust AI drafts | Drafts are optional, the Library comes first, every card needs approval, and teachers can edit everything |
| AI cost overrun | Reserve → commit, monthly caps from `ai_plan_rules`, Batch + cache |
| One person knows the server | Runbook in `docs/`, a second admin account, a monthly restore test |
| Messy school Excel files | The import shows errors per row and never half-imports (one transaction) |

## 8. First day for Claude Code (concrete)

1. Create the repo with the layout above and copy v3 + round-4 files into `supabase/migrations/` in the run order from doc 09.
2. Run `run_all_tests.sh` plus `test_round4.sql` and send back the FAIL list. I expect a few V3-ADAPT renames.
3. Run `deno check supabase/functions/**/*.ts`, then run both functions against the test DB with a **fake Anthropic server** (a small local HTTP server that returns a canned batch + JSONL). No real key is needed for the first test.
4. Set up CI (section 4).
5. Start week 1: the Excel import.

## 9. Open decisions for Javohir

1. 5-day or 6-day week per school? Quiet hours read it from `school_days_off` today; a `days_per_week` column is easy.
2. Morning start for staff messages: 30 min before the first bell (current default) or a fixed time?
3. Do review questions count in the weekly test score?
4. Pilot school(s) and a start date, so the milestones become real dates.
5. Lawyer: the three questions in doc 09, plus the parent consent text.
