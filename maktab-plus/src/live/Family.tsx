// Parents and students (step 3): home, diary week, messages to the school office,
// absence reports. Every write is checked by the database (own child only).
import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type DiaryLesson, type Home, type Kid } from "./api";
import type { I18n } from "./i18n";
import { StudentTests } from "./Step4";
import { ReviewCards } from "./Step5";
import { Avatar, Badge, Card, Empty, GradePill, Icon, PageHead, Segmented, Stat, Tabs } from "../components/ui";

type Tab = "home" | "diary" | "messages" | "tests";
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (s: string, n: number) => { const [y, m, d] = s.split("-").map(Number); return iso(new Date(y, m - 1, d + n)); };
const monday = (s: string) => { const [y, m, d] = s.split("-").map(Number); const dt = new Date(y, m - 1, d); return addDays(s, -((dt.getDay() + 6) % 7)); };
const todayIso = () => iso(new Date());
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function FamilyHome({ i, home, reload }: { i: I18n; home: Home; reload: () => void }) {
  const { t } = i;
  const kids = home.kids ?? [];
  const isParent = home.role === "parent";
  const [kidId, setKidId] = useState(kids[0]?.id ?? "");
  const [tab, setTab] = useState<Tab>("home");
  const [modal, setModal] = useState<"absence" | "message" | null>(null);
  const [toast, setToast] = useState("");
  const kid = kids.find((k) => k.id === kidId) ?? kids[0];
  if (!kid) return <Card><Empty>{t("nothing")}</Empty></Card>;
  const done = (msg: string) => { setModal(null); setToast(msg); reload(); setTimeout(() => setToast(""), 4000); };

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "home", label: t("tab_home"), icon: "home" },
    { id: "diary", label: t("tab_diary"), icon: "notebook" },
    ...(isParent ? [{ id: "messages" as Tab, label: t("tab_messages"), icon: "messages" }] : []),
    ...(home.role === "student" ? [{ id: "tests" as Tab, label: t("tab_tests"), icon: "checklist" }] : []),
  ];
  return (
    <>
      <PageHead title={t("hello", { n: home.me.first_name })} sub={`${kid.first_name} ${kid.last_name} · ${kid.class}`}
        right={kids.length > 1 ? <Segmented value={kid.id} onChange={setKidId} items={kids.map((k) => ({ id: k.id, label: `${k.first_name} · ${k.class}` }))} /> : undefined} />
      {isParent && (
        <div className="row">
          <button className="btn btn-primary" onClick={() => setModal("absence")}><Icon name="calendar-x" />{t("report_absence")}</button>
          <button className="btn" onClick={() => setModal("message")}><Icon name="message-2" />{t("write_office")}</button>
        </div>
      )}
      {toast && <div className="callout callout-info"><Icon name="check" /><div>{toast}</div></div>}
      <Tabs value={tab} onChange={setTab} items={tabs} />
      {tab === "home" && <KidView i={i} home={home} kid={kid} isParent={isParent} />}
      {tab === "diary" && <DiaryWeek i={i} home={home} kid={kid} />}
      {tab === "tests" && <StudentTests i={i} />}
      {tab === "messages" && <Messages i={i} home={home} kid={kid} onWrite={() => setModal("message")} />}
      {modal === "absence" && <AbsenceForm i={i} kid={kid} onClose={() => setModal(null)} onDone={() => done(t("absence_sent"))} />}
      {modal === "message" && <MessageForm i={i} home={home} kid={kid} onClose={() => setModal(null)} onDone={() => done(t("message_sent"))} />}
    </>
  );
}

