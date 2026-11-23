// ============================================================================
// MAKTAB+ AI night worker (step 5)
//
// The ONLY part of Maktab+ that talks to the Claude API. Run it from cron
// (e.g. every 15 minutes overnight) or once by hand:
//     node server/ai-worker.mjs once
// Env: DATABASE_SERVICE_URL (service connection), ANTHROPIC_API_KEY,
//      optional ANTHROPIC_BASE_URL (tests point it at server/fake-anthropic.mjs).
//
// Money rules: every job was RESERVED first (person budget + school's hard
// cap, app.ai_reserve). Here we: 1) queue topic reviews (reserving them in
// the teacher's name), 2) send pending jobs as Message Batches (50% price),
// 3) collect finished batches, store the drafts, COMMIT the real cost or
// RELEASE the reservation. No student names or grades are ever sent.
// ============================================================================
import Anthropic from "@anthropic-ai/sdk";
import pg from "pg";

pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(1082, (v) => v);
const db = new pg.Pool({ connectionString: process.env.DATABASE_SERVICE_URL, max: 3 });
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}) });
const REVIEW_MODEL = "claude-haiku-5-5";            // cheapest model for short topic reviews
const EST_CENTS_PER_REVIEW = 0.3;                    // upper-bound estimate (Haiku, batch)

// US$ per million tokens (Anthropic price list, Nov 2026). Batch = 50%.
// Cache-read/-write multipliers are ESTIMATES — reconcile with the invoice monthly.
const PRICE = {
  "claude-haiku-5-5": { in: 0.10, out: 0.50, cacheRead: 0.01 },
  "claude-sonnet-5-5": { in: 2.00, out: 10.00, cacheRead: 0.10 },
};
function costCents(model, u) {
  const p = PRICE[model] ?? PRICE["claude-sonnet-5-5"];
  const usd = ((u.input_tokens ?? 0) * p.in + (u.cache_creation_input_tokens ?? 0) * p.in * 1.25
             + (u.cache_read_input_tokens ?? 0) * p.cacheRead + (u.output_tokens ?? 0) * p.out) / 1e6;
  return Math.round(usd * 100 * 0.5 * 10000) / 10000;   // batch discount; 4 decimals of a cent
}

// ---- prompts: the stable part first (cached), only the lesson details change --
const PREP_SYSTEM = `Siz O'zbekistondagi maktab o'qituvchisiga 45 daqiqalik dars kartasining QORALAMASINI tayyorlaysiz.
Qoidalar:
- Faqat o'zbek tilida (lotin yozuvi), sodda va aniq yozing.
- Reja 4–6 bosqichdan iborat, har birida daqiqa ko'rsatilsin, jami 45 daqiqa.
- Darsni qisqa takrorlash bilan boshlang (eski mavzudan 1–2 savol — esda saqlashni mustahkamlash).
- Oxirgi 5 daqiqa: aynan 3 ta qisqa "chiqish savoli" (o'qituvchi qo'l ko'tarish orqali tekshiradi; o'quvchilar telefondan foydalanmaydi).
- Uy vazifasi qisqa (20 daqiqadan oshmasin).
- Agar sinf ba'zi mavzularni 80% dan past o'zlashtirgan bo'lsa, rejaga o'sha mavzudan 3–5 daqiqalik takrorlashni qo'shing.
- O'quvchilarning ismlari yoki baholari sizga berilmaydi va ularni hech qachon o'ylab topmang.
- Bu faqat qoralama: o'qituvchi tekshiradi va o'zgartiradi.`;
const PREP_SCHEMA = { type: "object", additionalProperties: false, required: ["plan", "homework", "exit_questions"],
  properties: { plan: { type: "string" }, homework: { type: "string" },
                exit_questions: { type: "array", items: { type: "string" } } } };

