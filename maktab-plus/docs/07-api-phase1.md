# 07 — Phase 1 server API: the teacher's day

Status: **DRAFT for team check** · SQL: `db/api_phase1.sql` (parse-checked, not run) · Built on v2 table names + v3 `app.ai_check`.

## 1. Decision: almost no server code

| Option | Verdict |
|---|---|
| Every screen through a Node.js/Edge server | ✗ More code, and permission logic would drift into TypeScript |
| **Client → PostgREST RPC (`schema api`) with the user's JWT** | ✅ for "My day", the lesson card, after lesson, and "Finished for today" |
| **Supabase Edge Functions** (Deno, TypeScript) | ✅ only where a secret is needed: **AI calls** |
| Long-running Node worker | Only if Edge Functions prove too limited. Self-hosted defaults are 150 MB / 60 s per invocation, and you can change them ([Supabase self-hosting docs](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/self-hosting/self-hosted-functions.mdx)) |

Why: the `api.*` functions are **SECURITY INVOKER**, so every query inside them still goes through the RLS policies. The database stays the only place where permissions live (brief §11.4). The Edge Function never uses the service key to *read* school data; it calls the RPCs **with the teacher's JWT**. The service key is used for exactly three things: `ai_commit`, `ai_release` and `ai_store_lesson_cards`.

```
React PWA ──JWT──► PostgREST /rpc/api.*  ──► Postgres (RLS)          [4 of 5 screens]
React PWA ──JWT──► Edge fn /ai/weekly-prep
                     ├─JWT─► rpc api.weekly_prep_context / api.library_cards / app.ai_reserve
                     ├─────► Claude Message Batches API  (no student data)
cron (5 min) ──────► Edge fn /ai/collect
                     └─service key─► app.ai_store_lesson_cards + app.ai_commit
```

## 2. Endpoints

| # | Screen | Call | Notes |
|---|---|---|---|
| 1 | **My day** | `GET /rest/v1/rpc/my_day?p_date=…` | One round trip: lessons (timetable − substitutions away + substitutions in), bell times, card status, attendance done, lesson done, **who to ask first** (top 3, our own code), pending absence reports for the homeroom class, closed? |
| 2a | Lesson card | `POST /rpc/open_lesson_card {class, subject, date, period}` | Get or create draft; returns card + exit check + ask-first |
| 2b | Edit / approve | `POST /rpc/save_lesson_card {card_id, patch, approve}` | Approving an `ai_draft` sets `approved_by`: **AI suggests, people decide** |
| 2c | Exit check questions | inside `save_lesson_card` patch: `exit_questions: [q1,q2,q3]` | Recorded **by the teacher** (show of hands): rule 2, no student phones |
| 3 | **After lesson** (1–2 min) | `POST /rpc/finish_lesson {card_id, p}` | **One transaction**: attendance for the whole roster (send only absent/late), topic, homework, quick grades + "next step" comment, exit-check counts and optional "didn't get it" taps, private note. **Idempotent** via `client_op_id` → safe to retry from the offline queue |
| 4a | **Finished for today** | `GET /rpc/day_checklist?p_date=…` | attendance / topic / after-lesson per lesson + "tomorrow's cards ready" |
| 4b | Close day | `POST /rpc/close_day {p_date}` | **Never blocks** (rule 3): open items are carried over to tomorrow morning. Starts quiet hours for the outbox worker |
| 5 | **Weekly preparation** | `POST /functions/v1/ai-weekly-prep {week_start}` | Library first → `ai_reserve` → Claude Batch → drafts appear as `ai_draft` cards |

Error contract (SQL `raise … hint`): `card_not_found_or_denied` (42501), `plan_not_allowed` / `limit_reached` (P0001, hint `try_library`). The UI maps `try_library` to **"Limit reached, try the Library"**.

## 3. "After lesson" payload

```json
{
  "client_op_id": "1b0c…",            // generated on the tablet, stored in IndexedDB queue
  "absent": ["eeee…a002"], "late": [],
  "topic": "Kasrlarni qo'shish",
  "homework": {"description": "45-bet, 1–4", "due_date": "2026-11-18"},
  "grades": [{"student_id": "eeee…a001", "value": 4,
              "comment": "Keyingi qadam: umumiy maxrajni tekshiring"}],
  "exit": {"results": [{"q":1,"got_it":21,"total":27}], "not_got": ["eeee…a002"]},
  "note": "private"
}
```
Comment templates are **task + next step** (see doc 06 §2: feedback about the person can hurt). The exit check's `not_got` feeds tomorrow's "who to ask first" (+3).

## 4. Weekly preparation flow (Edge Function sketch)

