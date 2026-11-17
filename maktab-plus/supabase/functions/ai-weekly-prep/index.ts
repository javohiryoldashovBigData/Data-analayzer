// POST /functions/v1/ai-weekly-prep   { "week_start": "2026-11-23" }
// Caller: a teacher (their JWT). Order of work (rule 7):
//   1. own code   — which lessons have no card yet, which topic comes next
//   2. Library    — reuse a CHECKED lesson card for that topic (free)
//   3. AI         — only for the rest, as ONE Batch (50% price), prompt prefix cached
// Result: drafts appear later as lesson_cards.status = 'ai_draft' (ai-collect).
// The teacher reviews and approves each card (rule 1).
// STATUS: written against api_phase1.sql + round-4 SQL. NOT RUN (no Deno in the
// reviewer's sandbox). V3-ADAPT: RPC names/params of Claude's v3 api_phase1.

import { json, cors, pgError } from "../_shared/http.ts";
import { userClient, serviceClient } from "../_shared/db.ts";
import { LIMITS, MODELS } from "../_shared/config.ts";
import { estimateCents } from "../_shared/cost.ts";
import { createBatch, type BatchRequest } from "../_shared/anthropic.ts";
import { curriculumBlock, lessonParams, type Lang, type CurriculumRow } from "../_shared/prompt.ts";

