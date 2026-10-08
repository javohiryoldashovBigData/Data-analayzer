import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import { today } from "../lib/date";
import { className, teacherPairs } from "../lib/queries";
import { percentToGrade, studentAverage } from "../ai/insights";
import { askJSON, fileToImageBlock, systemPrompt } from "../ai/claude";
import { useAIErrorText } from "../components/AIBox";
import { Badge, Card, GradePill, Icon, PageHead } from "../components/ui";

interface KeyItem { q: string; answer: string; points: number }
interface Checked { points: number; comment: string; confidence: "high" | "medium" | "low"; read?: string }
interface Paper { answers: string[]; photo?: File; checked?: Checked[]; grade?: number; summary?: string; saved?: boolean }

const DEMO_KEYS: Record<string, KeyItem[]> = {
  math: [
    { q: "3x + 5 = 20. x = ?", answer: "5", points: 2 },
    { q: "(a + b)² = ?", answer: "a² + 2ab + b²", points: 2 },
    { q: "x² − 5x + 6 = 0", answer: "2; 3", points: 3 },
    { q: "Do'konda 4 ta daftar 36 000 so'm. 1 ta daftar narxi?", answer: "9000", points: 3 },
  ],
  chem: [
    { q: "Na + H₂O → ? (mahsulotlar)", answer: "NaOH; H2", points: 3 },
    { q: "HCl + NaOH → ?", answer: "NaCl; H2O", points: 3 },
    { q: "Fenolftalein ishqorda qanday rang?", answer: "pushti", points: 2 },
    { q: "Zn + 2HCl → ZnCl₂ + ? ", answer: "H2", points: 2 },
  ],
};
const WRONG: Record<string, string[][]> = {
  math: [["15", "3", "25/3"], ["a² + b²", "2a + 2b", "a² + ab + b²"], ["2", "-2; -3", "5; 6"], ["8000", "144000", "9"]],
  chem: [["NaOH", "Na2O; H2", "NaH; O2"], ["NaCl", "NaClO; H2", "Na; Cl2"], ["rangsiz", "sariq", "ko'k"], ["O2", "Cl2", "H2O"]],
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(/\^2/g, "²").replace(/x=/g, "").replace(/[,]/g, ";").replace(/₂/g, "2").replace(/₃/g, "3");

/** Offline checker: compares numbers and normalised expressions with the key. */
function checkLocally(key: KeyItem, given: string): Checked {
  const g = norm(given), k = norm(key.answer);
  if (!g) return { points: 0, comment: "—", confidence: "high" };
  const parts = k.split(";").filter(Boolean);
  const tokens = g.split(";");
  // Exact token match; substring match only for longer expressions, so "25/3" never counts as "5".
  const hits = parts.filter((p) => tokens.includes(p) || (p.length > 3 && g.includes(p))).length;
  const extra = g.split(";").filter((p) => p && !parts.includes(p)).length;
  if (hits === parts.length && extra === 0) return { points: key.points, comment: "✓", confidence: "high" };
  if (hits > 0) return { points: Math.round((key.points * hits) / parts.length * 2) / 2 - (extra ? 0.5 : 0), comment: `${hits}/${parts.length}`, confidence: "medium" };
  return { points: 0, comment: `≠ ${key.answer}`, confidence: "high" };
}

export default function ExamCheck() {
  const store = useStore();
  const { db, session } = store;
  const { t, subj, lang } = useI18n();
  const errText = useAIErrorText();
  const pairs = teacherPairs(db, session!.id);
  const [pairKey, setPairKey] = useState(`${pairs[0].classId}|${pairs[0].subjectId}`);
  const [classId, subjectId] = pairKey.split("|");
  const [title, setTitle] = useState(t("exam_default_title"));
  const [keyItems, setKeyItems] = useState<KeyItem[]>(DEMO_KEYS[subjectId] ?? DEMO_KEYS.math);
  const students = useMemo(() => db.students.filter((s) => s.classId === classId), [db.students, classId]);
  const [papers, setPapers] = useState<Record<string, Paper>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const maxPoints = keyItems.reduce((s, k) => s + k.points, 0);

  const changePair = (v: string) => {
    setPairKey(v);
    setKeyItems(DEMO_KEYS[v.split("|")[1]] ?? DEMO_KEYS.math);
    setPapers({});
  };

  const setPaper = (sid: string, p: Partial<Paper>) => setPapers((all) => ({ ...all, [sid]: { ...(all[sid] ?? { answers: keyItems.map(() => "") }), ...p } }));

  const loadSample = () => {
    const wrong = WRONG[subjectId] ?? WRONG.math;
    const next: Record<string, Paper> = {};
    students.forEach((s, si) => {
      const a = studentAverage(db, s.id, subjectId) ?? 3.5;
      const p = Math.max(0.15, Math.min(0.95, (a - 2) / 3));
      next[s.id] = {
        answers: keyItems.map((k, qi) => {
          const r = ((si * 7 + qi * 13) % 20) / 20;
          if (r < p) return k.answer;
          return wrong[qi]?.[(si + qi) % 3] ?? "";
        }),
      };
    });
    setPapers(next);
  };

  const finish = (sid: string, checked: Checked[], summary?: string) => {
    const total = checked.reduce((s, c) => s + c.points, 0);
    setPaper(sid, { checked, grade: percentToGrade((total / maxPoints) * 100), summary, saved: false });
  };

  const checkAll = async () => {
    setErr("");
    const withAnswers = students.filter((s) => papers[s.id] && (papers[s.id].photo || papers[s.id].answers.some((a) => a.trim())));
    if (!db.settings.apiKey) {
      withAnswers.forEach((s) => { if (!papers[s.id].photo) finish(s.id, keyItems.map((k, i) => checkLocally(k, papers[s.id].answers[i] ?? ""))); });
      if (withAnswers.some((s) => papers[s.id].photo)) setErr(t("photo_needs_key"));
      return;
    }
    const schema = {
      type: "object",
      properties: {
        answers: { type: "array", items: { type: "object", properties: {
          read: { type: "string", description: "What the student wrote, as read from the paper" },
          points: { type: "number" },
          comment: { type: "string", description: "One short sentence for the teacher" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        }, required: ["read", "points", "comment", "confidence"], additionalProperties: false } },
        summary: { type: "string", description: "One sentence of feedback for the student" },
      },
      required: ["answers", "summary"],
      additionalProperties: false,
    };
    const keyText = keyItems.map((k, i) => `${i + 1}. ${k.q}\n   Correct answer / rubric: ${k.answer}\n   Max points: ${k.points}`).join("\n");
    const system = systemPrompt(lang, "teacher",
      "You check school exam answers against the teacher's answer key. Give partial credit for partly correct work, accept equivalent forms " +
      "(e.g. 9000 = 9 000 so'm), and set confidence to low whenever handwriting is unclear or you are unsure. The teacher makes the final decision.");
    for (const s of withAnswers) {
      const paper = papers[s.id];
      setBusy(s.name);
      try {
        const content = paper.photo
          ? [await fileToImageBlock(paper.photo), { type: "text" as const, text: `Answer key:\n${keyText}\n\nRead this student's answer sheet photo and grade each question in order.` }]
          : `Answer key:\n${keyText}\n\nStudent's answers:\n${paper.answers.map((a, i) => `${i + 1}. ${a || "(empty)"}`).join("\n")}\n\nGrade each question in order.`;
        const res = await askJSON<{ answers: Checked[]; summary: string }>({ apiKey: db.settings.apiKey, system, content, schema, effort: "low" });
        const checked = keyItems.map((k, i) => {
          const r = res.answers[i] ?? { points: 0, comment: "?", confidence: "low" as const, read: "" };
          return { ...r, points: Math.max(0, Math.min(k.points, r.points)) };
        });
        if (paper.photo) setPaper(s.id, { answers: checked.map((c) => c.read ?? "") });
        finish(s.id, checked, res.summary);
      } catch (e) {
        setErr(`${s.name}: ${errText(e)}`);
        break;
      }
    }
    setBusy("");
  };

  const approveAll = () => {
    const date = today();
    let n = 0;
    for (const s of students) {
      const p = papers[s.id];
      if (!p?.checked || p.grade == null || p.saved) continue;
      store.actions.setGrade({ studentId: s.id, subjectId, date, value: p.grade, kind: "exam", teacherId: session!.id, comment: title, aiSuggested: true });
      setPaper(s.id, { saved: true });
      n++;
    }
    store.showToast(t("grades_saved_n", { n }));
  };

  const checkedList = students.filter((s) => papers[s.id]?.checked);
  const qStats = keyItems.map((k, i) => {
    const got = checkedList.map((s) => papers[s.id].checked![i].points);
    return got.length ? (got.reduce((a, b) => a + b, 0) / (got.length * k.points)) * 100 : null;
  });
  const hardest = qStats.reduce<number | null>((h, v, i) => (v != null && (h == null || v < (qStats[h] ?? 101)) ? i : h), null);

  return (
    <>
      <PageHead title={t("nav_examcheck")} sub={t("examcheck_sub")}
        right={<select className="select" value={pairKey} onChange={(e) => changePair(e.target.value)} aria-label={t("class_subject")}>
          {pairs.map((p) => <option key={`${p.classId}|${p.subjectId}`} value={`${p.classId}|${p.subjectId}`}>{className(db, p.classId)} · {subj(p.subjectId)}</option>)}
        </select>} />

      <Card title={<>1. {t("answer_key")}</>} sub={t("answer_key_sub")}>
        <div className="stack">
          <div className="field"><label className="label" htmlFor="ex-title">{t("exam_title")}</label><input id="ex-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          {keyItems.map((k, i) => (
            <div key={i} className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
              <span className="period-no" style={{ paddingTop: 8 }}>{i + 1}</span>
              <input className="input" value={k.q} onChange={(e) => setKeyItems(keyItems.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} aria-label={t("question")} />
              <input className="input" style={{ maxWidth: 220 }} value={k.answer} onChange={(e) => setKeyItems(keyItems.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} aria-label={t("correct_answer")} placeholder={t("correct_answer")} />
              <input className="input" style={{ width: 70 }} type="number" min={1} value={k.points} onChange={(e) => setKeyItems(keyItems.map((x, j) => (j === i ? { ...x, points: Math.max(1, Number(e.target.value)) } : x)))} aria-label={t("points")} />
              <button className="btn btn-ghost icon-btn" onClick={() => setKeyItems(keyItems.filter((_, j) => j !== i))} aria-label={t("delete")}><Icon name="trash" /></button>
            </div>
          ))}
          <div className="row">
            <button className="btn btn-sm" onClick={() => setKeyItems([...keyItems, { q: "", answer: "", points: 2 }])}><Icon name="plus" />{t("add_question")}</button>
            <span className="small muted">{t("max_points")}: <b>{maxPoints}</b></span>
          </div>
        </div>
      </Card>

      <Card title={<>2. {t("student_papers")}</>} sub={t("student_papers_sub")}
        right={<>
          <button className="btn" onClick={loadSample}><Icon name="file-import" />{t("load_sample")}</button>
          <button className="btn btn-ai" onClick={checkAll} disabled={!!busy}><Icon name="sparkles" />{busy ? t("checking_name", { name: busy }) : t("check_all")}</button>
        </>}>
        {!db.settings.apiKey && <div className="callout callout-info small" style={{ marginBottom: 10 }}><Icon name="cpu" /><div>{t("examcheck_offline")}</div></div>}
        {err && <div className="callout callout-warn small" style={{ marginBottom: 10 }}><Icon name="alert-triangle" /><div>{err}</div></div>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="sticky-col">{t("student")}</th>
                <th>{t("photo")}</th>
                {keyItems.map((k, i) => <th key={i} className="center">{i + 1} <span className="muted">/{k.points}</span></th>)}
                <th className="center">{t("total")}</th>
                <th className="center"><span className="ai-chip">AI</span> {t("grade")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {students.map((s) => {
                const p = papers[s.id];
                const total = p?.checked?.reduce((a, c) => a + c.points, 0);
                const lowConf = p?.checked?.some((c) => c.confidence === "low");
                return (
                  <tr key={s.id}>
                    <td className="sticky-col" style={{ fontWeight: 550 }}>{s.name}{p?.summary && <div className="small muted" style={{ whiteSpace: "normal", maxWidth: 220 }}>{p.summary}</div>}</td>
                    <td>
                      <label className="btn btn-sm" title={t("upload_photo")}>
                        <Icon name={p?.photo ? "photo-check" : "camera"} />
                        <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setPaper(s.id, { photo: f, checked: undefined }); }} />
                      </label>
                    </td>
                    {keyItems.map((_, i) => {
                      const c = p?.checked?.[i];
                      return (
                        <td key={i} className="center" style={{ padding: 4 }}>
                          <input className="input" style={{ width: 96, padding: "4px 6px", fontSize: 13, borderColor: c ? (c.points === keyItems[i].points ? "var(--good)" : c.points === 0 ? "var(--bad)" : "var(--warn)") : undefined }}
                            value={p?.answers[i] ?? ""} placeholder={p?.photo ? t("from_photo") : ""}
                            onChange={(e) => { const answers = [...(p?.answers ?? keyItems.map(() => ""))]; answers[i] = e.target.value; setPaper(s.id, { answers, checked: undefined }); }}
                            title={c ? `${c.points} — ${c.comment}` : undefined} aria-label={`${s.name} ${i + 1}`} />
                          {c && (
                            <div className="small tnum" style={{ color: c.confidence === "low" ? "var(--warn)" : "var(--muted)" }}>
                              <input type="number" min={0} max={keyItems[i].points} step={0.5} value={c.points} aria-label={t("points")}
                                style={{ width: 44, border: "none", background: "transparent", textAlign: "center", fontWeight: 600 }}
                                onChange={(e) => { const checked = [...p!.checked!]; checked[i] = { ...c, points: Math.max(0, Math.min(keyItems[i].points, Number(e.target.value))) }; finish(s.id, checked, p!.summary); }} />
                              {c.confidence === "low" && <Icon name="eye-question" />}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="center tnum" style={{ fontWeight: 650 }}>{total != null ? `${total}/${maxPoints}` : "—"}</td>
                    <td className="center">
                      {p?.grade != null && (
                        <select className="select" style={{ minWidth: 0, width: 64, padding: 4 }} value={p.grade} onChange={(e) => setPaper(s.id, { grade: Number(e.target.value), saved: false })} aria-label={t("grade")}>
                          {[5, 4, 3, 2].map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      )}
                    </td>
                    <td>{p?.saved ? <Badge tone="good" icon="check">{t("saved")}</Badge> : lowConf ? <Badge tone="warn" icon="eye">{t("check_manually")}</Badge> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {checkedList.length > 0 && (
        <Card title={<>3. {t("results_approve")}</>} sub={t("results_approve_sub")}
          right={<button className="btn btn-primary" onClick={approveAll}><Icon name="check" />{t("approve_save")}</button>}>
          <div className="grid grid-3">
            <div className="stat"><span className="stat-label">{t("class_average")}</span>
              <span className="stat-value">{(checkedList.reduce((a, s) => a + (papers[s.id].grade ?? 0), 0) / checkedList.length).toFixed(1)}</span></div>
            <div className="stat"><span className="stat-label">{t("hardest_question")}</span>
              <span className="stat-value">{hardest != null ? `№${hardest + 1}` : "—"}</span>
              {hardest != null && <span className="stat-foot">{t("solved_pct", { n: Math.round(qStats[hardest] ?? 0) })} · {keyItems[hardest].q}</span>}</div>
            <div className="stat"><span className="stat-label">{t("grade_distribution")}</span>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>{[5, 4, 3, 2].map((g) => <span key={g} className="row" style={{ gap: 4 }}><GradePill value={g} small /> <b className="tnum">{checkedList.filter((s) => papers[s.id].grade === g).length}</b></span>)}</div></div>
          </div>
          <p className="small muted" style={{ marginTop: 12 }}><Icon name="shield-check" /> {t("teacher_decides")}</p>
        </Card>
      )}
    </>
  );
}
