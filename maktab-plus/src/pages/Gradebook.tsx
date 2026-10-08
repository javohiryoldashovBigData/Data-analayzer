import { useState } from "react";
import { Link } from "react-router-dom";
import { newId, useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import { addDays, today } from "../lib/date";
import { className, lessonDates, teacherPairs } from "../lib/queries";
import { avg, forecast, round1 } from "../ai/insights";
import type { GradeKind } from "../data/types";
import { Card, GradePill, Icon, Modal, PageHead } from "../components/ui";

const KINDS: GradeKind[] = ["oral", "written", "homework", "test", "exam"];

export default function Gradebook() {
  const { db, session, actions, update, showToast } = useStore();
  const { t, subj, fmtDate } = useI18n();
  const pairs = teacherPairs(db, session!.id);
  const [pairKey, setPairKey] = useState(`${pairs[0].classId}|${pairs[0].subjectId}`);
  const [classId, subjectId] = pairKey.split("|");
  const [cell, setCell] = useState<{ studentId: string; date: string } | null>(null);
  const [lessonDate, setLessonDate] = useState<string | null>(null);

  const students = db.students.filter((s) => s.classId === classId);
  const dates = lessonDates(db, classId, subjectId, addDays(today(), -42));
  const gradesAt = (sid: string, d: string) => db.grades.filter((g) => g.studentId === sid && g.subjectId === subjectId && g.date === d);
  const absentAt = (sid: string, d: string) => db.marks.some((m) => m.studentId === sid && m.date === d && m.status !== "late" && db.lessons.find((l) => l.id === m.lessonId)?.subjectId === subjectId);

  const exportCsv = () => {
    const header = [t("student"), ...dates, t("average"), t("forecast")];
    const rows = students.map((s) => [
      s.name,
      ...dates.map((d) => gradesAt(s.id, d).map((g) => g.value).join(" ") || (absentAt(s.id, d) ? "nb" : "")),
      round1(avg(db.grades.filter((g) => g.studentId === s.id && g.subjectId === subjectId).map((g) => g.value))),
      String(Math.round(forecast(db, s.id, subjectId) ?? 0) || ""),
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${className(db, classId)}-${subj(subjectId)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <PageHead title={t("nav_gradebook")} sub={t("gradebook_sub")}
        right={<>
          <select className="select" value={pairKey} onChange={(e) => setPairKey(e.target.value)} aria-label={t("class_subject")}>
            {pairs.map((p) => <option key={`${p.classId}|${p.subjectId}`} value={`${p.classId}|${p.subjectId}`}>{className(db, p.classId)} · {subj(p.subjectId)}</option>)}
          </select>
          <button className="btn" onClick={exportCsv}><Icon name="file-spreadsheet" />{t("export_excel")}</button>
          <Link className="btn btn-ai" to={`/ask-first?class=${classId}&subject=${subjectId}`}><Icon name="hand-finger" />{t("nav_askfirst")}</Link>
        </>} />
      <Card>
        <div className="table-wrap" style={{ maxHeight: "70vh" }}>
          <table className="table">
            <thead>
              <tr>
                <th className="sticky-col">{t("student")}</th>
                {dates.map((d) => (
                  <th key={d} className="center" style={{ cursor: "pointer" }} title={db.topics.find((x) => x.classId === classId && x.subjectId === subjectId && x.date === d)?.topic} onClick={() => setLessonDate(d)}>
                    <div>{fmtDate(d, { day: "numeric" })}</div>
                    <div className="small muted" style={{ fontWeight: 500 }}>{fmtDate(d, { month: "short" })}</div>
                  </th>
                ))}
                <th className="center">{t("average")}</th>
                <th className="center"><span className="ai-chip">AI</span></th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => {
                const a = avg(db.grades.filter((g) => g.studentId === s.id && g.subjectId === subjectId).map((g) => g.value));
                const f = forecast(db, s.id, subjectId);
                return (
                  <tr key={s.id}>
                    <td className="sticky-col"><Link to={`/student/${s.id}`} style={{ color: "inherit", textDecoration: "none", fontWeight: 550 }}>{s.name}</Link></td>
                    {dates.map((d) => {
                      const gs = gradesAt(s.id, d);
                      const nb = absentAt(s.id, d);
                      return (
                        <td key={d} className="center" style={{ padding: 3 }}>
                          <button className="cell-btn" onClick={() => setCell({ studentId: s.id, date: d })} aria-label={`${s.name} ${d}`} style={{ width: gs.length > 1 ? 56 : 34 }}>
                            {gs.length ? <span className="row" style={{ gap: 2, flexWrap: "nowrap" }}>{gs.map((g) => <GradePill key={g.id} value={g.value} small ai={g.aiSuggested} />)}</span>
                              : nb ? <span className="small" style={{ color: "var(--bad)", fontWeight: 700 }}>nb</span> : null}
                          </button>
                        </td>
                      );
                    })}
                    <td className="center tnum" style={{ fontWeight: 650 }}>{round1(a)}</td>
                    <td className="center">{f != null && <GradePill value={Math.round(f)} small title={t("forecast")} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}><Icon name="info-circle" /> {t("gradebook_hint")}</p>
      </Card>

      {cell && (
        <GradeModal
          studentName={db.students.find((s) => s.id === cell.studentId)!.name}
          date={cell.date}
          existing={gradesAt(cell.studentId, cell.date)}
          onClose={() => setCell(null)}
          onSave={(value, kind, comment) => {
            actions.setGrade({ studentId: cell.studentId, subjectId, date: cell.date, value, kind, teacherId: session!.id, comment });
            showToast(t("saved"));
            setCell(null);
          }}
          onDelete={(gradeId) => update((d) => { d.grades = d.grades.filter((g) => g.id !== gradeId); })}
        />
      )}

      {lessonDate && (
        <LessonModal
          date={lessonDate}
          topic={db.topics.find((x) => x.classId === classId && x.subjectId === subjectId && x.date === lessonDate)?.topic ?? ""}
          homework={db.homework.find((h) => h.classId === classId && h.subjectId === subjectId && h.date === lessonDate)?.text ?? ""}
          onClose={() => setLessonDate(null)}
          onSave={(topic, hwText) => {
            update((d) => {
              const tp = d.topics.find((x) => x.classId === classId && x.subjectId === subjectId && x.date === lessonDate);
              if (tp) tp.topic = topic; else d.topics.push({ classId, subjectId, date: lessonDate, topic });
              const hw = d.homework.find((h) => h.classId === classId && h.subjectId === subjectId && h.date === lessonDate);
              if (hw) hw.text = hwText;
              else if (hwText.trim()) d.homework.push({ id: newId("hw"), classId, subjectId, date: lessonDate, text: hwText, done: {} });
            });
            showToast(t("saved"));
            setLessonDate(null);
          }}
        />
      )}
    </>
  );
}

function GradeModal({ studentName, date, existing, onClose, onSave, onDelete }: {
  studentName: string; date: string; existing: { id: string; value: number; kind: GradeKind; comment?: string; aiSuggested?: boolean }[];
  onClose: () => void; onSave: (value: number, kind: GradeKind, comment: string) => void; onDelete: (id: string) => void;
}) {
  const { t, fmtDate } = useI18n();
  const [kind, setKind] = useState<GradeKind>("oral");
  const [comment, setComment] = useState("");
  return (
    <Modal title={`${studentName} · ${fmtDate(date)}`} onClose={onClose}>
      <div className="stack">
        {existing.length > 0 && (
          <div className="list">
            {existing.map((g) => (
              <div key={g.id} className="list-item">
                <GradePill value={g.value} ai={g.aiSuggested} />
                <div className="grow small">{t(`kind_${g.kind}`)}{g.aiSuggested ? ` · ${t("ai_suggested_approved")}` : ""}{g.comment ? ` — ${g.comment}` : ""}</div>
                <button className="btn btn-sm btn-ghost btn-danger" onClick={() => onDelete(g.id)} aria-label={t("delete")}><Icon name="trash" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="field">
          <span className="label">{t("grade_type")}</span>
          <select className="select" style={{ width: "100%" }} value={kind} onChange={(e) => setKind(e.target.value as GradeKind)}>
            {KINDS.map((k) => <option key={k} value={k}>{t(`kind_${k}`)}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="g-comment">{t("comment_optional")}</label>
          <input id="g-comment" className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <span className="label">{t("put_grade")}</span>
        <div className="row">
          {[5, 4, 3, 2].map((v) => (
            <button key={v} className="btn" style={{ padding: 4 }} onClick={() => onSave(v, kind, comment)} aria-label={String(v)}>
              <span className={`grade grade-${v}`} style={{ width: 44, height: 40, fontSize: 18 }}>{v}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function LessonModal({ date, topic, homework, onClose, onSave }: { date: string; topic: string; homework: string; onClose: () => void; onSave: (topic: string, hw: string) => void }) {
  const { t, fmtDate } = useI18n();
  const [tp, setTp] = useState(topic);
  const [hw, setHw] = useState(homework);
  return (
    <Modal title={`${t("lesson")} · ${fmtDate(date)}`} onClose={onClose}>
      <div className="stack">
        <div className="field"><label className="label" htmlFor="l-topic">{t("topic")}</label><input id="l-topic" className="input" value={tp} onChange={(e) => setTp(e.target.value)} /></div>
        <div className="field"><label className="label" htmlFor="l-hw">{t("homework")}</label><textarea id="l-hw" className="textarea" value={hw} onChange={(e) => setHw(e.target.value)} /></div>
        <button className="btn btn-primary" onClick={() => onSave(tp, hw)}><Icon name="device-floppy" />{t("save")}</button>
      </div>
    </Modal>
  );
}
