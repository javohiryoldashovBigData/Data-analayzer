import { useState } from "react";
import { useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import { Card, Icon, PageHead, Tabs } from "../components/ui";
import AIBox from "../components/AIBox";
import ChemLab, { type ExperimentId } from "../components/ChemLab";
import { QUESTION_BANK } from "../data/questions";

type Tab = "plan" | "lab" | "video" | "experiment" | "quiz" | "slides";

const PRESETS: { subject: string; topic: string; lab?: ExperimentId }[] = [
  { subject: "chem", topic: "Natriyning suv bilan reaksiyasi", lab: "sodium" },
  { subject: "chem", topic: "Kislota va ishqorlarning neytrallanishi", lab: "titration" },
  { subject: "chem", topic: "Metallarning kislotalar bilan reaksiyasi (vodorod olish)", lab: "zinc" },
  { subject: "chem", topic: "Metallarning faollik qatori: Fe + CuSO₄", lab: "copper" },
  { subject: "math", topic: "Kvadrat tenglamalar" },
  { subject: "phys", topic: "Bosim va uning birliklari" },
];

function guessLab(subject: string, topic: string): ExperimentId | undefined {
  if (subject !== "chem") return undefined;
  const s = topic.toLowerCase();
  if (/natriy|sodium|натри/.test(s)) return "sodium";
  if (/neytral|titr|нейтрал|ishqor/.test(s)) return "titration";
  if (/rux|zinc|цинк|vodorod|hydrogen|водород/.test(s)) return "zinc";
  if (/mis|copper|медь|cuso|faollik/.test(s)) return "copper";
  return "sodium";
}

export default function Studio() {
  const { db } = useStore();
  const { t, subj, tl } = useI18n();
  const [subject, setSubject] = useState("chem");
  const [grade, setGrade] = useState("8");
  const [topic, setTopic] = useState(PRESETS[0].topic);
  const [minutes, setMinutes] = useState(45);
  const [tab, setTab] = useState<Tab>("plan");
  const lab = guessLab(subject, topic);
  const ctx = `Subject: ${subj(subject)}. Grade: ${grade} (Uzbekistan national curriculum). Topic: "${topic}". Lesson length: ${minutes} minutes.`;

  const localPlan = () => {
    const parts = [
      [5, t("plan_greet")], [8, t("plan_check_hw")], [12, t("plan_new")],
      [10, lab ? t("plan_demo") : t("plan_practice")], [7, t("plan_consolidate")], [3, t("plan_hw")],
    ] as const;
    const scale = minutes / 45;
    return `# ${topic}\n**${subj(subject)} · ${grade}-${t("grade_word")} · ${minutes} ${t("min")}**\n\n## ${t("plan_goals")}\n- ${t("plan_goal1", { topic })}\n- ${t("plan_goal2")}\n- ${t("plan_goal3")}\n\n## ${t("plan_steps")}\n` +
      parts.map(([m, s], i) => `${i + 1}. **${Math.round(m * scale)} ${t("min")}** — ${s}`).join("\n") +
      `\n\n## ${t("plan_resources")}\n- ${t("plan_res_book")}\n${lab ? `- ${t("plan_res_lab")}\n` : ""}- ${t("plan_res_quiz")}`;
  };
  const localQuiz = () => {
    const qs = QUESTION_BANK[subject] ?? [];
    if (!qs.length) return t("no_bank");
    return `# ${t("quiz")}: ${topic}\n\n` + qs.map((q, i) =>
      `${i + 1}. ${tl(q.text)}${q.options ? "\n" + q.options.map((o, j) => `   - ${"ABCD"[j]}) ${tl(o)}`).join("\n") : ""}\n   - **${t("answer")}:** ${q.type === "mcq" ? "ABCD"[q.answer as number] : tl(q.explain)}`).join("\n\n");
  };

  return (
    <>
      <PageHead title={t("nav_studio")} sub={t("studio_sub")} />
      <Card>
        <div className="grid grid-4" style={{ gap: 12 }}>
          <div className="field"><label className="label" htmlFor="st-sub">{t("subject")}</label>
            <select id="st-sub" className="select" style={{ width: "100%" }} value={subject} onChange={(e) => setSubject(e.target.value)}>
              {db.subjects.map((s) => <option key={s.id} value={s.id}>{subj(s.id)}</option>)}
            </select></div>
          <div className="field"><label className="label" htmlFor="st-grade">{t("grade_word")}</label>
            <select id="st-grade" className="select" style={{ width: "100%" }} value={grade} onChange={(e) => setGrade(e.target.value)}>
              {["5", "6", "7", "8", "9", "10", "11"].map((g) => <option key={g} value={g}>{g}</option>)}
            </select></div>
          <div className="field span-2"><label className="label" htmlFor="st-topic">{t("topic")}</label>
            <input id="st-topic" className="input" value={topic} onChange={(e) => setTopic(e.target.value)} /></div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <span className="small muted">{t("examples")}:</span>
          {PRESETS.map((p) => (
            <button key={p.topic} className="btn btn-sm" onClick={() => { setSubject(p.subject); setTopic(p.topic); if (p.lab) setTab("lab"); }}>{p.topic}</button>
          ))}
          <label className="row small" style={{ marginLeft: "auto", gap: 6 }}>{t("duration")}
            <input className="input" style={{ width: 70 }} type="number" min={20} max={90} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 45)} /> {t("min")}</label>
        </div>
      </Card>

      <Tabs value={tab} onChange={setTab} items={[
        { id: "plan", label: t("tab_plan"), icon: "list-details" },
        { id: "lab", label: t("tab_lab"), icon: "flask" },
        { id: "video", label: t("tab_video"), icon: "movie" },
        { id: "experiment", label: t("tab_experiment"), icon: "test-pipe" },
        { id: "quiz", label: t("tab_quiz"), icon: "checklist" },
        { id: "slides", label: t("tab_slides"), icon: "presentation" },
      ]} />

      {tab === "plan" && (
        <AIBox key={`plan${topic}`} title={t("tab_plan")} sub={t("plan_sub")} button={t("generate")} fallback={localPlan}
          prompt={() => `${ctx}\nWrite a complete lesson plan: learning goals, timed lesson steps (with what the teacher and students do), a short formative check, differentiation for weak and strong students, and homework.`} />
      )}

      {tab === "lab" && (
        <Card title={t("tab_lab")} sub={lab ? t("lab_sub") : t("lab_none")}>
          {lab ? <ChemLab initial={lab} /> : <ChemLab />}
        </Card>
      )}

      {tab === "video" && (
        <>
          <div className="callout callout-info">
            <Icon name="movie" />
            <div>
              <b>{t("video_title")}</b> {t("video_text")}
            </div>
          </div>
          {lab && (
            <Card title={t("video_preview")} sub={t("video_preview_sub")}>
              <ChemLab initial={lab} compact />
            </Card>
          )}
          <AIBox key={`video${topic}`} title={t("video_script")} sub={t("video_script_sub")} button={t("generate")}
            prompt={() => `${ctx}\nWrite a 60–90 second educational video storyboard for this topic: 6–8 numbered scenes, each with (a) what is shown on screen, (b) the narration text, (c) duration in seconds. ` +
              `Scientific accuracy is essential. Add a final "check before showing" list of facts the teacher should verify. Also give one English text-to-video prompt per scene.`} />
        </>
      )}

      {tab === "experiment" && (
        <AIBox key={`exp${topic}`} title={t("tab_experiment")} sub={t("experiment_sub")} button={t("generate")}
          prompt={() => `${ctx}\nWrite a guide for a real classroom demonstration or lab work on this topic: materials and quantities, step-by-step procedure, what students should observe and why (with equations if chemistry), ` +
            `SAFETY RULES (protective equipment, what must only be done by the teacher, disposal), and 3 questions to discuss afterwards. If the experiment is too dangerous for a school, say so and suggest the virtual lab instead.`} />
      )}

      {tab === "quiz" && (
        <AIBox key={`quiz${topic}`} title={t("tab_quiz")} sub={t("quiz_sub")} button={t("generate")} fallback={localQuiz}
          prompt={() => `${ctx}\nCreate a worksheet with three levels: 4 easy, 4 medium and 2 hard questions (mix multiple choice and short answers). Then give the answer key separately.`} />
      )}

      {tab === "slides" && (
        <AIBox key={`slides${topic}`} title={t("tab_slides")} sub={t("slides_sub")} button={t("generate")}
          prompt={() => `${ctx}\nCreate an outline for 8–10 presentation slides: for each slide, a title, 3–4 short bullet points, and a suggestion for an image, diagram or animation.`} />
      )}
    </>
  );
}
