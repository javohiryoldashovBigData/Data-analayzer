import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import { today } from "../lib/date";
import { className, studentOf, teacherPairs } from "../lib/queries";
import { readiness, type ReadinessReason } from "../ai/insights";
import { Avatar, Badge, Card, Empty, Icon, PageHead } from "../components/ui";
import AIBox from "../components/AIBox";

export default function AskFirst() {
  const { db, session, actions, showToast } = useStore();
  const { t, subj, fmtDate } = useI18n();
  const [params, setParams] = useSearchParams();
  const pairs = teacherPairs(db, session!.id);
  const classId = params.get("class") ?? pairs[0].classId;
  const subjectId = params.get("subject") ?? pairs[0].subjectId;
  const [asked, setAsked] = useState<Record<string, number>>({});
  const date = today();

  const list = readiness(db, classId, subjectId, date);
  const notReady = list.filter((r) => r.score >= 30);
  const forgotten = list.filter((r) => r.score < 30 && r.daysSinceAsked >= 10).sort((a, b) => b.daysSinceAsked - a.daysSinceAsked);
  const topic = db.topics.filter((x) => x.classId === classId && x.subjectId === subjectId && x.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0];

  const reasonText = (r: ReadinessReason) => {
    const { key, ...p } = r;
    const params = { ...p } as Record<string, string>;
    if (params.date) params.date = fmtDate(params.date);
    return t(`ready_${key}`, params);
  };

  const grade = (studentId: string, value: number) => {
    actions.setGrade({ studentId, subjectId, date, value, kind: "oral", teacherId: session!.id });
    setAsked((a) => ({ ...a, [studentId]: value }));
    showToast(t("grade_saved_for", { name: studentOf(db, studentId).name, value }));
  };

  const Row = ({ id, reasons, score }: { id: string; reasons: ReadinessReason[]; score?: number }) => {
    const s = studentOf(db, id);
    return (
      <div className="list-item" style={{ alignItems: "flex-start" }}>
        <Avatar name={s.name} />
        <div className="grow">
          <div className="row" style={{ gap: 8 }}>
            <Link to={`/student/${s.id}`} style={{ fontWeight: 600, color: "inherit", textDecoration: "none" }}>{s.name}</Link>
            {score != null && <Badge tone={score >= 55 ? "bad" : "warn"}>{t("readiness_score", { n: Math.min(99, score) })}</Badge>}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 4 }}>
            {reasons.map((r, i) => <Badge key={i}>{reasonText(r)}</Badge>)}
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          {asked[id] ? <Badge tone="good" icon="check">{t("asked")} · {asked[id]}</Badge> : [5, 4, 3, 2].map((v) => (
            <button key={v} className="btn btn-sm" style={{ padding: "3px 8px" }} onClick={() => grade(id, v)} title={t("put_grade")}>{v}</button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <PageHead title={t("nav_askfirst")} sub={t("askfirst_sub")}
        right={
          <select className="select" value={`${classId}|${subjectId}`} onChange={(e) => { const [c, s] = e.target.value.split("|"); setParams({ class: c, subject: s }); }} aria-label={t("class_subject")}>
            {pairs.map((p) => <option key={`${p.classId}|${p.subjectId}`} value={`${p.classId}|${p.subjectId}`}>{className(db, p.classId)} · {subj(p.subjectId)}</option>)}
          </select>
        } />
      <div className="callout callout-ai">
        <Icon name="sparkles" />
        <div>
          <b>{className(db, classId)} · {subj(subjectId)}</b>{topic && <> — {t("last_topic")}: <i>{topic.topic}</i></>}
          <div className="small">{t("askfirst_how")}</div>
        </div>
      </div>
      <div className="grid grid-2">
        <Card title={<><Icon name="hand-finger" /> {t("ask_first_title")}</>} sub={t("ask_first_desc")}>
          {notReady.length === 0 ? <Empty icon="mood-happy">{t("everyone_ready")}</Empty> : <div className="list">{notReady.map((r) => <Row key={r.studentId} id={r.studentId} reasons={r.reasons.filter((x) => x.key !== "notAsked")} score={r.score} />)}</div>}
        </Card>
        <Card title={<><Icon name="clock-hour-4" /> {t("not_asked_title")}</>} sub={t("not_asked_desc")}>
          {forgotten.length === 0 ? <Empty icon="circle-check">{t("everyone_asked")}</Empty> : <div className="list">{forgotten.map((r) => <Row key={r.studentId} id={r.studentId} reasons={[{ key: "notAsked", days: String(r.daysSinceAsked) }]} />)}</div>}
        </Card>
      </div>
      <AIBox
        title={t("ai_oral_questions")}
        sub={t("ai_oral_questions_sub")}
        button={t("generate")}
        prompt={() => `Subject: ${subj(subjectId)}. Class: ${className(db, classId)}. Today's topic: ${topic?.topic ?? "(not set)"}.\n` +
          `Write 6 short oral questions the teacher can ask at the start of the lesson to check homework and readiness: 2 easy, 2 medium, 2 hard. ` +
          `For each give the expected answer in one line. Then add one sentence on how to ask the students who are probably not ready in a supportive way, without embarrassing them.`}
      />
      <p className="small muted"><Icon name="lock" /> {t("askfirst_privacy")}</p>
    </>
  );
}
