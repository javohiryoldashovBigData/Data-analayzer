// Parse + validate the model's JSON. Anything invalid is dropped (the teacher
// simply gets an empty card for that lesson — never a broken one).

export interface ModelCard {
  topic: string;
  objective: string;
  plan: Array<{ minutes: number; step: string; teacher: string; students: string }>;
  retrieval_questions: string[];
  check_questions: string[];
  mix_item: string;
  exit_questions: Array<{ q: string; options: string[]; correct_index: number }>;
  feedback_templates: string[];
  homework: string;
  if_not_mastered: string;
  materials: string[];
  notes_for_teacher: string;
}

const s = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const sa = (v: unknown, n: number, max = 500) =>
  Array.isArray(v) ? v.map((x) => s(x, max)).filter(Boolean).slice(0, n) : [];

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no_json");
  return JSON.parse(text.slice(start, end + 1));
}

export function parseCard(text: string): ModelCard | null {
  let o: Record<string, unknown>;
  try { o = extractJson(text) as Record<string, unknown>; } catch { return null; }
  if (!o || typeof o !== "object") return null;

  const plan = Array.isArray(o.plan)
    ? o.plan.slice(0, 12).map((p: any) => ({
      minutes: Math.max(1, Math.min(45, Math.round(Number(p?.minutes) || 0))),
      step: s(p?.step, 120), teacher: s(p?.teacher, 600), students: s(p?.students, 600),
    })).filter((p) => p.step)
    : [];
  const exits = Array.isArray(o.exit_questions)
    ? o.exit_questions.map((e: any) => ({
      q: s(e?.q, 400), options: sa(e?.options, 4, 200), correct_index: Number(e?.correct_index),
    })).filter((e) =>
      e.q && e.options.length >= 2 && Number.isInteger(e.correct_index) &&
      e.correct_index >= 0 && e.correct_index < e.options.length
    ).slice(0, 3)
    : [];

  const card: ModelCard = {
    topic: s(o.topic, 200),
    objective: s(o.objective, 400),
    plan,
    retrieval_questions: sa(o.retrieval_questions, 3),
    check_questions: sa(o.check_questions, 3),
    mix_item: s(o.mix_item, 500),
    exit_questions: exits,
    feedback_templates: sa(o.feedback_templates, 3, 200),
    homework: s(o.homework, 800),
    if_not_mastered: s(o.if_not_mastered, 500),
    materials: sa(o.materials, 6, 200),
    notes_for_teacher: s(o.notes_for_teacher, 600),
  };
  if (!card.topic || card.plan.length === 0) return null;
  return card;
}

const LABELS = {
  uz: { t: "O‘qituvchi", s: "O‘quvchilar", mix: "Aralash mashq", low: "80% dan kam bo‘lsa" },
  ru: { t: "Учитель", s: "Ученики", mix: "Смешанное задание", low: "Если меньше 80%" },
  en: { t: "Teacher", s: "Students", mix: "Mixed practice", low: "If fewer than 80%" },
} as const;

/** Plain text for lesson_cards.plan (readable on a phone, printable). */
export function planText(c: ModelCard, lang: "uz" | "ru" | "en" = "uz"): string {
  const L = LABELS[lang];
  const steps = c.plan.map((p, i) =>
    `${i + 1}. (${p.minutes} min) ${p.step}\n   ${L.t}: ${p.teacher}\n   ${L.s}: ${p.students}`
  );
  return [
    c.objective, "", ...steps,
    c.mix_item ? `\n${L.mix}: ${c.mix_item}` : "",
    c.if_not_mastered ? `\n${L.low}: ${c.if_not_mastered}` : "",
  ].join("\n").trim();
}
