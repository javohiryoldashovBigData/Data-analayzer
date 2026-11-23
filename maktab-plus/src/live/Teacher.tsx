// The teacher's day (step 2): My day → lesson card → "after lesson" → Finished for today.
// Every save goes through the tested api.* functions; the database checks authority.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type Home, type Lesson } from "./api";
import type { I18n } from "./i18n";
import { flush, newOpId, pending, saveLesson } from "./queue";
import { Badge, Card, Empty, Icon, PageHead, Stat } from "../components/ui";
import { PrepWeekCard } from "./Step5";

type View = { kind: "home" } | { kind: "card"; lesson: Lesson } | { kind: "after"; lesson: Lesson } | { kind: "close" };
type Ask = { student_id: string; name: string; score: number };
type CardRow = { id: string; topic: string | null; plan: string | null; homework: string | null; status: string; questions: unknown };

export function TeacherHome({ i, home, reload }: { i: I18n; home: Home; reload: () => void }) {
  const [view, setView] = useState<View>({ kind: "home" });
  const [queued, setQueued] = useState(pending().length);
  const back = () => { setView({ kind: "home" }); reload(); window.scrollTo(0, 0); };

  // send lessons saved while offline: now, and whenever the connection comes back
  useEffect(() => {
    const go = () => flush().then((n) => { setQueued(n); if (n === 0 && pending().length === 0) reload(); });
    if (pending().length) go();
    window.addEventListener("online", go);
    return () => window.removeEventListener("online", go);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  if (view.kind === "card") return <LessonCardView i={i} date={home.day!.date} lesson={view.lesson} onBack={back} />;
  if (view.kind === "after") return <AfterLessonView i={i} date={home.day!.date} lesson={view.lesson} onBack={back} onQueued={() => setQueued(pending().length)} />;
  if (view.kind === "close") return <DayCloseView i={i} home={home} onBack={back} />;

  const { t } = i;
  const day = home.day!;
  const done = day.lessons.filter((l) => l.lesson_done).length;
  return (
    <>
      <PageHead title={t("hello", { n: home.me.first_name })} sub={i.date(day.date, true)}
        right={day.closed ? <Badge tone="good" icon="moon">{t("closed_badge")}</Badge> : undefined} />
      {queued > 0 && (
        <div className="callout callout-warn"><Icon name="wifi-off" /><div className="grow">{t("queue_banner", { n: queued })}</div>
          <button className="btn btn-sm" onClick={() => flush().then(setQueued)}>{t("retry")}</button></div>
      )}
      {day.closed && <div className="callout callout-info"><Icon name="moon" /><div>{t("day_closed")}</div></div>}
      {(home.absenceToReview ?? []).length > 0 && <AbsenceReview i={i} list={home.absenceToReview!} reload={reload} />}
      <div className="grid grid-3">
        <Stat icon="calendar" label={t("lessons_today")} value={day.lessons.length} />
        <Stat icon="circle-check" label={t("lessons_done")} value={`${done} / ${day.lessons.length}`} />
        <Stat icon="mail" label={t("absence_pending")} value={day.absence_reports_pending} />
      </div>
      <Card title={t("lessons_today")} sub={i.date(day.date, true)}>
        {day.lessons.length === 0 ? <Empty icon="mug">{t("no_lessons")}</Empty> : (
          <div className="list">{day.lessons.map((l) => (
            <LessonRow key={l.period} i={i} l={l}
              onCard={() => { setView({ kind: "card", lesson: l }); window.scrollTo(0, 0); }}
              onAfter={() => { setView({ kind: "after", lesson: l }); window.scrollTo(0, 0); }} />
          ))}</div>
        )}
      </Card>
      <PrepWeekCard i={i} home={home} />
      {(home.forwarded ?? []).length > 0 && (
        <Card title={t("forwarded_title")} sub={t("forwarded_sub")}>
          <div className="list">{home.forwarded!.map((m) => (
            <div key={m.id} className="list-item" style={{ alignItems: "flex-start" }}><Icon name="message-2" />
              <div className="grow"><b>{m.topic}</b> <span className="small muted">· {m.student} · {i.date(m.created_at)}</span><div className="small">{m.body}</div></div></div>
          ))}</div>
        </Card>
      )}
      {day.lessons.length > 0 && (
        <Card title={t("finish_day")} sub={t("finish_day_sub")}>
          <button className="btn btn-primary" onClick={() => setView({ kind: "close" })}><Icon name="moon" />{t("check_and_finish")}</button>
        </Card>
      )}
    </>
  );
}

function LessonRow({ i, l, onCard, onAfter }: { i: I18n; l: Lesson; onCard: () => void; onAfter: () => void }) {
  const { t } = i;
  const card = l.card ? <Badge tone={l.card.status === "approved" ? "good" : "accent"}>{t(`card_${l.card.status}`)}</Badge> : <Badge>{t("card_none")}</Badge>;
  return (
    <div className="list-item" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
      <span className="period-no">{l.period}</span>
      <div className="grow stack" style={{ gap: 6, minWidth: 220 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <b>{l.class} · {l.subject}</b>
          <span className="small muted">{l.start?.slice(0, 5)}–{l.end?.slice(0, 5)}</span>
          {l.substitution && <Badge tone="warn">{t("substitution")}</Badge>}
          {card}
          {l.lesson_done && <Badge tone="good" icon="check">{t("lesson_done")}</Badge>}
        </div>
        {l.card?.topic && <div className="small muted">{l.card.topic}</div>}
        {l.ask_first.length > 0 && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <span className="small muted"><Icon name="hand-finger" /> {t("ask_first")}:</span>
            {l.ask_first.map((a) => <span key={a.student_id} className="badge">{a.name}</span>)}
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn" onClick={onCard}><Icon name="file-text" />{t("open_card")}</button>
        <button className={`btn ${l.lesson_done ? "" : "btn-primary"}`} onClick={onAfter}>
          <Icon name={l.lesson_done ? "pencil" : "checks"} />{l.lesson_done ? t("edit_after") : t("after_lesson")}
        </button>
      </div>
    </div>
  );
}

function Back({ i, onBack, title, sub }: { i: I18n; onBack: () => void; title: string; sub?: string }) {
  return (
    <div className="row" style={{ gap: 12 }}>
      <button className="btn icon-btn" onClick={onBack} aria-label={i.t("back")}><Icon name="arrow-left" /></button>
      <div style={{ minWidth: 0 }}><h1 style={{ fontSize: 22 }}>{title}</h1>{sub && <p className="muted small">{sub}</p>}</div>
    </div>
  );
}

const openCard = (lesson: Lesson, date: string) =>
  api<{ card: CardRow; exit_check: { questions: string[] } | null; ask_first: Ask[] }>("/teacher/open", {
    method: "POST", body: JSON.stringify({ class_id: lesson.class_id, subject_id: lesson.subject_id, date, period: lesson.period }),
  });

// ---------------------------------------------------------------- lesson card
function LessonCardView({ i, date, lesson, onBack }: { i: I18n; date: string; lesson: Lesson; onBack: () => void }) {
  const { t } = i;
  const [card, setCard] = useState<CardRow | null>(null);
  const [ask, setAsk] = useState<Ask[]>([]);
  const [f, setF] = useState({ topic: "", plan: "", homework: "", q: ["", "", ""] });
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);

  useEffect(() => {
    openCard(lesson, date).then((r) => {
      setCard(r.card); setAsk(r.ask_first ?? []);
      const q = (r.exit_check?.questions ?? []) as string[];
      setF({ topic: r.card.topic ?? "", plan: r.card.plan ?? "", homework: r.card.homework ?? "", q: [q[0] ?? "", q[1] ?? "", q[2] ?? ""] });
    }).catch(() => setErr(t("error")));
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (approve: boolean) => {
    if (!card) return;
    setBusy(true); setMsg(""); setErr("");
    try {
      const r = await api<CardRow>("/teacher/save", { method: "POST", body: JSON.stringify({
        card_id: card.id, approve,
        patch: { topic: f.topic, plan: f.plan, homework: f.homework, exit_questions: f.q.filter((x) => x.trim()) },
      }) });
      setCard(r); setMsg(t("saved"));
    } catch { setErr(t("error")); } finally { setBusy(false); }
  };

  return (
    <>
      <Back i={i} onBack={onBack} title={`${lesson.class} · ${lesson.subject}`} sub={`${i.date(date, true)} · ${lesson.period}-dars · ${lesson.start?.slice(0, 5) ?? ""}`} />
      {!card ? <Card><Empty icon="loader">{err || t("loading")}</Empty></Card> : (
        <div className="grid grid-2" style={{ alignItems: "start" }}>
          <Card title={t("open_card")} right={<Badge tone={card.status === "approved" ? "good" : "accent"}>{t(`card_${card.status}`)}</Badge>}>
            <div className="stack">
              <div className="field"><label className="label" htmlFor="c-topic">{t("topic")}</label>
                <input id="c-topic" className="input" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} /></div>
              <div className="field"><label className="label" htmlFor="c-plan">{t("plan")}</label>
                <textarea id="c-plan" className="textarea" rows={6} placeholder={t("plan_ph")} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} /></div>
              <div className="field"><label className="label" htmlFor="c-hw">{t("homework")}</label>
                <input id="c-hw" className="input" value={f.homework} onChange={(e) => setF({ ...f, homework: e.target.value })} /></div>
              <div className="field"><span className="label">{t("exit_q")}</span>
                {f.q.map((q, k) => (
                  <input key={k} className="input" style={{ marginTop: k ? 6 : 0 }} placeholder={t("exit_q_n", { n: k + 1 })} value={q}
                         onChange={(e) => { const n = [...f.q]; n[k] = e.target.value; setF({ ...f, q: n }); }} />
                ))}</div>
              {err && <div className="callout callout-warn"><Icon name="alert-triangle" /><div>{err}</div></div>}
              {msg && <div className="callout callout-info"><Icon name="check" /><div>{msg}</div></div>}
              <div className="row">
                <button className="btn" disabled={busy} onClick={() => save(false)}><Icon name="device-floppy" />{t("save")}</button>
                <button className="btn btn-primary" disabled={busy} onClick={() => save(true)}><Icon name="circle-check" />{t("approve")}</button>
              </div>
              <p className="small muted"><Icon name="sparkles" /> {t("ai_later")}</p>
            </div>
          </Card>
          <Card title={<span><Icon name="hand-finger" /> {t("ask_first")}</span>}>
            {ask.length === 0 ? <Empty icon="mood-happy">{t("nothing")}</Empty> : (
              <div className="list">{ask.map((a) => <div key={a.student_id} className="list-item"><b className="grow">{a.name}</b><span className="small muted">{a.score}</span></div>)}</div>
            )}
            <p className="small muted" style={{ marginTop: 10 }}><Icon name="lock" /> {t("card_private")}</p>
          </Card>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- after lesson
type Student = { id: string; first_name: string; last_name: string; status: string | null; grades_today: number[] | null; at_school: boolean };
type Mark = "present" | "late" | "absent";
const COMMENTS = ["c1", "c2", "c3", "c4"];

function AfterLessonView({ i, date, lesson, onBack, onQueued }: { i: I18n; date: string; lesson: Lesson; onBack: () => void; onQueued: () => void }) {
  const { t } = i;
  const [data, setData] = useState<{ card: CardRow & { lesson_date: string }; roster: Student[]; exit: { questions: string[]; results: { q: number; got_it: number }[] | null; not_got: string[] } | null; report: { note: string | null } | null } | null>(null);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [grades, setGrades] = useState<Record<string, { value: number; comment: string }>>({});
  const [notGot, setNotGot] = useState<Set<string>>(new Set());
  const [topic, setTopic] = useState(""); const [hw, setHw] = useState(""); const [note, setNote] = useState("");
  const [gotIt, setGotIt] = useState<number[]>([]);
  const [state, setState] = useState<"edit" | "saving" | "sent" | "queued">("edit");
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const c = await openCard(lesson, date);
      const d = await api<NonNullable<typeof data>>(`/teacher/lesson?card=${c.card.id}`);
      setData(d);
      // start from what is already saved; otherwise "here" — except children the gate did not see today
      setMarks(Object.fromEntries(d.roster.map((s) => [s.id, (s.status as Mark) ?? (s.at_school ? "present" : "absent")])));
      setTopic(d.card.topic ?? ""); setHw(lesson.lesson_done ? "" : d.card.homework ?? ""); setNote(d.report?.note ?? "");
      setNotGot(new Set(d.exit?.not_got ?? []));
      setGotIt((d.exit?.questions ?? []).map((_, k) => d.exit?.results?.find((r) => r.q === k + 1)?.got_it ?? 0));
    })().catch(() => setErr(t("error")));
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const v = Object.values(marks);
    return { p: v.filter((m) => m === "present").length, l: v.filter((m) => m === "late").length, a: v.filter((m) => m === "absent").length };
  }, [marks]);
  const here = counts.p + counts.l;

  const submit = async () => {
    if (!data) return;
    setState("saving"); setErr("");
    const ids = (m: Mark) => Object.entries(marks).filter(([, v]) => v === m).map(([k]) => k);
    const questions = data.exit?.questions ?? [];
    const payload = {
      client_op_id: newOpId(),
      absent: ids("absent"), late: ids("late"),
      ...(topic.trim() ? { topic: topic.trim() } : {}),
      ...(hw.trim() ? { homework: { description: hw.trim() } } : {}),
      grades: Object.entries(grades).map(([student_id, g]) => ({ student_id, value: g.value, ...(g.comment ? { comment: t(g.comment) } : {}) })),
      ...(questions.length ? { exit: { results: questions.map((_, k) => ({ q: k + 1, got_it: Math.min(gotIt[k] ?? 0, here), total: here })), not_got: [...notGot] } } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    try {
      const r = await saveLesson({ card_id: data.card.id, payload, label: `${lesson.class} · ${lesson.subject}` });
      setState(r); if (r === "queued") onQueued();
      window.scrollTo(0, 0);
    } catch (e) {
      setState("edit");
      setErr(e instanceof ApiError && e.code === "no_term_for_date" ? t("error") : t("error"));
    }
  };

  const title = `${lesson.class} · ${lesson.subject}`;
  if (state === "sent" || state === "queued") {
    return (
      <>
        <Back i={i} onBack={onBack} title={title} sub={i.date(date, true)} />
        <Card>
          <div className="stack" style={{ alignItems: "center", textAlign: "center", padding: "12px 0" }}>
            <span className="role-icon" style={{ width: 64, height: 64, fontSize: 34, background: state === "sent" ? "var(--good-soft)" : "var(--warn-soft)", color: state === "sent" ? "var(--good)" : "var(--warn)" }}>
              <Icon name={state === "sent" ? "circle-check" : "wifi-off"} /></span>
            <b style={{ fontSize: 18 }}>{state === "sent" ? t("sent_ok") : t("queued_ok")}</b>
            <span className="muted">{t("tally", counts)}</span>
            <button className="btn btn-primary" onClick={onBack}><Icon name="arrow-left" />{t("back")}</button>
          </div>
        </Card>
      </>
    );
  }
  return (
    <>
      <Back i={i} onBack={onBack} title={title} sub={`${i.date(date, true)} · ${lesson.period}-dars`} />
      {!data ? <Card><Empty icon="loader">{err || t("loading")}</Empty></Card> : (
        <>
          <Card title={t("att_and_grades")} right={<span className="small muted">{t("tally", counts)}</span>} sub={t("feedback_rule")}>
            <div className="list">
              {data.roster.map((s) => {
                const m = marks[s.id] ?? "present";
                const g = grades[s.id];
                return (
                  <div key={s.id} className="list-item" style={{ flexWrap: "wrap", gap: 8 }}>
                    <div className="grow" style={{ minWidth: 150 }}>
                      <b>{s.first_name} {s.last_name}</b>
                      {!s.at_school && <div className="small" style={{ color: "var(--warn)" }}><Icon name="door-off" /> {t("no_gate")}</div>}
                      {s.grades_today?.length ? <div className="small muted">{t("given_today")}: {s.grades_today.join(", ")}</div> : null}
                    </div>
                    <div className="seg" role="group" aria-label={t("attendance")}>
                      {(["present", "late", "absent"] as Mark[]).map((k) => (
                        <button key={k} className={m === k ? "active" : ""} onClick={() => setMarks({ ...marks, [s.id]: k })}
                                style={m === k && k === "absent" ? { color: "var(--bad)" } : m === k && k === "late" ? { color: "var(--warn)" } : undefined}>{t(k)}</button>
                      ))}
                    </div>
                    <div className="row" style={{ gap: 4 }} aria-label={t("grades_opt")}>
                      {[5, 4, 3, 2].map((v) => (
                        <button key={v} className="btn btn-sm" disabled={m === "absent"} aria-pressed={g?.value === v}
                                onClick={() => { const n = { ...grades }; if (g?.value === v) delete n[s.id]; else n[s.id] = { value: v, comment: g?.comment ?? "" }; setGrades(n); }}
                                style={{ padding: 2 }}>
                          <span className={`grade grade-${v}`} style={{ width: 30, height: 28, opacity: g && g.value !== v ? 0.35 : 1, outline: g?.value === v ? "2px solid var(--text)" : "none" }}>{v}</span>
                        </button>
                      ))}
                    </div>
                    <button className={`btn btn-sm ${notGot.has(s.id) ? "btn-danger" : "btn-ghost"}`} disabled={m === "absent"}
                            onClick={() => { const n = new Set(notGot); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); setNotGot(n); }}>
                      <Icon name="help-circle" />{t("didnt_get")}
                    </button>
                    {g && (
                      <select className="select" style={{ width: "100%" }} value={g.comment} aria-label={t("comment")}
                              onChange={(e) => setGrades({ ...grades, [s.id]: { ...g, comment: e.target.value } })}>
                        <option value="">{t("no_comment")}</option>
                        {COMMENTS.map((c) => <option key={c} value={c}>{t(c)}</option>)}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
          <Card title={t("lesson_info")}>
            <div className="stack">
              <div className="field"><label className="label" htmlFor="a-topic">{t("topic")}</label>
                <input id="a-topic" className="input" value={topic} onChange={(e) => setTopic(e.target.value)} /></div>
              <div className="field"><label className="label" htmlFor="a-hw">{t("homework")}</label>
                <input id="a-hw" className="input" value={hw} onChange={(e) => setHw(e.target.value)} /></div>
              {(data.exit?.questions ?? []).length > 0 && (
                <div className="field"><span className="label">{t("exit_q")}</span>
                  {data.exit!.questions.map((q, k) => (
                    <div key={k} className="row" style={{ gap: 8, marginTop: 6, flexWrap: "nowrap" }}>
                      <span className="grow small">{k + 1}. {q}</span>
                      <span className="small muted">{t("got_it")}</span>
                      <input className="input" type="number" min={0} max={here} style={{ width: 72 }} value={gotIt[k] ?? 0}
                             onChange={(e) => { const n = [...gotIt]; n[k] = Math.max(0, Math.min(here, Number(e.target.value))); setGotIt(n); }} />
                      <span className="small muted">{t("of_n", { n: here })}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="field"><label className="label" htmlFor="a-note">{t("private_note")}</label>
                <textarea id="a-note" className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
              {err && <div className="callout callout-warn"><Icon name="alert-triangle" /><div>{err}</div></div>}
              <button className="btn btn-primary" disabled={state === "saving"} onClick={submit}>
                <Icon name="checks" />{state === "saving" ? t("saving") : t("finish_save")}
              </button>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- finished for today
type CheckItem = { kind: string; class_id: string | null; period: number | null; ok: boolean };
function DayCloseView({ i, home, onBack }: { i: I18n; home: Home; onBack: () => void }) {
  const { t } = i;
  const day = home.day!;
  const [list, setList] = useState<{ done: number; total: number; items: CheckItem[] } | null>(null);
  const [closed, setClosed] = useState(day.closed);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { api<NonNullable<typeof list>>(`/teacher/checklist?date=${day.date}`).then(setList).catch(() => setErr(t("error"))); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const name = (it: CheckItem) => {
    const l = day.lessons.find((x) => x.class_id === it.class_id && x.period === it.period);
    return l ? `${l.period}. ${l.class} · ${l.subject}` : "";
  };
  const close = async () => {
    setBusy(true); setErr("");
    try { await api("/teacher/close", { method: "POST", body: JSON.stringify({ date: day.date }) }); setClosed(true); }
    catch { setErr(t("error")); } finally { setBusy(false); }
  };
  return (
    <>
      <Back i={i} onBack={onBack} title={t("finish_day")} sub={i.date(day.date, true)} />
      {!list ? <Card><Empty icon="loader">{err || t("loading")}</Empty></Card> : (
        <Card title={`${list.done} / ${list.total}`}>
          <div className="list">{list.items.map((it, k) => (
            <div key={k} className="list-item">
              <Icon name={it.ok ? "circle-check" : "circle-dashed"} className={it.ok ? "" : "muted"} />
              <div className="grow"><span style={{ color: it.ok ? "var(--good)" : undefined }}>{t(`ck_${it.kind}`)}</span>
                {it.class_id && <div className="small muted">{name(it)}</div>}</div>
            </div>
          ))}</div>
          {closed ? (
            <div className="callout callout-info" style={{ marginTop: 14 }}><Icon name="moon" /><div><b>{t("day_closed")}</b></div></div>
          ) : (
            <div className="stack" style={{ marginTop: 14 }}>
              {list.done < list.total && <p className="small muted"><Icon name="info-circle" /> {t("open_items_ok")}</p>}
              {err && <div className="callout callout-warn"><Icon name="alert-triangle" /><div>{err}</div></div>}
              <button className="btn btn-primary" disabled={busy} onClick={close}><Icon name="moon" />{t("finish_day")}</button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------- class teacher: absence reports
function AbsenceReview({ i, list, reload }: { i: I18n; list: NonNullable<Home["absenceToReview"]>; reload: () => void }) {
  const { t } = i;
  const [busy, setBusy] = useState("");
  const decide = async (id: string, status: "accepted" | "rejected") => {
    setBusy(id);
    try { await api("/teacher/absence", { method: "POST", body: JSON.stringify({ id, status }) }); reload(); }
    finally { setBusy(""); }
  };
  return (
    <Card title={t("absence_review")} sub={t("absence_review_sub")}>
      <div className="list">{list.map((r) => (
        <div key={r.id} className="list-item" style={{ flexWrap: "wrap" }}>
          <Icon name="calendar-x" />
          <div className="grow" style={{ minWidth: 180 }}><b>{r.first_name} {r.last_name}</b> <span className="small muted">· {r.class} · {i.date(r.absence_date, true)}</span>
            {r.reason && <div className="small">{r.reason}</div>}</div>
          <button className="btn btn-primary btn-sm" disabled={busy === r.id} onClick={() => decide(r.id, "accepted")}><Icon name="check" />{t("accept")}</button>
          <button className="btn btn-sm" disabled={busy === r.id} onClick={() => decide(r.id, "rejected")}><Icon name="x" />{t("reject")}</button>
        </div>
      ))}</div>
    </Card>
  );
}