const REVIEW_SYSTEM = `Siz o'quvchiga darsda tushunmagan mavzuni uyda qisqa va sodda takrorlashga yordam berasiz.
Qoidalar:
- Faqat o'zbek tilida (lotin yozuvi), sinf darajasiga mos, juda sodda.
- Aniq 5 ta qisqa qadam, 1 ta yechilgan misol, oxirida o'quvchi o'zi yechadigan 1 ta savol (javobini bermang).
- Hech qanday uy vazifasining tayyor javobini bermang. Hech qanday ism ishlatmang.`;
const REVIEW_SCHEMA = { type: "object", additionalProperties: false, required: ["title", "steps", "example", "try_it"],
  properties: { title: { type: "string" }, steps: { type: "array", items: { type: "string" } },
                example: { type: "string" }, try_it: { type: "string" } } };

const params = (model, system, schema, text) => ({
  model, max_tokens: 3000,
  system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
  messages: [{ role: "user", content: text }],
  output_config: { effort: "low", format: { type: "json_schema", schema } },
});
const prepText = (l) => [
  `Fan: ${l.subject}. Sinf: ${l.grade}-sinf. Sana: ${l.date}, ${l.period}-dars.`,
  `Mavzu: ${l.topic}`,
  l.objectives ? `Maqsad: ${l.objectives}` : "",
  l.gaps?.length ? `Sinf o'zlashtirmagan mavzular (sinf bo'yicha foiz): ${l.gaps.map((g) => `${g.topic} — ${g.mastered_pct}%`).join("; ")}` : "",
].filter(Boolean).join("\n");
const reviewText = (p) => `Fan: ${p.subject}. ${p.grade}-sinf. Mavzu: ${p.topic}`;

// ---- validation: never trust model text blindly ------------------------------
const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
function validPrep(o) {
  const plan = str(o?.plan, 2000), homework = str(o?.homework, 300);
  const qs = Array.isArray(o?.exit_questions) ? o.exit_questions.map((x) => str(x, 200)).filter(Boolean).slice(0, 3) : [];
  return plan && qs.length === 3 ? { plan, homework: homework ?? "", exit_questions: qs } : null;
}
function validReview(o) {
  const steps = Array.isArray(o?.steps) ? o.steps.map((x) => str(x, 300)).filter(Boolean).slice(0, 6) : [];
  const title = str(o?.title, 120), example = str(o?.example, 600), tryIt = str(o?.try_it, 300);
  return title && steps.length >= 3 ? { title, steps, example: example ?? "", try_it: tryIt ?? "" } : null;
}
function parseText(message) {
  if (message.stop_reason === "refusal") return null;
  const text = message.content?.find((c) => c.type === "text")?.text;
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

// ---- 1. queue topic reviews (reserved in the teacher's name) -----------------
async function queueReviews() {
  const jobs = (await db.query("select * from app.ai_review_jobs(current_date - 1)")).rows;
  let queued = 0, refused = 0;
  for (const j of jobs) {
    const c = await db.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.current_user_id', $1, true)", [j.teacher_user_id]);
      await c.query("select app.ai_reserve($1, 'topic_review', $2, $3::jsonb)", [j.school_id, EST_CENTS_PER_REVIEW, JSON.stringify({
        kind: "review", model: REVIEW_MODEL, card_id: j.card_id, subject: j.subject, grade: j.grade_level, topic: j.topic })]);
      await c.query("commit"); queued++;
    } catch (e) {
      await c.query("rollback"); refused++;            // budget reached → no AI (Library / teacher instead)
      if (!/budget_reached|limit_reached|plan_not_allowed/.test(e.message)) console.error("review", j.card_id, e.message);
    } finally { c.release(); }
  }
  return { queued, refused };
}

