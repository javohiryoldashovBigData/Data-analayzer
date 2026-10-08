import { Link } from "react-router-dom";
import { useChild, notificationText, NotificationIcon } from "../App";
import { useMe, useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import { addDays, minutes, PERIOD_START, today, weekday } from "../lib/date";
import { className, gateToday, homeworkFor, lessonsOn, studentOf, teacherLessonsOn } from "../lib/queries";
import { attendanceStats, avg, homeworkRate, integrityFlags, integrityStatus, round1, studentAverage, studentRisk } from "../ai/insights";
import { Avatar, Badge, Card, Empty, GradePill, Icon, PageHead, Stat } from "../components/ui";
import { BarList } from "../components/charts";
import ChildSwitcher from "../components/ChildSwitcher";
import type { DB } from "../data/types";

export default function Dashboard() {
  const me = useMe()!;
  if (me.role === "student") return <StudentHome />;
  if (me.role === "parent") return <ParentHome />;
  if (me.role === "teacher") return <TeacherHome />;
  return <DirectorHome />;
}

// ---------------------------------------------------------------- shared

export function LiveStatus({ studentId }: { studentId: string }) {
  const { db } = useStore();
  const { t } = useI18n();
  const g = gateToday(db, studentId);
  const tone = { notArrived: "bad", atSchool: "good", late: "warn", left: "accent", reported: "accent" }[g.state];
  const icon = { notArrived: "alert-triangle", atSchool: "school", late: "clock-exclamation", left: "home", reported: "mail-check" };
  const sunday = weekday(today()) === 7;
  return (
    <div className="row" style={{ gap: 14 }}>
      <span className="tl-icon" style={{ width: 52, height: 52, fontSize: 26, background: `var(--${tone}-soft)`, color: `var(--${tone})` }}>
        <Icon name={icon[g.state]} />
      </span>
      <div>
        <div style={{ fontWeight: 700, fontSize: 18 }}>
          {sunday && g.state === "notArrived" ? t("status_dayoff") : t(`status_${g.state}`, { in: g.in ?? "", out: g.out ?? "" })}
        </div>
        <div className="small muted">
          {g.in && t("arrived_at", { time: g.in })}{g.out && ` · ${t("left_at", { time: g.out })}`}
          {g.state === "reported" && g.report && t(`reason_${g.report.reason}`)}
        </div>
      </div>
    </div>
  );
}

function RecentGrades({ db, studentId, limit = 6 }: { db: DB; studentId: string; limit?: number }) {
  const { t, subj, fmtDate } = useI18n();
  const gs = db.grades.filter((g) => g.studentId === studentId).sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  if (!gs.length) return <Empty>{t("no_grades")}</Empty>;
  return (
    <div className="list">
      {gs.map((g) => (
        <div key={g.id} className="list-item">
          <GradePill value={g.value} ai={g.aiSuggested} />
          <div className="grow">
            <div style={{ fontWeight: 550 }}>{subj(g.subjectId)}</div>
            <div className="small muted">{t(`kind_${g.kind}`)} · {fmtDate(g.date)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TodayLessons({ classId }: { classId: string }) {
  const { db } = useStore();
  const { t, subj } = useI18n();
  const rows = homeworkFor(db, classId, today());
  if (!rows.length) return <Empty icon="beach">{t("no_lessons_today")}</Empty>;
  return (
    <div className="list">
      {rows.map(({ lesson, hw }) => (
        <div key={lesson.id} className="list-item">
          <span className="period-no">{lesson.period}</span>
          <div className="grow">
            <div style={{ fontWeight: 550 }}>{subj(lesson.subjectId)} <span className="small muted">· {PERIOD_START[lesson.period - 1]} · {t("room")} {lesson.room}</span></div>
            {hw && <div className="small muted ellipsis"><Icon name="notebook" /> {hw.text}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- student

function StudentHome() {
  const { db, session } = useStore();
  const { t, subj } = useI18n();
  const st = studentOf(db, session!.id);
  const a = studentAverage(db, st.id);
  const att = attendanceStats(db, st.id);
  const hw = homeworkRate(db, st.id);
  const openTests = db.tests.filter((x) => x.classId === st.classId && x.status === "open" && !db.attempts.some((at) => at.testId === x.id && at.studentId === st.id));
  const bySubject = db.subjects.map((s) => ({ s, v: studentAverage(db, st.id, s.id) })).filter((x) => x.v != null) as { s: DB["subjects"][number]; v: number }[];
  const weakest = [...bySubject].sort((x, y) => x.v - y.v)[0];
  return (
    <>
      <PageHead title={t("hello", { name: st.name.split(" ")[0] })} sub={`${className(db, st.classId)} · ${db.schoolName}`} />
      <div className="grid grid-4">
        <Stat icon="star" label={t("avg_grade")} value={round1(a)} />
        <Stat icon="calendar-check" label={t("attendance")} value={`${att.rate}%`} foot={t("late_n", { n: att.late })} />
        <Stat icon="notebook" label={t("homework_done")} value={hw == null ? "—" : `${hw}%`} />
        <Stat icon="checklist" label={t("open_tests")} value={openTests.length} />
      </div>
      {weakest && (
        <div className="callout callout-ai">
          <Icon name="sparkles" />
          <div className="grow">{t("student_ai_tip", { subject: subj(weakest.s.id), avg: weakest.v.toFixed(1) })} <Link to="/assistant">{t("open_tutor")} →</Link></div>
        </div>
      )}
      <div className="grid grid-2">
        <Card title={t("today_lessons")}><TodayLessons classId={st.classId} /></Card>
        <Card title={t("weekly_tests")} right={<Link className="btn btn-sm" to="/tests">{t("all")}</Link>}>
          {openTests.length === 0 ? <Empty icon="circle-check">{t("no_open_tests")}</Empty> : (
            <div className="list">
              {openTests.map((x) => (
                <div key={x.id} className="list-item">
                  <Icon name="checklist" />
                  <div className="grow"><div style={{ fontWeight: 550 }}>{subj(x.subjectId)}</div><div className="small muted">{t("questions_n", { n: x.questionIds.length })}</div></div>
                  <Link className="btn btn-primary btn-sm" to={`/tests/${x.id}/take`}>{t("start")}</Link>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title={t("recent_grades")}><RecentGrades db={db} studentId={st.id} /></Card>
        <Card title={t("subject_averages")}>
          <BarList items={bySubject.map((x) => ({ label: subj(x.s.id), value: x.v }))} />
        </Card>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- parent

function ParentHome() {
  const { db, session } = useStore();
  const { t, subj, fmtDate } = useI18n();
  const { childId } = useChild();
  const st = studentOf(db, childId);
  const parent = db.parents.find((p) => p.id === session!.id)!;
  const a = studentAverage(db, st.id);
  const att = attendanceStats(db, st.id);
  const hw = homeworkRate(db, st.id);
  const risk = studentRisk(db, st.id);
  const notes = db.notifications.filter((n) => n.userId === parent.id && n.params.student === st.name).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 7);
  return (
    <>
      <PageHead title={t("hello", { name: parent.name.split(" ")[0] })} sub={t("parent_sub", { name: st.name, cls: className(db, st.classId) })} right={<ChildSwitcher />} />
      <div className="grid grid-3">
        <div className="card span-2">
          <div className="card-head"><h2>{t("today_at_school")}</h2><div className="right"><Link className="btn btn-sm" to="/attendance"><Icon name="calendar-plus" />{t("report_absence")}</Link></div></div>
          <LiveStatus studentId={st.id} />
          <div className="row small muted" style={{ marginTop: 14, gap: 14 }}>
            <span><Icon name="bell-ringing" /> {t("alerts_via")}: {[parent.channels.app && t("ch_app"), parent.channels.telegram && "Telegram", parent.channels.sms && "SMS"].filter(Boolean).join(", ")}</span>
          </div>
        </div>
        <Stat icon="shield-heart" label={t("ai_risk")} value={<Badge tone={risk.level === "high" ? "bad" : risk.level === "medium" ? "warn" : "good"}>{t(`risk_${risk.level}`)}</Badge>} foot={risk.reasons.slice(0, 2).map((r) => t(`riskr_${r.key}`, { v: r.value })).join(" · ") || t("all_good")} />
      </div>
      <div className="grid grid-3">
        <Stat icon="star" label={t("avg_grade")} value={round1(a)} />
        <Stat icon="calendar-check" label={t("attendance_30")} value={`${att.rate}%`} foot={`${t("late_n", { n: att.late })} · ${t("skipped_n", { n: att.skipped })}`} />
        <Stat icon="notebook" label={t("homework_done")} value={hw == null ? "—" : `${hw}%`} />
      </div>
      <div className="grid grid-2">
        <Card title={t("recent_events")} right={<Link className="btn btn-sm" to="/attendance">{t("all")}</Link>}>
          {notes.length === 0 ? <Empty>{t("no_notifications")}</Empty> : (
            <div className="timeline">
              {notes.map((n) => (
                <div key={n.id} className="tl-item">
                  <NotificationIcon kind={n.kind} />
                  <div><div className="small">{notificationText(n, t, subj, (d) => fmtDate(d))}</div><div className="small muted">{n.createdAt.slice(5)}</div></div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title={t("recent_grades")} right={<Link className="btn btn-sm" to="/grades">{t("all")}</Link>}><RecentGrades db={db} studentId={st.id} /></Card>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- teacher

function TeacherHome() {
  const { db, session, actions, showToast } = useStore();
  const { t, subj, fmtDate } = useI18n();
  const teacher = db.teachers.find((x) => x.id === session!.id)!;
  const date = today();
  const lessons = teacherLessonsOn(db, teacher.id, date);
  const homeroom = teacher.homeroomClassId;
  const pending = homeroom ? db.absences.filter((a) => a.status === "pending" && studentOf(db, a.studentId).classId === homeroom) : [];
  const alerts = db.notifications.filter((n) => n.userId === teacher.id && (n.kind === "skipped" || n.kind === "notArrived") && n.createdAt >= addDays(date, -7)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const myTests = db.tests.filter((x) => db.lessons.some((l) => l.teacherId === teacher.id && l.classId === x.classId && l.subjectId === x.subjectId));
  const toReview = myTests.flatMap((x) => db.attempts.filter((a) => a.testId === x.id && !a.review && integrityStatus(integrityFlags(db, a)) === "review"));
  const risks = homeroom ? db.students.filter((s) => s.classId === homeroom).map((s) => studentRisk(db, s.id)).filter((r) => r.level !== "low").sort((a, b) => b.points - a.points) : [];
  const nowMin = minutes(new Date().toTimeString().slice(0, 5));

  return (
    <>
      <PageHead title={t("hello", { name: teacher.name.split(" ")[0] })} sub={`${teacher.subjectIds.map(subj).join(", ")}${homeroom ? ` · ${t("homeroom_of", { cls: className(db, homeroom) })}` : ""}`} />
      <div className="grid grid-4">
        <Stat icon="calendar-event" label={t("lessons_today")} value={lessons.length} />
        <Stat icon="mail" label={t("absence_requests")} value={pending.length} />
        <Stat icon="shield-exclamation" label={t("tests_to_review")} value={toReview.length} />
        <Stat icon="alert-triangle" label={t("students_at_risk")} value={risks.length} foot={homeroom ? className(db, homeroom) : undefined} />
      </div>
      <div className="grid grid-2">
        <Card title={t("today_lessons")} sub={fmtDate(date, { weekday: "long", day: "numeric", month: "long" })}>
          {lessons.length === 0 ? <Empty icon="beach">{t("no_lessons_today")}</Empty> : (
            <div className="list">
              {lessons.map((l) => {
                const start = minutes(PERIOD_START[l.period - 1]);
                const live = nowMin >= start && nowMin < start + 45;
                return (
                  <div key={l.id} className="list-item">
                    <span className="period-no">{l.period}</span>
                    <div className="grow">
                      <div style={{ fontWeight: 550 }}>{className(db, l.classId)} · {subj(l.subjectId)} {live && <Badge tone="good">{t("now")}</Badge>}</div>
                      <div className="small muted">{PERIOD_START[l.period - 1]} · {t("room")} {l.room}</div>
                    </div>
                    <Link className="btn btn-sm" to={`/ask-first?class=${l.classId}&subject=${l.subjectId}`} title={t("nav_askfirst")}><Icon name="hand-finger" /></Link>
                    <Link className="btn btn-sm" to={`/attendance?lesson=${l.id}`} title={t("nav_attendance")}><Icon name="calendar-check" /></Link>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <Card title={t("alerts")}>
          {pending.length === 0 && alerts.length === 0 && toReview.length === 0 && <Empty icon="circle-check">{t("no_alerts")}</Empty>}
          <div className="list">
            {pending.map((a) => (
              <div key={a.id} className="list-item">
                <NotificationIcon kind="absenceReported" />
                <div className="grow small">
                  <b>{studentOf(db, a.studentId).name}</b> — {t(`reason_${a.reason}`)} · {fmtDate(a.date)}{a.until ? ` (${t("until")} ${a.until})` : ""}
                  {a.note && <div className="muted">“{a.note}”</div>}
                </div>
                <button className="btn btn-sm btn-primary" onClick={() => { actions.acceptAbsence(a.id); showToast(t("absence_accepted")); }}>{t("accept")}</button>
              </div>
            ))}
            {alerts.map((n) => (
              <div key={n.id} className="list-item">
                <NotificationIcon kind={n.kind} />
                <div className="grow small">{notificationText(n, t, subj, (d) => fmtDate(d))}</div>
              </div>
            ))}
            {toReview.length > 0 && (
              <div className="list-item">
                <NotificationIcon kind="testFlag" />
                <div className="grow small">{t("tests_review_alert", { n: toReview.length })}</div>
                <Link className="btn btn-sm" to="/tests">{t("open")}</Link>
              </div>
            )}
          </div>
        </Card>
      </div>
      {homeroom && (
        <Card title={t("ai_watchlist")} sub={t("ai_watchlist_sub", { cls: className(db, homeroom) })}>
          {risks.length === 0 ? <Empty icon="mood-happy">{t("all_good")}</Empty> : (
            <div className="list">
              {risks.map((r) => {
                const s = studentOf(db, r.studentId);
                return (
                  <Link key={r.studentId} to={`/student/${s.id}`} className="list-item" style={{ color: "inherit", textDecoration: "none" }}>
                    <Avatar name={s.name} />
                    <div className="grow">
                      <div style={{ fontWeight: 550 }}>{s.name}</div>
                      <div className="small muted">{r.reasons.map((x) => t(`riskr_${x.key}`, { v: x.value })).join(" · ")}</div>
                    </div>
                    <Badge tone={r.level === "high" ? "bad" : "warn"}>{t(`risk_${r.level}`)}</Badge>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------- director

function DirectorHome() {
  const { db } = useStore();
  const { t, subj } = useI18n();
  const date = today();
  const states = db.students.map((s) => gateToday(db, s.id, date).state);
  const inside = states.filter((s) => s === "atSchool" || s === "late").length;
  const late = states.filter((s) => s === "late").length;
  const schoolAvg = avg(db.grades.map((g) => g.value));
  const risks = db.students.map((s) => studentRisk(db, s.id)).filter((r) => r.level === "high").sort((a, b) => b.points - a.points);
  const review = db.attempts.filter((a) => !a.review && integrityStatus(integrityFlags(db, a)) === "review").length;
  const hasLessons = db.classes.some((c) => lessonsOn(db, c.id, date).length > 0);

  return (
    <>
      <PageHead title={db.schoolName} sub={t("director_sub")} right={<Link className="btn btn-primary" to="/gate"><Icon name="scan" />{t("nav_gate")}</Link>} />
      <div className="grid grid-4">
        <Stat icon="users" label={t("students")} value={db.students.length} foot={t("classes_n", { n: db.classes.length })} />
        <Stat icon="door-enter" label={t("at_school_now")} value={hasLessons ? `${inside}/${db.students.length}` : "—"} foot={hasLessons ? t("late_today_n", { n: late }) : t("no_lessons_today")} />
        <Stat icon="star" label={t("school_avg")} value={round1(schoolAvg)} />
        <Stat icon="shield-exclamation" label={t("tests_to_review")} value={review} />
      </div>
      <div className="grid grid-2">
        <Card title={t("attendance_by_class")} sub={t("today")}>
          <BarList max={100} format={(v) => `${Math.round(v)}%`} items={db.classes.map((c) => {
            const ss = db.students.filter((s) => s.classId === c.id);
            const present = ss.filter((s) => ["atSchool", "late", "left"].includes(gateToday(db, s.id, date).state)).length;
            return { label: c.name, value: hasLessons ? (present / ss.length) * 100 : null };
          })} />
        </Card>
        <Card title={t("subject_averages")}>
          <BarList items={db.subjects.map((s) => ({ label: subj(s.id), value: avg(db.grades.filter((g) => g.subjectId === s.id).map((g) => g.value)) }))} />
        </Card>
      </div>
      <Card title={t("ai_watchlist")} sub={t("ai_watchlist_school")}>
        {risks.length === 0 ? <Empty icon="mood-happy">{t("all_good")}</Empty> : (
          <div className="list">
            {risks.map((r) => {
              const s = studentOf(db, r.studentId);
              return (
                <Link key={r.studentId} to={`/student/${s.id}`} className="list-item" style={{ color: "inherit", textDecoration: "none" }}>
                  <Avatar name={s.name} />
                  <div className="grow">
                    <div style={{ fontWeight: 550 }}>{s.name} <span className="muted small">· {className(db, s.classId)}</span></div>
                    <div className="small muted">{r.reasons.map((x) => t(`riskr_${x.key}`, { v: x.value })).join(" · ")}</div>
                  </div>
                  <Badge tone="bad">{t("risk_high")}</Badge>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
