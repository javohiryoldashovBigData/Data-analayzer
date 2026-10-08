import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useChild } from "../App";
import { useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import { addDays, minutes, PERIOD_START, today, weekday } from "../lib/date";
import { className, gateToday, lessonsOn, studentOf, teacherLessonsOn } from "../lib/queries";
import { attendanceStats } from "../ai/insights";
import type { AbsenceReason, AttendanceStatus } from "../data/types";
import { Avatar, Badge, Card, Empty, Icon, PageHead, Segmented, Stat } from "../components/ui";
import ChildSwitcher from "../components/ChildSwitcher";
import { LiveStatus } from "./Dashboard";

export default function AttendancePage() {
  const { session } = useStore();
  if (session!.role === "teacher") return <LessonAttendance />;
  if (session!.role === "director") return <SchoolAttendance />;
  return <FamilyAttendance />;
}

// ---------------------------------------------------------------- parent / student

function FamilyAttendance() {
  const { db, session, actions, update, showToast } = useStore();
  const { t, fmtDate } = useI18n();
  const { childId } = useChild();
  const st = studentOf(db, childId);
  const isParent = session!.role === "parent";
  const parent = db.parents.find((p) => p.id === session!.id);
  const stats = attendanceStats(db, st.id, 30);
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState<AbsenceReason>("sick");
  const [note, setNote] = useState("");
  const [until, setUntil] = useState("");
  const [partial, setPartial] = useState(false);

  const days: string[] = [];
  for (let d = today(), i = 0; i < 21; i++, d = addDays(d, -1)) if (weekday(d) !== 7) days.push(d);
  const reports = db.absences.filter((a) => a.studentId === st.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);

  const submit = () => {
    actions.reportAbsence(st.id, parent!.id, date, reason, note.trim(), partial && until ? until : undefined);
    setNote("");
    showToast(t("absence_sent"));
  };

  return (
    <>
      <PageHead title={t("nav_attendance_live")} sub={`${st.name} · ${className(db, st.classId)}`} right={<ChildSwitcher />} />
      <div className="grid grid-3">
        <div className="card span-2"><div className="card-head"><h2>{t("today_at_school")}</h2></div><LiveStatus studentId={st.id} /></div>
        <Stat icon="calendar-check" label={t("attendance_30")} value={`${stats.rate}%`} foot={`${t("late_n", { n: stats.late })} · ${t("absent_days_n", { n: stats.absentDays })} · ${t("skipped_n", { n: stats.skipped })}`} />
      </div>

      <div className="grid grid-2">
        {isParent && (
          <Card title={t("report_absence")} sub={t("report_absence_sub")}>
            <div className="stack">
              <div className="grid grid-2" style={{ gap: 10 }}>
                <div className="field"><label className="label" htmlFor="ab-date">{t("date")}</label>
                  <input id="ab-date" className="input" type="date" value={date} min={today()} onChange={(e) => setDate(e.target.value)} /></div>
                <div className="field"><label className="label" htmlFor="ab-reason">{t("reason")}</label>
                  <select id="ab-reason" className="select" style={{ width: "100%" }} value={reason} onChange={(e) => setReason(e.target.value as AbsenceReason)}>
                    {(["sick", "doctor", "family", "other"] as const).map((r) => <option key={r} value={r}>{t(`reason_${r}`)}</option>)}
                  </select></div>
              </div>
              <label className="row small" style={{ gap: 8 }}>
                <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} /> {t("partial_day")}
              </label>
              {partial && (
                <div className="field"><label className="label" htmlFor="ab-until">{t("comes_at")}</label>
                  <input id="ab-until" className="input" type="time" value={until} onChange={(e) => setUntil(e.target.value)} /></div>
              )}
              <div className="field"><label className="label" htmlFor="ab-note">{t("note_optional")}</label>
                <textarea id="ab-note" className="textarea" style={{ minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("note_ph")} /></div>
              <button className="btn btn-primary" onClick={submit}><Icon name="send" />{t("send_to_teacher")}</button>
              {reports.length > 0 && (
                <div className="list">
                  {reports.map((r) => (
                    <div key={r.id} className="list-item small">
                      <div className="grow">{fmtDate(r.date)} · {t(`reason_${r.reason}`)}{r.until ? ` (${t("until")} ${r.until})` : ""}</div>
                      <Badge tone={r.status === "accepted" ? "good" : "warn"}>{t(`abs_${r.status}`)}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

        {isParent && parent && (
          <Card title={t("alert_settings")} sub={t("alert_settings_sub")}>
            <div className="stack">
              {([["app", "device-mobile", t("ch_app")], ["telegram", "brand-telegram", "Telegram"], ["sms", "message", "SMS"]] as const).map(([k, icon, label]) => (
                <label key={k} className="row between" style={{ padding: "6px 0" }}>
                  <span className="row"><Icon name={icon} /> {label}</span>
                  <input type="checkbox" checked={parent.channels[k]} onChange={(e) => update((d) => { d.parents.find((p) => p.id === parent.id)!.channels[k] = e.target.checked; })} />
                </label>
              ))}
              <div className="callout callout-info small"><Icon name="lock" /><div>{t("privacy_note")}</div></div>
            </div>
          </Card>
        )}
      </div>

      <Card title={t("arrival_log")} sub={t("arrival_log_sub")}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t("date")}</th><th>{t("arrival")}</th><th>{t("leaving")}</th><th>{t("lessons")}</th></tr></thead>
            <tbody>
              {days.map((d) => {
                const g = gateToday(db, st.id, d);
                const marks = db.marks.filter((m) => m.studentId === st.id && m.date === d);
                const lessons = lessonsOn(db, st.classId, d);
                const late = g.in && minutes(g.in) > minutes(db.settings.lateAfter);
                return (
                  <tr key={d}>
                    <td style={{ textTransform: "capitalize" }}>{fmtDate(d, { weekday: "short", day: "numeric", month: "short" })}</td>
                    <td className="tnum">{g.in ? <Badge tone={late ? "warn" : "good"} icon={late ? "clock-exclamation" : "door-enter"}>{g.in}</Badge> : g.report ? <Badge tone="accent">{t(`reason_${g.report.reason}`)}</Badge> : d === today() ? <span className="muted">—</span> : <Badge tone="bad">{t("not_at_school")}</Badge>}</td>
                    <td className="tnum">{g.out ?? <span className="muted">—</span>}</td>
                    <td>
                      {marks.filter((m) => m.status !== "late").length === 0 ? (
                        g.in ? <span className="small muted">{t("all_lessons", { n: lessons.length })}</span> : null
                      ) : (
                        <div className="row" style={{ gap: 4 }}>
                          {marks.filter((m) => m.status !== "late").map((m) => {
                            const l = db.lessons.find((x) => x.id === m.lessonId);
                            const skipped = m.status === "absent" && !!g.in;
                            return <Badge key={m.id} tone={skipped ? "bad" : m.status === "excused" ? "accent" : "warn"}>{l?.period}. {skipped ? t("skipped") : t(`mark_${m.status}`)}</Badge>;
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- teacher

function LessonAttendance() {
  const { db, session, actions } = useStore();
  const { t, subj } = useI18n();
  const [params, setParams] = useSearchParams();
  const date = today();
  const myLessons = teacherLessonsOn(db, session!.id, date);
  const lessonId = params.get("lesson") ?? myLessons[0]?.id ?? "";
  const lesson = db.lessons.find((l) => l.id === lessonId);

  if (!lesson) {
    return (
      <>
        <PageHead title={t("nav_attendance")} />
        <Card><Empty icon="beach">{t("no_lessons_today")}</Empty></Card>
      </>
    );
  }
  const students = db.students.filter((s) => s.classId === lesson.classId);
  const statusOf = (sid: string): AttendanceStatus | "present" => db.marks.find((m) => m.studentId === sid && m.date === date && m.lessonId === lesson.id)?.status ?? "present";
  const present = students.filter((s) => statusOf(s.id) === "present" || statusOf(s.id) === "late").length;

  return (
    <>
      <PageHead title={t("nav_attendance")} sub={`${className(db, lesson.classId)} · ${subj(lesson.subjectId)} · ${lesson.period}-${t("lesson")} (${PERIOD_START[lesson.period - 1]})`}
        right={myLessons.length > 1 && (
          <select className="select" value={lesson.id} onChange={(e) => setParams({ lesson: e.target.value })} aria-label={t("lesson")}>
            {myLessons.map((l) => <option key={l.id} value={l.id}>{l.period}. {className(db, l.classId)} · {subj(l.subjectId)}</option>)}
          </select>
        )} />
      <div className="callout callout-info"><Icon name="info-circle" /><div>{t("lesson_att_hint")}</div></div>
      <Card title={t("present_n", { n: present, total: students.length })}>
        <div className="list">
          {students.map((s) => {
            const g = gateToday(db, s.id, date);
            const status = statusOf(s.id);
            return (
              <div key={s.id} className="list-item">
                <Avatar name={s.name} />
                <div className="grow">
                  <Link to={`/student/${s.id}`} style={{ fontWeight: 550, color: "inherit", textDecoration: "none" }}>{s.name}</Link>
                  <div className="small muted">
                    {g.in ? <><Icon name="door-enter" /> {t("gate_in_at", { time: g.in })}</> : g.report ? <><Icon name="mail" /> {t("parent_reported", { reason: t(`reason_${g.report.reason}`) })}</> : <><Icon name="door-off" /> {t("no_gate_scan")}</>}
                  </div>
                </div>
                <Segmented
                  value={status}
                  onChange={(v) => actions.setMark(s.id, date, lesson.id, v === "present" ? null : v)}
                  items={[
                    { id: "present", label: t("mark_present_short") },
                    { id: "late", label: t("mark_late_short") },
                    { id: "absent", label: t("mark_absent_short") },
                    { id: "excused", label: t("mark_excused_short") },
                  ]}
                />
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- director

function SchoolAttendance() {
  const { db, actions, showToast } = useStore();
  const { t, subj, fmtDate } = useI18n();
  const [classId, setClassId] = useState(db.classes[0].id);
  const date = today();
  const students = db.students.filter((s) => s.classId === classId);
  const counts = { atSchool: 0, late: 0, left: 0, notArrived: 0, reported: 0 };
  db.students.forEach((s) => { counts[gateToday(db, s.id, date).state]++; });
  const skipped = db.notifications.filter((n) => n.kind === "skipped" && db.teachers.some((tc) => tc.id === n.userId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);

  return (
    <>
      <PageHead title={t("nav_attendance")} sub={fmtDate(date, { weekday: "long", day: "numeric", month: "long" })}
        right={<>
          <button className="btn" onClick={() => { const n = actions.checkMissing(); showToast(t("missing_notified", { n })); }}><Icon name="bell-ringing" />{t("notify_missing")}</button>
          <Link className="btn btn-primary" to="/gate"><Icon name="scan" />{t("nav_gate")}</Link>
        </>} />
      <div className="grid grid-4">
        <Stat icon="school" label={t("st_atSchool")} value={counts.atSchool + counts.late} foot={t("late_today_n", { n: counts.late })} />
        <Stat icon="door-exit" label={t("st_left")} value={counts.left} />
        <Stat icon="mail-check" label={t("st_reported")} value={counts.reported} />
        <Stat icon="alert-triangle" label={t("st_notArrived")} value={counts.notArrived} />
      </div>
      <div className="grid grid-3">
        <div className="card span-2">
          <div className="card-head"><h2>{t("class_today")}</h2>
            <div className="right"><Segmented value={classId} onChange={setClassId} items={db.classes.map((c) => ({ id: c.id, label: c.name }))} /></div></div>
          <div className="list">
            {students.map((s) => {
              const g = gateToday(db, s.id, date);
              const tone = { notArrived: "bad", atSchool: "good", late: "warn", left: "accent", reported: "accent" } as const;
              return (
                <div key={s.id} className="list-item">
                  <Avatar name={s.name} />
                  <div className="grow"><Link to={`/student/${s.id}`} style={{ color: "inherit", textDecoration: "none", fontWeight: 550 }}>{s.name}</Link>
                    <div className="small muted">{s.cardCode}</div></div>
                  <span className="small tnum muted">{g.in ?? ""}{g.out ? ` → ${g.out}` : ""}</span>
                  <Badge tone={tone[g.state]}>{t(`st_${g.state}`)}</Badge>
                </div>
              );
            })}
          </div>
        </div>
        <Card title={t("skipped_lessons")} sub={t("skipped_lessons_sub")}>
          {skipped.length === 0 ? <Empty icon="circle-check">{t("no_alerts")}</Empty> : (
            <div className="list">
              {skipped.map((n) => (
                <div key={n.id} className="list-item small">
                  <Icon name="run" />
                  <div className="grow"><b>{n.params.student}</b><div className="muted">{subj(n.params.subject)} · {n.params.period}-{t("lesson")} · {fmtDate(n.params.date)}</div></div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