// ---- 2. send pending jobs as batches -----------------------------------------
async function submit() {
  const rows = (await db.query(`select * from ai_reservations where status = 'pending' and batch_id is null
                                and expires_at > now() order by created_at limit 50`)).rows;
  let sent = 0;
  for (const r of rows) {
    const p = r.payload ?? {};
    const requests = p.kind === "prep"
      ? (p.lessons ?? []).map((l, k) => ({ custom_id: `p-${r.id}-${k}`, params: params(p.model, PREP_SYSTEM, PREP_SCHEMA, prepText(l)) }))
      : p.kind === "review" ? [{ custom_id: `r-${r.id}-0`, params: params(p.model, REVIEW_SYSTEM, REVIEW_SCHEMA, reviewText(p)) }] : [];
    if (!requests.length) { await db.query("select app.ai_release($1)", [r.id]); continue; }
    try {
      const batch = await claude.messages.batches.create({ requests });
      await db.query("update ai_reservations set batch_id = $2 where id = $1", [r.id, batch.id]);
      sent++;
    } catch (e) {
      console.error("submit", r.id, e.message);          // nothing billed: free the budget
      await db.query("select app.ai_release($1)", [r.id]);
    }
  }
  return { sent };
}

// ---- 3. collect finished batches ---------------------------------------------
async function collect() {
  const rows = (await db.query(`select * from ai_reservations where status = 'pending' and batch_id is not null`)).rows;
  let committed = 0, released = 0, cards = 0, reviews = 0;
  for (const r of rows) {
   try {
    const batch = await claude.messages.batches.retrieve(r.batch_id);
    if (batch.processing_status !== "ended") continue;
    const p = r.payload; const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const goodCards = []; let goodReview = null;
    for await (const res of await claude.messages.batches.results(r.batch_id)) {
      if (res.result.type !== "succeeded") continue;
      const m = res.result.message;
      for (const k of Object.keys(usage)) usage[k] += m.usage?.[k] ?? 0;
      const idx = Number(res.custom_id.split("-").pop());     // results come in any order: key by custom_id
      const parsed = parseText(m);
      if (p.kind === "prep") {
        const v = validPrep(parsed); const l = p.lessons?.[idx];
        // class, date, period and topic come from OUR reservation, never from the model's text
        if (v && l) goodCards.push({ class_id: l.class_id, subject_id: l.subject_id, date: l.date, period: l.period, topic: l.topic,
                                     plan: v.plan, homework: v.homework, exit_questions: v.exit_questions });
      } else if (p.kind === "review") goodReview = validReview(parsed);
    }
    const billed = usage.input_tokens + usage.output_tokens > 0;
    if (p.kind === "prep" && goodCards.length) cards += (await db.query("select app.ai_store_lesson_cards($1, $2::jsonb) as n", [r.id, JSON.stringify(goodCards)])).rows[0].n;
    if (p.kind === "review" && goodReview && (await db.query("select app.ai_store_topic_review($1, $2::jsonb) as id", [r.id, JSON.stringify(goodReview)])).rows[0].id) reviews++;
    if (billed) {
      await db.query("select app.ai_commit($1, $2, $3, $4, $5)", [r.id, p.model, usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
                                                                   usage.output_tokens, costCents(p.model, usage)]);
      committed++;
      if (p.kind === "prep" && goodCards.length)               // quiet hours apply (not a safety kind)
        await db.query(`insert into notification_outbox (recipient_id, payload) values ($1, jsonb_build_object('kind','system','event','lesson_drafts_ready','count',$2::int))`,
                       [r.user_id, goodCards.length]);
    } else { await db.query("select app.ai_release($1)", [r.id]); released++; }
   } catch (e) { console.error("collect", r.id, e.message); }   // one bad job never blocks the others
  }
  // reservations that never got results within their time window: free the budget
  const expired = (await db.query(`update ai_reservations set status = 'released'
                                   where status = 'pending' and expires_at < now() returning id`)).rowCount;
  return { committed, released: released + expired, cards, reviews };
}

export async function runOnce() {
  const a = await queueReviews(); const b = await submit(); const c = await collect();
  return { reviews_queued: a.queued, reviews_refused: a.refused, ...b, ...c };
}

if (process.argv[2] === "once") {
  runOnce().then((r) => { console.log(JSON.stringify(r)); return db.end(); })
           .catch((e) => { console.error(e); process.exit(1); });
}
