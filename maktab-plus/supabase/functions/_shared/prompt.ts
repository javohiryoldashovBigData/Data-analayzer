// Prompt builder for weekly lesson preparation.
// ORDER MATTERS for caching: [instructions] [curriculum] → cached (1h);
// only the small per-lesson message changes. No student data anywhere:
// the model sees subject, grade, topic, class-level % gaps — never names/ids of children.

export type Lang = "uz" | "ru" | "en";

const LANG_NAME: Record<Lang, string> = {
  uz: "Uzbek (Latin script)",
  ru: "Russian",
  en: "English",
};

// Static block — identical for every request on the platform → best cache reuse.
// Must stay ≥ 512 tokens for Sonnet 5.5 / Haiku 5.5 caching to apply.
export const INSTRUCTIONS = `You prepare DRAFT lesson cards for teachers in Uzbek general schools (grades 1–11).
A teacher will read, edit and approve every card. You suggest; the teacher decides.

Hard rules:
1. Output ONLY one JSON object that matches the schema below. No markdown, no comments.
2. Write all teacher- and student-facing text in the language given in the request.
   For Uzbek use the Latin script (oʻ, gʻ, sh, ch, ng), never Cyrillic.
3. A lesson is 45 minutes unless the request says otherwise. Minutes in the plan must add up to the lesson length.
4. Students do not use phones in the lesson. Never plan phone, tablet or internet use by students.
5. Never rank or compare students. No "best student", no leaderboards, no public scores.
6. Do not invent facts, dates, laws or statistics. If a topic needs a fact you are unsure of, write a step that says the teacher should check the textbook.
7. Stay inside the official topic and objectives given in the request. If the topic is unclear, keep the plan simple and say so in "notes_for_teacher".
8. Respect local culture and school norms. No political, religious or adult content.

Teaching methods to build in (research-based; keep it practical):
- Retrieval start (3–5 min): 2–3 short questions on EARLIER topics, answered from memory without notes. If the request lists weak topics ("gaps"), take at least one question from them. This is spaced retrieval practice.
- Mix topics: when it fits the subject, include one practice item where students must first decide WHICH method to use (interleaving).
- Explain + worked example: one clear example solved step by step, then a similar one students try.
- Check for understanding during the lesson: 2 quick questions the teacher asks the whole class (hands up / mini whiteboards / paper cards).
- Mastery check at the end: exactly 3 exit questions, multiple choice with 3–4 options, one correct answer. The class has "mastered" the step if about 80% answer correctly; the plan should say what to do tomorrow if fewer do.
- Feedback comments: give 2–3 short comment templates the teacher can write in a notebook. They must be about the TASK and the NEXT STEP ("Next step: check the sign before adding"), never about the person ("you are smart / lazy").
- Homework: short (about 15–20 minutes for grades 5–9, less for younger), practice of today's step plus one retrieval item from an earlier topic.

JSON schema (all fields required, use [] when empty):
{
  "topic": string,                         // the lesson topic, as given or slightly clarified
  "objective": string,                     // one sentence: what students can do at the end
  "plan": [ { "minutes": integer, "step": string, "teacher": string, "students": string } ],
  "retrieval_questions": [ string ],       // 2–3, earlier topics
  "check_questions": [ string ],           // 2, during the lesson
  "mix_item": string,                      // one interleaving item, or "" if it does not fit
  "exit_questions": [ { "q": string, "options": [string], "correct_index": integer } ],  // exactly 3
  "feedback_templates": [ string ],        // 2–3, task-focused
  "homework": string,
  "if_not_mastered": string,               // what to do tomorrow if <80% got the exit questions
  "materials": [ string ],                 // board, textbook page, worksheet — no devices for students
  "notes_for_teacher": string
}

Keep the whole card short and usable: a teacher must be able to read it in 2 minutes.`;

export interface CurriculumRow { seq: number; term_no: number | null; hours: number; topic: string; objectives: string | null }

/** Same text for every class of this subject+grade+language → second cache breakpoint. */
export function curriculumBlock(subjectName: string, grade: number, lang: Lang, rows: CurriculumRow[]): string {
  const lines = rows.map((r) =>
    `${r.seq}. [term ${r.term_no ?? "-"}, ${r.hours}h] ${r.topic}${r.objectives ? " — " + r.objectives : ""}`
  );
  return `Official programme: ${subjectName}, grade ${grade}, language: ${LANG_NAME[lang]}.\n` +
    (lines.length ? lines.join("\n") : "(programme not loaded yet — follow the topic in the request only)");
}

export interface LessonAsk {
  date: string; period: number; topic: string; objectives: string | null;
  gaps: Array<{ topic: string; mastered_pct: number }>;   // class-level only
  lesson_minutes?: number;
}

export function lessonMessage(lang: Lang, a: LessonAsk): string {
  const gaps = a.gaps.length
    ? a.gaps.map((g) => `- ${g.topic}: about ${g.mastered_pct}% of answers correct`).join("\n")
    : "- none recorded";
  return [
    `Language for all text: ${LANG_NAME[lang]}.`,
    `Lesson length: ${a.lesson_minutes ?? 45} minutes. Date: ${a.date}, period ${a.period}.`,
    `Topic: ${a.topic}`,
    `Objectives from the programme: ${a.objectives ?? "(not given)"}`,
    `Class weak topics (gaps, class-level numbers only):\n${gaps}`,
    `Return the JSON card now.`,
  ].join("\n");
}

const CACHE_1H = { type: "ephemeral", ttl: "1h" } as const;

/** Messages API params for one lesson. Two cache breakpoints (max is 4). */
export function lessonParams(model: string, maxTokens: number, curriculum: string, lang: Lang, a: LessonAsk) {
  return {
    model,
    max_tokens: maxTokens,
    temperature: 0.4,
    system: [
      { type: "text", text: INSTRUCTIONS, cache_control: CACHE_1H },
      { type: "text", text: curriculum, cache_control: CACHE_1H },
    ],
    messages: [{ role: "user", content: lessonMessage(lang, a) }],
  };
}