// ---------------------------------------------------------------- home tab
function KidView({ i, home, kid, isParent }: { i: I18n; home: Home; kid: Kid; isParent: boolean }) {
  // topic reviews (AI, only for children who didn't get a topic) are shown first
  const { t } = i;
  const gate = (home.gateToday ?? []).filter((g) => g.student_id === kid.id);
  const last = gate[gate.length - 1];
  const grades = (home.grades ?? []).filter((g) => g.student_id === kid.id);
  const avg = grades.length ? grades.reduce((s, g) => s + g.value, 0) / grades.length : null;
  const att = (home.attendance ?? []).find((a) => a.student_id === kid.id);
  const rate = att && att.total ? Math.round((100 * att.present) / att.total) : null;
  const hw = (home.homework ?? []).filter((h) => h.class_id === kid.class_id);
  const teachers = dedupeTeachers((home.teachers ?? []).filter((x) => x.student_id === kid.id));
  const reports = (home.absenceReports ?? []).filter((r) => r.student_id === kid.id);
  return (
    <>
      <ReviewCards i={i} home={home} kid={kid} />
      <div className="grid grid-3">
        <Card title={t("at_school_today")}>
          <div className="row" style={{ gap: 14 }}>
            <span className="role-icon" style={{ width: 52, height: 52, fontSize: 26, background: last ? "var(--good-soft)" : "var(--warn-soft)", color: last ? "var(--good)" : "var(--warn)" }}>
              <Icon name={last ? (last.direction === "in" ? "door-enter" : "door-exit") : "clock"} />
            </span>
            <b style={{ fontSize: 17 }}>{last ? t(last.direction === "in" ? "arrived" : "left", { t: i.time(last.scanned_at) }) : t("not_arrived")}</b>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}><Icon name="shield-lock" /> {t("gate_note")}</p>
        </Card>
        <Stat icon="star" label={t("avg_grade")} value={avg ? avg.toFixed(1) : "—"} />
        <Stat icon="calendar-check" label={t("attendance30")} value={rate != null ? `${rate}%` : "—"} foot={att ? t("late_absent", { l: att.late, a: att.absent }) : undefined} />
      </div>
      <div className="grid grid-2">
        <Card title={t("homework")}>
          {hw.length === 0 ? <Empty icon="notebook">{t("nothing")}</Empty> : (
            <div className="list">{hw.map((h, k) => (
              <div key={k} className="list-item"><Icon name="notebook" /><div className="grow"><b>{h.subject}</b><div className="small">{h.description}</div></div>
                <span className="small muted">{t("due", { d: i.date(h.due_date) })}</span></div>))}</div>
          )}
        </Card>
        <Card title={t("recent_grades")}>
          {grades.length === 0 ? <Empty icon="star">{t("nothing")}</Empty> : (
            <div className="list">{grades.slice(0, 8).map((g, k) => (
              <div key={k} className="list-item"><GradePill value={g.value} /><div className="grow"><b>{g.subject}</b>{g.comment && <div className="small muted">{g.comment}</div>}</div>
                <span className="small muted">{i.date(g.created_at)}</span></div>))}</div>
          )}
        </Card>
      </div>
      <div className="grid grid-2">
        <Card title={t("teachers")}>
          <div className="list">{teachers.map((x) => (
            <div key={x.teacher_id} className="list-item"><Avatar name={`${x.first_name} ${x.last_name}`} />
              <div className="grow"><b>{x.first_name} {x.last_name}</b><div className="small muted">{x.subjects.join(", ")}</div></div>
              {x.is_class_teacher && <Badge tone="brand">{t("class_teacher")}</Badge>}</div>))}</div>
          <p className="small muted" style={{ marginTop: 10 }}><Icon name="building" /> {t("contact_office")}</p>
        </Card>
        {isParent && (
          <Card title={t("absence_reports")}>
            {reports.length === 0 ? <Empty icon="calendar-off">{t("nothing")}</Empty> : (
              <div className="list">{reports.map((r) => (
                <div key={r.id} className="list-item"><Icon name="calendar-off" /><div className="grow"><b>{i.date(r.absence_date, true)}</b><div className="small muted">{r.reason}</div></div>
                  <Badge tone={r.status === "accepted" ? "good" : r.status === "rejected" ? "bad" : "warn"}>{t(`st_${r.status}`)}</Badge></div>))}</div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
export function dedupeTeachers(rows: NonNullable<Home["teachers"]>) {
  const m = new Map<string, { teacher_id: string; first_name: string; last_name: string; subjects: string[]; is_class_teacher: boolean }>();
  for (const r of rows) {
    const e = m.get(r.teacher_id) ?? { teacher_id: r.teacher_id, first_name: r.first_name, last_name: r.last_name, subjects: [], is_class_teacher: false };
    if (r.subject && !e.subjects.includes(r.subject)) e.subjects.push(r.subject);
    e.is_class_teacher ||= r.is_class_teacher;
    m.set(r.teacher_id, e);
  }
  return [...m.values()].sort((a, b) => Number(b.is_class_teacher) - Number(a.is_class_teacher));
}

// ---------------------------------------------------------------- diary tab
function DiaryWeek({ i, home, kid }: { i: I18n; home: Home; kid: Kid }) {
  const { t } = i;
  const [start, setStart] = useState(monday(todayIso()));
  const [rows, setRows] = useState<DiaryLesson[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setRows(null); setErr("");
    api<DiaryLesson[]>(`/family/week?class=${kid.class_id}&start=${start}`).then(setRows).catch(() => setErr(t("error")));
  }, [kid.class_id, start]);  // eslint-disable-line react-hooks/exhaustive-deps
  const days = Array.from({ length: 6 }, (_, k) => addDays(start, k));
  const grades = (home.grades ?? []).filter((g) => g.student_id === kid.id);
  const hw = (home.homework ?? []).filter((h) => h.class_id === kid.class_id);
  return (
    <>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn icon-btn" onClick={() => setStart(addDays(start, -7))} aria-label={t("prev_week")}><Icon name="chevron-left" /></button>
        <button className="btn" onClick={() => setStart(monday(todayIso()))}>{i.date(start)} – {i.date(addDays(start, 5))}</button>
        <button className="btn icon-btn" onClick={() => setStart(addDays(start, 7))} aria-label={t("next_week")}><Icon name="chevron-right" /></button>
      </div>
      {!rows ? <Card><Empty icon="loader">{err || t("loading")}</Empty></Card> : (
        <div className="grid grid-3">
          {days.map((d) => {
            const lessons = rows.filter((r) => r.date === d);
            return (
              <Card key={d} className="day-card" title={cap(i.date(d, true))} right={d === todayIso() ? <Badge tone="brand">{t("today")}</Badge> : undefined}>
                {lessons.length === 0 ? <Empty icon="sun">{t("no_lessons_day")}</Empty> : lessons.map((l) => {
                  const g = grades.filter((x) => x.subject === l.subject && x.created_at.slice(0, 10) === d);
                  const h = hw.filter((x) => x.subject === l.subject && x.due_date === addDays(d, 2));
                  return (
                    <div key={l.period} className="lesson">
                      <span className="period-no">{l.period}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{l.subject} <span className="small muted">{l.start?.slice(0, 5)}</span></div>
                        {l.topic && <div className="small muted">{l.topic}</div>}
                        {h.map((x, k) => <div key={k} className="small" style={{ marginTop: 2 }}><Icon name="notebook" /> {x.description}</div>)}
                      </div>
                      <div className="row" style={{ gap: 4 }}>{g.map((x, k) => <GradePill key={k} value={x.value} small title={x.comment ?? undefined} />)}</div>
                    </div>
                  );
                })}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- messages tab
function Messages({ i, home, kid, onWrite }: { i: I18n; home: Home; kid: Kid; onWrite: () => void }) {
  const { t } = i;
  const list = (home.messages ?? []).filter((m) => m.student_id === kid.id);
  return (
    <Card title={t("tab_messages")} sub={t("contact_office")} right={<button className="btn btn-sm" onClick={onWrite}><Icon name="plus" />{t("write_office")}</button>}>
      {list.length === 0 ? <Empty icon="messages">{t("nothing")}</Empty> : (
        <div className="list">{list.map((m) => (
          <div key={m.id} className="list-item" style={{ alignItems: "flex-start" }}>
            <Icon name="message-2" />
            <div className="grow stack" style={{ gap: 4, minWidth: 0 }}>
              <div className="row between" style={{ flexWrap: "wrap", gap: 6 }}><b>{m.topic}</b>
                <Badge tone={m.status === "answered" ? "good" : m.status === "forwarded" ? "accent" : m.status === "closed" ? "" : "warn"}>{t(`ms_${m.status}`)}</Badge></div>
              <span className="small muted">{i.date(m.created_at)}</span>
              <div className="small">{m.body}</div>
              {m.reply && <div className="callout callout-info small"><Icon name="building" /><div><b>{t("office_reply")}:</b> {m.reply}</div></div>}
            </div>
          </div>
        ))}</div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- forms
// Own small dialog (the prototype's Modal depends on the prototype's i18n context).
export function Dialog({ title, onClose, closeLabel, children }: { title: ReactNode; onClose: () => void; closeLabel: string; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label={closeLabel}><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
function AbsenceForm({ i, kid, onClose, onDone }: { i: I18n; kid: Kid; onClose: () => void; onDone: () => void }) {
  const { t } = i;
  const [date, setDate] = useState(addDays(todayIso(), 1));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const send = async () => {
    setBusy(true); setErr("");
    try { await api("/family/absence", { method: "POST", body: JSON.stringify({ student_id: kid.id, date, reason }) }); onDone(); }
    catch (e) { setErr(e instanceof ApiError && e.status === 403 ? t("absence_denied") : t("error")); } finally { setBusy(false); }
  };
  return (
    <Dialog title={`${t("report_absence")} · ${kid.first_name}`} onClose={onClose} closeLabel={t("cancel")}>
      <div className="stack">
        <div className="field"><label className="label" htmlFor="ab-date">{t("which_day")}</label>
          <input id="ab-date" className="input" type="date" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label className="label" htmlFor="ab-reason">{t("reason")}</label>
          <textarea id="ab-reason" className="textarea" rows={3} maxLength={500} placeholder={t("reason_ph")} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <p className="small muted"><Icon name="info-circle" /> {t("absence_how")}</p>
        {err && <div className="callout callout-warn"><Icon name="alert-triangle" /><div>{err}</div></div>}
        <button className="btn btn-primary" disabled={busy || !date || !reason.trim()} onClick={send}><Icon name="send" />{t("send")}</button>
      </div>
    </Dialog>
  );
}

function MessageForm({ i, home, kid, onClose, onDone }: { i: I18n; home: Home; kid: Kid; onClose: () => void; onDone: () => void }) {
  const { t } = i;
  const teachers = dedupeTeachers((home.teachers ?? []).filter((x) => x.student_id === kid.id));
  const [about, setAbout] = useState("");
  const [topic, setTopic] = useState(""); const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const send = async () => {
    setBusy(true); setErr("");
    try {
      await api("/family/message", { method: "POST", body: JSON.stringify({ student_id: kid.id, topic, body, about_teacher_id: about || undefined }) });
      onDone();
    } catch { setErr(t("error")); } finally { setBusy(false); }
  };
  return (
    <Dialog title={t("write_office")} onClose={onClose} closeLabel={t("cancel")}>
      <div className="stack">
        <p className="small muted"><Icon name="building" /> {t("office_explain")}</p>
        <div className="field"><label className="label" htmlFor="m-about">{t("about_teacher")}</label>
          <select id="m-about" className="select" style={{ width: "100%" }} value={about} onChange={(e) => setAbout(e.target.value)}>
            <option value="">{t("about_general")}</option>
            {teachers.map((x) => <option key={x.teacher_id} value={x.teacher_id}>{x.first_name} {x.last_name} · {x.subjects.join(", ")}</option>)}
          </select></div>
        <div className="field"><label className="label" htmlFor="m-topic">{t("msg_topic")}</label>
          <input id="m-topic" className="input" maxLength={120} value={topic} onChange={(e) => setTopic(e.target.value)} /></div>
        <div className="field"><label className="label" htmlFor="m-body">{t("msg_body")}</label>
          <textarea id="m-body" className="textarea" rows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} /></div>
        {err && <div className="callout callout-warn"><Icon name="alert-triangle" /><div>{err}</div></div>}
        <button className="btn btn-primary" disabled={busy || !topic.trim() || !body.trim()} onClick={send}><Icon name="send" />{t("send")}</button>
      </div>
    </Dialog>
  );
}