interface Lesson {
  class_id: string; grade_level: number; subject_id: number;
  date: string; period: number; has_card: boolean;
}
interface Gap { class_id: string; subject_id: number; topic: string; mastered_pct: number }
interface Planned extends Lesson { topic: string; objectives: string | null; language: Lang }

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { code: "method_not_allowed" });

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json(401, { code: "not_authenticated" });

  let body: { week_start?: string };
  try { body = await req.json(); } catch { return json(400, { code: "bad_json" }); }
  const weekStart = body.week_start;
  if (!weekStart || !isoDate.test(weekStart) || new Date(weekStart + "T00:00:00Z").getUTCDay() !== 1) {
    return json(400, { code: "week_start_must_be_monday" });
  }

  const db = userClient(auth);          // everything below runs AS the teacher (RLS)
  const api = db.schema("api");
  const app = db.schema("app");

  const { data: me, error: meErr } = await db.auth.getUser();
  if (meErr || !me?.user) return json(401, { code: "not_authenticated" });

  // school is derived, never taken from the client (attack A10)
  const { data: teacher, error: tErr } = await db.from("teachers")
    .select("id, school_id").eq("user_id", me.user.id).maybeSingle();
  if (tErr) return pgError(tErr);
  if (!teacher) return json(403, { code: "not_a_teacher" });

  // ---- 1. own code: what is missing this week? -----------------------------
  const { data: ctx, error: cErr } = await api.rpc("weekly_prep_context", { p_week_start: weekStart });
  if (cErr) return pgError(cErr);
  const lessons: Lesson[] = (ctx?.lessons ?? []).filter((l: Lesson) => !l.has_card)
    .slice(0, LIMITS.maxLessonsPerRun);
  const gaps: Gap[] = ctx?.gaps ?? [];
  if (!lessons.length) return json(200, { from_library: 0, ai: 0, nothing_to_do: true });

  // class languages (uz / ru / en sections)
  const classIds = [...new Set(lessons.map((l) => l.class_id))];
  const { data: classes, error: clErr } = await db.from("classes")
    .select("id, language").in("id", classIds);
  if (clErr) return pgError(clErr);
  const langOf = new Map<string, Lang>((classes ?? []).map((c: any) => [c.id, (c.language ?? "uz") as Lang]));

  // next topics per class+subject, assigned in date/period order
  const groups = new Map<string, Lesson[]>();
  for (const l of lessons) {
    const k = `${l.class_id}|${l.subject_id}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const planned: Planned[] = [];
  for (const [k, ls] of groups) {
    const [classId, subjectId] = k.split("|");
    ls.sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period);
    const { data: topics, error } = await api.rpc("next_topics",
      { p_class_id: classId, p_subject_id: Number(subjectId), p_n: ls.length });
    if (error) return pgError(error);
    ls.forEach((l, i) => {
      const t = topics?.[i];
      if (t) planned.push({ ...l, topic: t.topic, objectives: t.objectives, language: langOf.get(l.class_id) ?? "uz" });
      // no curriculum row → skip: the teacher writes this one (we never let the AI guess the programme)
    });
  }

  // ---- 2. Library first ------------------------------------------------------
  const needAI: Planned[] = [];
  let fromLibrary = 0;
  for (const l of planned) {
    const { data: lib, error } = await api.rpc("library_cards",
      { p_subject_id: l.subject_id, p_grade_level: l.grade_level, p_topic: l.topic });
    if (error) return pgError(error);
    const hit = (lib ?? []).find((x: any) => (x.language ?? "uz") === l.language);
    if (!hit) { needAI.push(l); continue; }
    const { data: opened, error: oErr } = await api.rpc("open_lesson_card", {
      p_class_id: l.class_id, p_subject_id: l.subject_id, p_date: l.date, p_period: l.period,
    });
    if (oErr) return pgError(oErr);
    const c = hit.content ?? {};
    const { error: sErr } = await api.rpc("save_lesson_card", {
      p_card_id: opened.card.id,
      p_patch: {
        topic: l.topic, plan: c.plan ?? hit.description ?? "", questions: c.questions ?? null,
        homework: c.homework ?? null, materials: [hit.id], exit_questions: c.exit_questions ?? undefined,
      },
      p_approve: false,                       // still the teacher's decision
    });
    if (sErr) return pgError(sErr);
    fromLibrary++;
  }
  if (!needAI.length) return json(200, { from_library: fromLibrary, ai: 0 });

  // ---- 3. AI, as one batch ----------------------------------------------------
  // Reserve budget first (lock → ai_check → monthly limit − pending), V3-ADAPT params.
  const est = estimateCents(MODELS.prep, needAI.length);
  const mapping = needAI.map((l, i) => ({
    cid: `L${i}`, class_id: l.class_id, subject_id: l.subject_id, date: l.date,
    period: l.period, topic: l.topic, language: l.language,
  }));
  const { data: resId, error: rErr } = await app.rpc("ai_reserve", {
    p_school_id: teacher.school_id, p_feature: "lesson_prep", p_est_cents: est,
    p_payload: { week_start: weekStart, model: MODELS.prep, lessons: mapping },
  });
  if (rErr) return pgError(rErr);     // 402 limit_reached / plan_not_allowed → app says "try Library"

  // subject names + curriculum blocks (one per subject+grade+language → shared cache prefix)
  const { data: subjects } = await db.from("subjects").select("id, name_uz, name_ru");
  const subjName = (id: number, lang: Lang) => {
    const s = (subjects ?? []).find((x: any) => x.id === id);
    return s ? (lang === "ru" ? s.name_ru : s.name_uz) : `subject ${id}`;
  };
  const curCache = new Map<string, string>();
  async function curriculum(l: Planned): Promise<string> {
    const k = `${l.subject_id}|${l.grade_level}|${l.language}`;
    if (!curCache.has(k)) {
      const { data } = await api.rpc("curriculum_for",
        { p_subject_id: l.subject_id, p_grade_level: l.grade_level, p_language: l.language });
      curCache.set(k, curriculumBlock(subjName(l.subject_id, l.language), l.grade_level, l.language,
                                      (data ?? []) as CurriculumRow[]));
    }
    return curCache.get(k)!;
  }

  // Sort so requests with the same prefix are next to each other (cache is best-effort in batches).
  const order = needAI.map((l, i) => ({ l, i }))
    .sort((a, b) => a.l.subject_id - b.l.subject_id || a.l.grade_level - b.l.grade_level ||
                    a.l.language.localeCompare(b.l.language));
  const requests: BatchRequest[] = [];
  for (const { l, i } of order) {
    const classGaps = gaps.filter((g) => g.class_id === l.class_id && g.subject_id === l.subject_id)
      .map((g) => ({ topic: g.topic, mastered_pct: g.mastered_pct }));      // numbers only
    requests.push({
      custom_id: mapping[i].cid,
      params: lessonParams(MODELS.prep, LIMITS.maxOutputTokensPerCard, await curriculum(l), l.language, {
        date: l.date, period: l.period, topic: l.topic, objectives: l.objectives, gaps: classGaps,
      }),
    });
  }

  const svc = serviceClient();
  let batch;
  try {
    batch = await createBatch(requests);
  } catch (e) {
    await svc.schema("app").rpc("ai_release", { p_res_id: resId });   // nothing sent → money back
    console.error("ai-weekly-prep createBatch failed", String(e).slice(0, 300));
    return json(502, { code: "ai_unavailable", hint: "try_library", from_library: fromLibrary });
  }
  // The batch exists and WILL be billed: never release the reservation from here on.
  const { error: uErr } = await svc.from("ai_reservations")
    .update({ batch_id: batch.id }).eq("id", resId).eq("status", "pending");
  if (uErr) {
    // ai-collect cannot find it without batch_id → log loudly for the on-call fix (rare).
    console.error("ORPHAN_BATCH", JSON.stringify({ reservation: resId, batch_id: batch.id }));
  }
  return json(202, { reservation: resId, from_library: fromLibrary, ai: needAI.length,
                     est_cents: est, batch_status: batch.processing_status });
});