```ts
// supabase/functions/ai-weekly-prep/index.ts  (Deno)  — sketch, not tested
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

Deno.serve(async (req) => {
  const jwt = req.headers.get("Authorization")!;               // teacher's JWT
  const db  = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
                           { global: { headers: { Authorization: jwt } } });   // RLS applies
  const { week_start, school_id } = await req.json();

  // 1. Context (RLS-filtered; no student names — only class-level gaps)
  const { data: ctx, error } = await db.rpc("weekly_prep_context", { p_week_start: week_start });
  if (error) return json(403, error);
  const todo = ctx.lessons.filter((l: any) => !l.has_card);

  // 2. Library first (rule 7): reuse checked cards, no AI cost
  const needAI = [];
  for (const l of todo) {
    const { data: lib } = await db.rpc("library_cards",
      { p_subject_id: l.subject_id, p_grade_level: l.grade_level });
    lib?.length ? await useLibraryCard(db, l, lib[0]) : needAI.push(l);
  }
  if (!needAI.length) return json(200, { from_library: todo.length, ai: 0 });

  // 3. Reserve budget in the DB (ai_check + limit + race-safe lock)
  const est = estimateCents(needAI);                            // estimate, see doc 06 §3.3
  const { data: resId, error: rErr } = await db.rpc("ai_reserve",
    { p_school_id: school_id, p_feature: "lesson_prep", p_est_cents: est, p_payload: { needAI } });
  if (rErr) return json(402, { code: rErr.message, hint: "try_library" });

  // 4. One batch request per class-subject; curriculum + instructions first → cached
  const claude = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
  const batch = await claude.messages.batches.create({ requests: buildRequests(needAI, ctx.gaps, resId) });
  await serviceDb().from("ai_reservations").update({ batch_id: batch.id }).eq("id", resId);
  return json(202, { reservation: resId, from_library: todo.length - needAI.length, ai: needAI.length });
});
```

`ai-collect` (cron every 5 min, service key): for each pending reservation with a `batch_id`, it fetches the results when the batch has ended. It then calls `app.ai_store_lesson_cards(res, cards)`, which re-checks that the reservation's teacher teaches each class/subject and inserts `status='ai_draft'`. Next it calls `app.ai_commit(res, model, tokens_in, tokens_out, cost)`. On failure or expiry it calls `app.ai_release(res)`.

Facts behind the choice ([Anthropic batch docs](https://platform.claude.com/docs/en/build-with-claude/batch-processing)):
- batches cost **50%** of standard prices;
- most finish in **under 1 hour**, and they expire at **24 h** (hence the 26 h reservation expiry);
- prompt caching stacks with the batch discount, and a 1-hour cache is recommended.

Suggested schedule: run on **Saturday after classes, or Sunday evening**, so drafts are waiting on Monday morning. Don't show the notification until the teacher's next working hours (rule 3).

## 5. Why reserve → commit instead of check → log
The brief's flow, "call `app.ai_check` → call AI → log usage", has a **race**: two requests at limit−1 both pass the check. `app.ai_reserve` takes a per-(school, user) advisory lock and counts **used + pending reservations** before inserting a reservation. This is attack A15d in `test_v3.sql`, and it needs a 2-connection test. `app.ai_limit_cents` is a **placeholder** to wire to v3 `ai_plan_rules`.

## 6. Quiet hours ("work ends when school ends")
The outbox worker holds non-urgent teacher notifications (parent messages forwarded by the office, AI drafts ready, problem updates) when **either** the teacher has run `close_day` today **or** it's after 18:00 local time. It delivers them at the next school-day start. Urgent ones (gate alerts are for parents, not teachers) are unaffected. Exact rule: team decision.

## 7. Performance (Phase 1)
- `my_day` = 1 call. Expected cost is a few index lookups per lesson (≤ 9 lessons). Needed indexes: `timetable_slots(teacher_id, day_of_week)`, `substitutions(substitute_teacher_id, date)`, `lesson_cards(class_id, lesson_date, period)` (make it **unique**: one card per lesson). The `attendance_logs(class_id, date, period)` index already exists via the partition key; please confirm in v3.
- `ask_first` runs per lesson inside `my_day`. With ~30 students that is fine (**estimate**). If it shows up in profiling, precompute nightly into a table.
- `finish_lesson` is one transaction of ~30 attendance rows + a few inserts. The offline queue sends it once.

## 8. Tests to add before this is accepted
1. Teacher B calls `finish_lesson` on teacher A's card → `card_not_found_or_denied`.
2. Same `client_op_id` sent twice → one set of rows, same result.
3. `finish_lesson` with an `absent` id from another class → the student is ignored (only the roster is written).
4. Parent/student calls `my_day` → empty lessons (no teacher id).
5. `ai_reserve` on a Standard school by a student → `plan_not_allowed`. At limit → `limit_reached`. Two parallel sessions → only one passes.
6. `ai_store_lesson_cards` with a class the teacher doesn't teach → 0 cards.
7. `close_day` with open items → succeeds, items listed, no block.

## 9. Assumptions / unsure
- The v3 names of `ai_plan_rules` and the `app.ai_check` signature are taken from the brief (`ai_check(school, feature)`); not seen.
- One school per teacher (brief §10.2). `ai_store_lesson_cards` uses `teachers.school_id = reservation.school_id`.
- Self-hosted Edge Runtime limits as documented; verify on your server.
- Sending lesson-prep prompts to the Claude API means processing outside Uzbekistan. Prompts contain **no student data** by design, but **check with a lawyer** for exam photos and student tutoring (Pro).
