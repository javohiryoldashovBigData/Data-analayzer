import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { newId, useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import { nowStamp } from "../lib/date";
import { scoreAnswer } from "../data/seed";
import { judgeFollowUpLocally } from "../ai/insights";
import { askJSON, systemPrompt } from "../ai/claude";
import type { Question, TestAttempt } from "../data/types";
import { Badge, Card, Empty, Icon, PageHead, Progress } from "../components/ui";

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

export default function TakeTest() {
  const { id } = useParams();
  const { db, session, update } = useStore();
  const { t, tl, subj, lang } = useI18n();
  const navigate = useNavigate();
  const test = db.tests.find((x) => x.id === id);
  const existing = db.attempts.find((a) => a.testId === id && a.studentId === session!.id);

  // Each student gets their own question order and option order.
  const plan = useMemo(() => {
    if (!test) return null;
    const order = shuffle(test.questionIds);
    const optionOrder: Record<string, number[]> = {};
    for (const qid of order) optionOrder[qid] = shuffle([0, 1, 2, 3]);
    return { order, optionOrder };
  }, [test]);

  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const seconds = useRef<Record<string, number>>({});
  const shownAt = useRef(Date.now());
  const paste = useRef(0);
  const blur = useRef(0);
  const [phase, setPhase] = useState<"test" | "followup" | "done">("test");
  const [attemptId, setAttemptId] = useState("");
  const [fuAnswer, setFuAnswer] = useState("");
  const [judging, setJudging] = useState(false);

  useEffect(() => {
    const onBlur = () => { if (phase === "test") blur.current++; };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [phase]);

  if (!test || !plan) return <Card><Empty>{t("not_found")}</Empty></Card>;
  if (existing && phase === "test") {
    return (
      <Card title={tl(test.title)}>
        <Empty icon="circle-check">{t("already_done")}</Empty>
        <div className="row" style={{ justifyContent: "center" }}><Link className="btn" to="/tests">{t("back")}</Link></div>
      </Card>
    );
  }

  const questions = plan.order.map((qid) => db.questions.find((q) => q.id === qid)!) as Question[];
  const q = questions[idx];
  const track = () => {
    seconds.current[q.id] = (seconds.current[q.id] ?? 0) + Math.round((Date.now() - shownAt.current) / 1000);
    shownAt.current = Date.now();
  };

  const followQ = (() => {
    const shorts = questions.filter((x) => x.type === "short" && String(answers[x.id] ?? "").trim().length > 0);
    if (shorts.length) return shorts.sort((a, b) => String(answers[b.id]).length - String(answers[a.id]).length)[0];
    return questions.find((x) => x.type === "mcq" && answers[x.id] === x.answer) ?? questions[0];
  })();
  const followPrompt = followQ.type === "short"
    ? t("fu_prompt_short", { q: tl(followQ.text), a: String(answers[followQ.id] ?? "") })
    : t("fu_prompt_mcq", { q: tl(followQ.text), a: answers[followQ.id] != null ? tl(followQ.options![answers[followQ.id] as number]) : "—" });

  const submit = () => {
    track();
    let score = 0, maxScore = 0;
    for (const x of questions) {
      const r = scoreAnswer(x.type, x.answer, answers[x.id]);
      score += r.points; maxScore += r.max;
    }
    const aid = newId("at");
    const attempt: TestAttempt = {
      id: aid, testId: test.id, studentId: session!.id, order: plan.order, optionOrder: plan.optionOrder,
      answers, seconds: { ...seconds.current }, pasteCount: paste.current, blurCount: blur.current,
      submittedAt: nowStamp(), score, maxScore,
      followUp: { questionId: followQ.id, prompt: followPrompt, answer: "", verdict: "pending" },
    };
    update((d) => { d.attempts.push(attempt); });
    setAttemptId(aid);
    setPhase("followup");
  };

  const sendFollowUp = async () => {
    setJudging(true);
    let verdict: "ok" | "weak" = judgeFollowUpLocally(followQ, fuAnswer);
    let note = "";
    if (db.settings.apiKey) {
      try {
        const r = await askJSON<{ verdict: "ok" | "weak"; note: string }>({
          apiKey: db.settings.apiKey,
          system: systemPrompt(lang, "teacher", "You judge whether a school student's short explanation shows they understand their own test answer. Be fair and lenient with spelling and grammar; judge understanding only."),
          content: `Question: ${tl(followQ.text)}\nModel explanation: ${tl(followQ.explain)}\nStudent's test answer: ${followQ.type === "mcq" ? tl(followQ.options![answers[followQ.id] as number] ?? { uz: "", ru: "", en: "" }) : answers[followQ.id]}\n` +
            `Follow-up asked: ${followPrompt}\nStudent's explanation: ${fuAnswer}\n\nverdict "ok" if the explanation shows real understanding, "weak" if it does not. note: one sentence for the teacher.`,
          schema: { type: "object", properties: { verdict: { type: "string", enum: ["ok", "weak"] }, note: { type: "string" } }, required: ["verdict", "note"], additionalProperties: false },
          effort: "low",
        });
        verdict = r.verdict; note = r.note;
      } catch { /* fall back to the local judgement */ }
    }
    update((d) => {
      const a = d.attempts.find((x) => x.id === attemptId);
      if (a?.followUp) Object.assign(a.followUp, { answer: fuAnswer, verdict, note });
    });
    setJudging(false);
    setPhase("done");
  };

  if (phase === "followup") {
    return (
      <>
        <PageHead title={t("followup_title")} sub={t("followup_sub")} />
        <Card>
          <div className="stack">
            <div className="callout callout-ai"><Icon name="message-question" /><div><b>{followPrompt}</b></div></div>
            <textarea className="textarea" value={fuAnswer} onChange={(e) => setFuAnswer(e.target.value)} placeholder={t("fu_placeholder")} autoFocus />
            <button className="btn btn-primary" onClick={sendFollowUp} disabled={judging || fuAnswer.trim().length < 3}><Icon name="send" />{judging ? t("thinking") : t("send")}</button>
          </div>
        </Card>
      </>
    );
  }

  if (phase === "done") {
    const a = db.attempts.find((x) => x.id === attemptId);
    return (
      <Card title={t("test_finished")}>
        <div className="stack" style={{ alignItems: "center", textAlign: "center" }}>
          <div className="stat-value">{a ? `${a.score}/${a.maxScore}` : ""}</div>
          <p className="muted">{t("test_finished_text")}</p>
          <div className="row"><button className="btn btn-primary" onClick={() => navigate("/tests")}>{t("see_answers")}</button><Link className="btn" to="/assistant">{t("practise_with_tutor")}</Link></div>
        </div>
      </Card>
    );
  }

  const opts = q.type === "mcq" ? plan.optionOrder[q.id] : [];
  return (
    <>
      <PageHead title={tl(test.title)} sub={`${subj(test.subjectId)} · ${t("question_of", { i: idx + 1, n: questions.length })}`} />
      <Progress value={((idx + 1) / questions.length) * 100} />
      <Card>
        <div className="stack">
          <div className="row" style={{ gap: 8 }}><Badge>{tl(q.topic)}</Badge><Badge tone={q.difficulty === 3 ? "bad" : q.difficulty === 2 ? "warn" : "good"}>{t(`diff_${q.difficulty}`)}</Badge></div>
          <h2 style={{ fontSize: 18 }}>{tl(q.text)}</h2>
          {q.type === "mcq" ? (
            <div className="stack" style={{ gap: 8 }}>
              {opts.map((oi, k) => (
                <button key={oi} className={`option ${answers[q.id] === oi ? "selected" : ""}`} onClick={() => setAnswers({ ...answers, [q.id]: oi })}>
                  <span className="letter">{"ABCD"[k]}</span>{tl(q.options![oi])}
                </button>
              ))}
            </div>
          ) : (
            <textarea className="textarea" value={String(answers[q.id] ?? "")} placeholder={t("write_answer")}
              onPaste={() => { paste.current++; }}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
          )}
          <div className="row between">
            <button className="btn" disabled={idx === 0} onClick={() => { track(); setIdx(idx - 1); }}><Icon name="arrow-left" />{t("prev")}</button>
            {idx < questions.length - 1
              ? <button className="btn btn-primary" onClick={() => { track(); setIdx(idx + 1); }}>{t("next")}<Icon name="arrow-right" /></button>
              : <button className="btn btn-primary" onClick={submit} disabled={questions.some((x) => answers[x.id] == null || answers[x.id] === "")}><Icon name="check" />{t("finish")}</button>}
          </div>
        </div>
      </Card>
      <p className="small muted"><Icon name="info-circle" /> {t("test_rules")}</p>
    </>
  );
}
