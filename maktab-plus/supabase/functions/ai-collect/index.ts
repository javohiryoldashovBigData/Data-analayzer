// POST /functions/v1/ai-collect      (cron every 5 min; header x-cron-secret)
// Service role. For each pending lesson_prep reservation with a batch_id:
//   batch not ended → skip
//   ended → read JSONL results → validate → app.ai_store_lesson_cards
//           (re-checks the teacher teaches each class/subject; inserts 'ai_draft')
//         → app.ai_commit(real cost)  or  app.ai_release (nothing succeeded, nothing billed)
//         → one quiet-hours-aware notification to the teacher ("drafts ready")
// Idempotent: storing skips existing cards; a second commit fails harmlessly.
// Class ids, dates and periods come from OUR reservation payload, never from
// the model's text (the model only fills content).
// STATUS: NOT RUN (no Deno here). V3-ADAPT: app.* function params.

import { json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/db.ts";
import { getBatch, getResults } from "../_shared/anthropic.ts";
import { costCents, type Usage } from "../_shared/cost.ts";
import { parseCard, planText } from "../_shared/cards.ts";

interface MapRow {
  cid: string; class_id: string; subject_id: number; date: string;
  period: number; topic: string; language: "uz" | "ru" | "en";
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET") ?? "";
  if (!secret || !safeEqual(req.headers.get("x-cron-secret") ?? "", secret)) {
    return json(401, { code: "unauthorized" });
  }
  const svc = serviceClient();
  const app = svc.schema("app");

  const { data: pending, error } = await svc.from("ai_reservations")
    .select("id, user_id, school_id, batch_id, payload, expires_at")
    .eq("status", "pending").eq("feature", "lesson_prep").not("batch_id", "is", null)
    .order("created_at").limit(25);
  if (error) return json(500, { code: "db_error" });

  const report: Array<Record<string, unknown>> = [];
  for (const r of pending ?? []) {
    try {
      const batch = await getBatch(r.batch_id);
      if (batch.processing_status !== "ended" || !batch.results_url) {
        report.push({ id: r.id, status: batch.processing_status });
        continue;
      }
      const lines = await getResults(batch.results_url);
      const map = new Map<string, MapRow>((r.payload?.lessons ?? []).map((m: MapRow) => [m.cid, m]));

      let cents = 0, tokIn = 0, tokOut = 0, model = r.payload?.model ?? "claude-sonnet-5-5";
      let failed = 0;
      const cards: Record<string, unknown>[] = [];
      for (const line of lines) {
        const m = map.get(line.custom_id);
        if (!m) continue;                               // not ours → ignore
        if (line.result.type !== "succeeded" || !line.result.message) { failed++; continue; }
        const msg = line.result.message;
        const u = msg.usage as Usage;
        model = msg.model ?? model;
        cents += costCents(model, u, true);             // billed even if the card is unusable
        tokIn += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        tokOut += u.output_tokens ?? 0;

        const text = msg.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
        const card = parseCard(text);
        if (!card) { failed++; continue; }
        cards.push({
          class_id: m.class_id, subject_id: m.subject_id, date: m.date, period: m.period,
          topic: m.topic,                                // the PROGRAMME topic, not the model's rewrite
          plan: planText(card, m.language),
          questions: {
            retrieval: card.retrieval_questions, check: card.check_questions, mix_item: card.mix_item,
            feedback_templates: card.feedback_templates, materials: card.materials,
            notes_for_teacher: card.notes_for_teacher, objective: card.objective,
          },
          homework: card.homework,
          exit_questions: card.exit_questions,
        });
      }

      let stored = 0;
      if (cards.length) {
        const { data: n, error: sErr } = await app.rpc("ai_store_lesson_cards", { p_res_id: r.id, p_cards: cards });
        if (sErr) throw new Error(`store_failed:${sErr.message}`);
        stored = n ?? 0;
      }

      if (cents > 0) {
        const { error: cErr } = await app.rpc("ai_commit", {
          p_res_id: r.id, p_model: model, p_tokens_in: tokIn, p_tokens_out: tokOut,
          p_cost_cents: Math.round(cents * 100) / 100,
        });
        if (cErr && !/reservation_not_pending/.test(cErr.message)) throw new Error(`commit_failed:${cErr.message}`);
      } else {
        await app.rpc("ai_release", { p_res_id: r.id });
      }

      if (stored > 0) {
        // kind is not a safety kind → quiet_hours.sql holds it after close_day / 18:00
        await svc.from("notification_outbox").insert({
          recipient_id: r.user_id,
          payload: { kind: "lesson_drafts_ready", school_id: r.school_id, count: stored,
                     week_start: r.payload?.week_start },
        });
      }
      report.push({ id: r.id, stored, failed, cents: Math.round(cents * 100) / 100 });
    } catch (e) {
      // Leave it pending; next run retries. After expires_at the budget no longer
      // counts it (ai_reserve ignores expired), so a stuck batch never blocks a teacher.
      console.error("ai-collect", r.id, String(e).slice(0, 300));
      report.push({ id: r.id, error: String(e).slice(0, 120) });
    }
  }
  return json(200, { checked: (pending ?? []).length, report });
});
