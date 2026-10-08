import { useState } from "react";
import { Link } from "react-router-dom";
import { newId, useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import { addDays, today, weekStart } from "../lib/date";
import { className, studentOf, teacherPairs } from "../lib/queries";
import { integrityFlags, integrityStatus, percentToGrade } from "../ai/insights";
import { askJSON, systemPrompt } from "../ai/claude";
import { useAIErrorText } from "../components/AIBox";
import { QUESTION_BANK } from "../data/questions";
import type { IntegrityFlag, L10n, Question, TestAttempt, WeeklyTest } from "../data/types";
import { Avatar, Badge, Card, Empty, Icon, Modal, PageHead } from "../components/ui";

export default function Tests() {
  const { session } = useStore();
  return session!.role === "student" ? <StudentTests /> : <TeacherTests />;
}

// ---------------------------------------------------------------- student

function StudentTests() {
  const { db, session } = useStore();
  const { t, subj, tl, fmtDate } = useI18n();
  const st = studentOf(db, session!.id);
  const tests = db.tests.filter((x) => x.classId === st.classId).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  const [open, setOpen] = useState<TestAttempt | null>(null);
  return (
    <>
      <PageHead title={t("nav_tests")} sub={t("tests_student_sub")} />
      <div className="callout callout-info"><Icon name="shield-check" /><div>{t("tests_fair_note")}</div></div>
      <Card>
        {tests.length === 0 ? <Empty>{t("no_open_tests")}</Empty> : (
          <div className="list">
            {tests.map((x) => {
              const at = db.attempts.find((a) => a.testId === x.id && a.studentId === st.id);
              return (
                <div key={x.id} className="list-item">
                  <Icon name="checklist" />
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{tl(x.title)}</div>
                    <div className="small muted">{subj(x.subjectId)} · {t("week_of", { date: fmtDate(x.weekStart) })} · {t("questions_n", { n: x.questionIds.length })}</div>
                  </div>
                  {at ? (
                    <>
                      <Badge tone="good">{Math.round((at.score / at.maxScore) * 100)}%</Badge>
                      <button className="btn btn-sm" onClick={() => setOpen(at)}>{t("see_answers")}</button>
                    </>
                  ) : x.status === "open" ? (
                    <Link className="btn btn-primary btn-sm" to={`/tests/${x.id}/take`}>{t("start")}</Link>
                  ) : <Badge>{t("closed")}</Badge>}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {open && <AttemptReview attempt={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function AttemptReview({ attempt, onClose }: { attempt: TestAttempt; onClose: () => void }) {
  const { db } = useStore();
  const { t, tl } = useI18n();
  const test = db.tests.find((x) => x.id === attempt.testId)!;
  return (
    <Modal title={tl(test.title)} onClose={onClose} wide>
      <div className="stack">
        {attempt.order.map((qid, i) => {
          const q = db.questions.find((x) => x.id === qid)!;
          const given = attempt.answers[qid];
          const right = q.type === "mcq" ? given === q.answer : null;
          return (
            <div key={qid} className="card" style={{ padding: 12 }}>
              <div style={{ fontWeight: 600 }}>{i + 1}. {tl(q.text)}</div>
              <div className="small" style={{ marginTop: 4 }}>
                {t("your_answer")}: <b>{q.type === "mcq" ? (given != null ? tl(q.options![given as number]) : "—") : String(given ?? "—")}</b>{" "}
                {right === true && <Badge tone="good" icon="check">{t("correct")}</Badge>}
                {right === false && <Badge tone="bad" icon="x">{t("wrong")}</Badge>}
              </div>
              <div className="small muted" style={{ marginTop: 4 }}><Icon name="bulb" /> {tl(q.explain)}</div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- teacher / director

function flagText(f: IntegrityFlag, t: (k: string, p?: Record<string, string | number>) => string) {
  return t(`flag_${f.kind}`, f.detail);
}

function TeacherTests() {
  const { db, session, update, actions, showToast } = useStore();
  const { t, tl, subj, fmtDate, lang } = useI18n();
  const errText = useAIErrorText();
  const isTeacher = session!.role === "teacher";
  const pairs = isTeacher ? teacherPairs(db, session!.id) : [];
  // Teachers see their own subjects, plus every test of the class they are homeroom teacher of.
  const homeroom = db.teachers.find((x) => x.id === session!.id)?.homeroomClassId;
  const visible = db.tests
    .filter((x) => !isTeacher || pairs.some((p) => p.classId === x.classId && p.subjectId === x.subjectId) || x.classId === homeroom)
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  const [testId, setTestId] = useState(visible[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [newPair, setNewPair] = useState(pairs[0] ? `${pairs[0].classId}|${pairs[0].subjectId}` : "");
  const test = db.tests.find((x) => x.id === testId);

  const createTest = async () => {
    const [classId, subjectId] = newPair.split("|");
    const ws = weekStart(today());
    const topics = db.topics.filter((x) => x.classId === classId && x.subjectId === subjectId && x.date >= addDays(ws, -7) && x.date <= today()).map((x) => x.topic);
    const uniqueTopics = [...new Set(topics)];
    setErr("");
    let questions: Question[] = [];
    let title: L10n = { uz: `Haftalik test: ${subj(subjectId)}`, ru: `Еженедельный тест: ${subj(subjectId)}`, en: `Weekly test: ${subj(subjectId)}` };
    if (db.settings.apiKey) {
      setBusy(true);
      try {
        const l10n = { type: "object", properties: { uz: { type: "string" }, ru: { type: "string" }, en: { type: "string" } }, required: ["uz", "ru", "en"], additionalProperties: false };
        const res = await askJSON<{ title: L10n; questions: { type: "mcq" | "short"; text: L10n; options: L10n[]; correctIndex: number; keywords: string[]; explain: L10n; topic: L10n; difficulty: number }[] }>({
          apiKey: db.settings.apiKey,
          system: systemPrompt(lang, "teacher", "You write weekly school tests. Every text field must be given in Uzbek (Latin), Russian and English."),
          content: `Class ${className(db, classId)}, subject ${subj(subjectId)}. Topics taught this week: ${uniqueTopics.join("; ") || "(no topics recorded)"}.\n` +
            `Write a weekly test of 6 questions: 4 multiple-choice (4 options each, set correctIndex) and 2 short-answer (options empty, correctIndex -1, give 6–12 lowercase keywords in all three languages that a correct answer would contain). ` +
            `Mix difficulty 1–3. Each explanation is one or two sentences.`,
          schema: {
            type: "object", additionalProperties: false, required: ["title", "questions"],
            properties: {
              title: l10n,
              questions: { type: "array", items: { type: "object", additionalProperties: false,
                required: ["type", "text", "options", "correctIndex", "keywords", "explain", "topic", "difficulty"],
                properties: { type: { type: "string", enum: ["mcq", "short"] }, text: l10n, options: { type: "array", items: l10n }, correctIndex: { type: "integer" }, keywords: { type: "array", items: { type: "string" } }, explain: l10n, topic: l10n, difficulty: { type: "integer" } } } },
            },
          },
        });
        title = res.title;
        questions = res.questions.map((q) => ({
          id: newId("q"), type: q.type, text: q.text, explain: q.explain, topic: q.topic,
          difficulty: (Math.min(3, Math.max(1, q.difficulty)) as 1 | 2 | 3),
          ...(q.type === "mcq" ? { options: q.options.slice(0, 4), answer: Math.max(0, Math.min(3, q.correctIndex)) } : { answer: q.keywords }),
        }));
      } catch (e) {
        setErr(errText(e));
        setBusy(false);
        return;
      }
      setBusy(false);
    } else {
      questions = (QUESTION_BANK[subjectId] ?? []).slice(0, 6);
      if (!questions.length) { setErr(t("no_bank")); return; }
    }
    const id = newId("wt");
    update((d) => {
      for (const q of questions) if (!d.questions.some((x) => x.id === q.id)) d.questions.push(q);
      const wt: WeeklyTest = { id, classId, subjectId, weekStart: ws, title, questionIds: questions.map((q) => q.id), status: "open", createdBy: "ai" };
      d.tests.push(wt);
    });
    setTestId(id);
    setCreating(false);
    showToast(t("test_created"));
  };

  const closeTest = () => {
    if (!test) return;
    const date = today();
    let n = 0;
    for (const a of db.attempts.filter((x) => x.testId === test.id)) {
      const status = integrityStatus(integrityFlags(db, a));
      if (a.review === "suspicious" || (status === "review" && a.review !== "ok")) continue;
      if (db.grades.some((g) => g.studentId === a.studentId && g.subjectId === test.subjectId && g.kind === "weekly" && g.date >= test.weekStart)) continue;
      actions.setGrade({ studentId: a.studentId, subjectId: test.subjectId, date, value: percentToGrade((a.score / a.maxScore) * 100), kind: "weekly", teacherId: session!.id, aiSuggested: true });
      n++;
    }
    update((d) => { d.tests.find((x) => x.id === test.id)!.status = "closed"; });
    showToast(t("test_closed_n", { n }));
  };

  return (
    <>
      <PageHead title={t("nav_tests")} sub={t("tests_teacher_sub")}
        right={isTeacher && <button className="btn btn-ai" onClick={() => setCreating(true)}><Icon name="sparkles" />{t("create_weekly")}</button>} />
      <div className="grid grid-3">
        <Card title={t("tests")}>
          <div className="list">
            {visible.map((x) => {
              const attempts = db.attempts.filter((a) => a.testId === x.id);
              const review = attempts.filter((a) => !a.review && integrityStatus(integrityFlags(db, a)) === "review").length;
              return (
                <button key={x.id} className="list-item" onClick={() => setTestId(x.id)} style={{ background: x.id === testId ? "var(--brand-soft)" : "none", border: "none", borderRadius: 8, padding: "10px 8px", cursor: "pointer", textAlign: "left", width: "100%" }}>
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{className(db, x.classId)} · {subj(x.subjectId)}</div>
                    <div className="small muted">{t("week_of", { date: fmtDate(x.weekStart) })} · {t("done_n", { n: attempts.length })}</div>
                  </div>
                  {review > 0 && <Badge tone="warn" icon="shield-exclamation">{review}</Badge>}
                  <Badge tone={x.status === "open" ? "brand" : ""}>{t(x.status === "open" ? "open" : "closed")}</Badge>
                </button>
              );
            })}
          </div>
        </Card>
        <div className="span-2 stack" style={{ gap: 16 }}>
          {test ? <TestResults test={test} onClose={isTeacher && test.status === "open" ? closeTest : undefined} /> : <Card><Empty>{t("no_tests")}</Empty></Card>}
        </div>
      </div>
      {creating && (
        <Modal title={t("create_weekly")} onClose={() => setCreating(false)}>
          <div className="stack">
            <p className="small muted">{db.settings.apiKey ? t("create_weekly_ai") : t("create_weekly_offline")}</p>
            <select className="select" style={{ width: "100%" }} value={newPair} onChange={(e) => setNewPair(e.target.value)} aria-label={t("class_subject")}>
              {pairs.map((p) => <option key={`${p.classId}|${p.subjectId}`} value={`${p.classId}|${p.subjectId}`}>{className(db, p.classId)} · {subj(p.subjectId)}</option>)}
            </select>
            {err && <div className="callout callout-warn small"><Icon name="alert-triangle" /><div>{err}</div></div>}
            <button className="btn btn-ai" onClick={createTest} disabled={busy}><Icon name="sparkles" />{busy ? t("thinking") : t("generate")}</button>
          </div>
        </Modal>
      )}
      {test && <p className="small muted">{tl(test.title)}</p>}
    </>
  );
}

function TestResults({ test, onClose }: { test: WeeklyTest; onClose?: () => void }) {
  const { db, update, session } = useStore();
  const { t, tl } = useI18n();
  const [show, setShow] = useState<TestAttempt | null>(null);
  const students = db.students.filter((s) => s.classId === test.classId);
  const attempts = db.attempts.filter((a) => a.testId === test.id);
  const rows = students.map((s) => {
    const a = attempts.find((x) => x.studentId === s.id);
    const flags = a ? integrityFlags(db, a) : [];
    return { s, a, flags, status: a ? integrityStatus(flags) : null };
  }).sort((x, y) => (y.flags.reduce((s, f) => s + f.weight, 0)) - (x.flags.reduce((s, f) => s + f.weight, 0)));
  const avgPct = attempts.length ? Math.round(attempts.reduce((s, a) => s + a.score / a.maxScore, 0) / attempts.length * 100) : null;
  const decide = (attemptId: string, review: "ok" | "suspicious") => update((d) => { d.attempts.find((x) => x.id === attemptId)!.review = review; });
  const canDecide = session!.role === "teacher";

  return (
    <>
      <Card title={tl(test.title)} sub={`${className(db, test.classId)} · ${t("done_n", { n: attempts.length })}/${students.length}${avgPct != null ? ` · ${t("average")} ${avgPct}%` : ""}`}
        right={onClose && <button className="btn btn-primary" onClick={onClose}><Icon name="lock" />{t("close_send_grades")}</button>}>
        <div className="callout callout-ai small" style={{ marginBottom: 12 }}>
          <Icon name="shield-check" />
          <div>{t("integrity_explain")}</div>
        </div>
        {attempts.length === 0 ? <Empty icon="hourglass">{t("no_attempts")}</Empty> : (
          <div className="list">
            {rows.map(({ s, a, flags, status }) => (
              <div key={s.id} className="list-item" style={{ alignItems: "flex-start" }}>
                <Avatar name={s.name} />
                <div className="grow">
                  <div className="row" style={{ gap: 8 }}>
                    <b>{s.name}</b>
                    {a && <span className="tnum small">{a.score}/{a.maxScore} · {Math.round((a.score / a.maxScore) * 100)}%</span>}
                    {!a && <Badge>{t("not_taken")}</Badge>}
                  </div>
                  {a && (
                    <>
                      <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        {status === "ok" && <Badge tone="good" icon="circle-check">{t("integrity_ok")}</Badge>}
                        {flags.map((f, i) => <Badge key={i} tone={f.weight >= 2 ? "bad" : "warn"}>{flagText(f, t)}</Badge>)}
                      </div>
                      {a.followUp && (
                        <div className="small muted" style={{ marginTop: 4 }}>
                          <Icon name="message-question" /> {t("followup_answer")}: “{a.followUp.answer}”{" "}
                          <Badge tone={a.followUp.verdict === "ok" ? "good" : a.followUp.verdict === "weak" ? "bad" : ""}>{t(`fu_${a.followUp.verdict}`)}</Badge>
                        </div>
                      )}
                    </>
                  )}
                </div>
                {a && (
                  <div className="stack" style={{ gap: 6, alignItems: "flex-end" }}>
                    {status !== "ok" && (a.review ? (
                      <Badge tone={a.review === "ok" ? "good" : "bad"} icon={a.review === "ok" ? "check" : "flag"}>{t(`review_${a.review}`)}</Badge>
                    ) : canDecide ? (
                      <div className="row" style={{ gap: 4 }}>
                        <button className="btn btn-sm" onClick={() => decide(a.id, "ok")} title={t("review_ok")}><Icon name="check" />{t("independent")}</button>
                        <button className="btn btn-sm btn-danger" onClick={() => decide(a.id, "suspicious")} title={t("review_suspicious")}><Icon name="flag" />{t("talk_to_student")}</button>
                      </div>
                    ) : <Badge tone={status === "review" ? "bad" : "warn"}>{t(`status_${status}`)}</Badge>)}
                    <button className="btn btn-sm btn-ghost" onClick={() => setShow(a)}>{t("see_answers")}</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      {show && <AttemptReview attempt={show} onClose={() => setShow(null)} />}
    </>
  );
}
