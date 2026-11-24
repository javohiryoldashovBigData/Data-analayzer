// Step 4: My class (class teacher), weekly tests (teacher + student),
// zavuch's daily check and problem actions. All data is filtered by the database.
import { useEffect, useState } from "react";
import { api, type Home } from "./api";
import type { I18n } from "./i18n";
import { Badge, Card, Empty, Icon, Progress, Tabs } from "../components/ui";
import { TeacherHome } from "./Teacher";
import { TeacherGrades } from "./Step6";

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
function useLoad<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState(false);
  const reload = () => { if (!path) return; setErr(false); api<T>(path).then(setData).catch(() => setErr(true)); };
  useEffect(reload, [path, ...deps]);  // eslint-disable-line react-hooks/exhaustive-deps
  return { data, err, reload };
}
const Loading = ({ i, err }: { i: I18n; err: boolean }) => <Card><Empty icon="loader">{err ? i.t("error") : i.t("loading")}</Empty></Card>;

// ---------------------------------------------------------------- teacher area with tabs
type TTab = "day" | "class" | "tests" | "grades";
export function TeacherArea({ i, home, reload }: { i: I18n; home: Home; reload: () => void }) {
  const { t } = i;
  const [tab, setTab] = useState<TTab>("day");
  const items = [
    { id: "day" as TTab, label: t("tab_my_day"), icon: "calendar" },
    ...(home.isClassTeacher ? [{ id: "class" as TTab, label: t("tab_my_class"), icon: "users" }] : []),
    { id: "tests" as TTab, label: t("tab_tests"), icon: "checklist" },
    { id: "grades" as TTab, label: t("tab_grades"), icon: "certificate" },
  ];
  return (
    <>
      <Tabs value={tab} onChange={setTab} items={items} />
      {tab === "day" && <TeacherHome i={i} home={home} reload={reload} />}
      {tab === "class" && <MyClass i={i} />}
      {tab === "tests" && <TeacherTests i={i} home={home} />}
      {tab === "grades" && <TeacherGrades i={i} home={home} />}
    </>
  );
}

// ---------------------------------------------------------------- My class
type MCStudent = { id: string; first_name: string; last_name: string; present: number; total: number; absent14: number; late30: number;
  avg_recent: number | null; avg_before: number | null; signals: string[] };
function MyClass({ i }: { i: I18n }) {
  const { t } = i;
  const { data, err } = useLoad<{ class: string; students: MCStudent[] }>("/teacher/myclass");
  if (!data) return <Loading i={i} err={err} />;
  return (
    <Card title={`${t("tab_my_class")} · ${data.class}`} sub={t("mc_sub")}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t("mc_student")}</th><th className="center">{t("mc_att")}</th><th className="center">{t("mc_abs14")}</th>
            <th className="center">{t("mc_grades")}</th><th></th></tr></thead>
          <tbody>{data.students.map((s) => {
            const rate = s.total ? Math.round((100 * s.present) / s.total) : null;
            const trend = s.avg_recent != null && s.avg_before != null ? s.avg_recent - s.avg_before : 0;
            return (
              <tr key={s.id}>
                <td><b>{s.first_name} {s.last_name}</b></td>
                <td className="center tnum">{rate != null ? `${rate}%` : "—"}</td>
                <td className="center tnum" style={{ color: s.absent14 >= 3 ? "var(--bad)" : undefined }}>{s.absent14}</td>
                <td className="center tnum">{s.avg_recent ?? "—"} <span className="muted">/ {s.avg_before ?? "—"}</span>
                  {Math.abs(trend) >= 0.3 && <Icon name={trend > 0 ? "trending-up" : "trending-down"} className={trend > 0 ? "" : ""} />}</td>
                <td>{s.signals.map((g) => <Badge key={g} tone="warn">{t(`sig_${g}`)}</Badge>)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- teacher: weekly tests
type TTest = { test_id: string; class: string; subject: string; topic: string; test_date: string; status: string; questions: number; submitted: number };
function TeacherTests({ i, home }: { i: I18n; home: Home }) {
  const { t } = i;
  const { data, err, reload } = useLoad<TTest[]>("/teacher/tests");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const setStatus = async (id: string, status: "published" | "closed") => {
    await api("/teacher/tests/status", { method: "POST", body: JSON.stringify({ test_id: id, status }) }); reload();
  };
  if (open) return <TestResults i={i} testId={open} onBack={() => { setOpen(null); reload(); }} />;
  return (
    <>
      {creating ? <NewTest i={i} home={home} onDone={() => { setCreating(false); reload(); }} onCancel={() => setCreating(false)} />
        : <div className="row"><button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" />{t("new_test")}</button></div>}
      {!data ? <Loading i={i} err={err} /> : (
        <Card title={t("tab_tests")}>
          {data.length === 0 ? <Empty icon="checklist">{t("no_tests")}</Empty> : (
            <div className="list">{data.map((x) => (
              <div key={x.test_id} className="list-item" style={{ flexWrap: "wrap" }}>
                <Icon name="checklist" />
                <div className="grow" style={{ minWidth: 200 }}><b>{x.class} · {x.subject} — {x.topic}</b>
                  <div className="small muted">{i.date(x.test_date, true)} · {t("questions_n", { n: x.questions })} · {t("submitted_n", { n: x.submitted })}</div></div>
                <Badge tone={x.status === "published" ? "good" : x.status === "closed" ? "" : "accent"}>{t(`ts_${x.status}`)}</Badge>
                {x.status === "draft" && <button className="btn btn-sm btn-primary" onClick={() => setStatus(x.test_id, "published")}><Icon name="send" />{t("publish")}</button>}
                {x.status === "published" && <button className="btn btn-sm" onClick={() => setStatus(x.test_id, "closed")}><Icon name="lock" />{t("close_test")}</button>}
                <button className="btn btn-sm" onClick={() => setOpen(x.test_id)}><Icon name="chart-bar" />{t("results")}</button>
              </div>
            ))}</div>
          )}
        </Card>
      )}
    </>
  );
}

function NewTest({ i, home, onDone, onCancel }: { i: I18n; home: Home; onDone: () => void; onCancel: () => void }) {
  const { t } = i;
  const pairs = home.assignments ?? [];
  const [pair, setPair] = useState(pairs[0] ? `${pairs[0].class_id}|${pairs[0].subject_id}` : "");
  const [classId, subjectId] = pair.split("|");
  const topics = useLoad<{ topic: string; questions: number }[]>(pair ? `/teacher/bank-topics?class=${classId}&subject=${subjectId}` : null, [pair]);
  const [topic, setTopic] = useState("");
  const [nNew, setNNew] = useState(6); const [nRev, setNRev] = useState(3); const [mix, setMix] = useState(true);
  const [result, setResult] = useState<{ test_id: string; new_count: number; review_count: number; review_topics: string[]; missing_new: number } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { if (topics.data?.length && !topics.data.find((x) => x.topic === topic)) setTopic(topics.data[0].topic); }, [topics.data]);  // eslint-disable-line react-hooks/exhaustive-deps
  const gen = async () => {
    setBusy(true); setErr("");
    try {
      setResult(await api("/teacher/tests/generate", { method: "POST", body: JSON.stringify({
        class_id: classId, subject_id: Number(subjectId), topic, test_date: todayIso(), n_new: nNew, n_review: nRev, mix }) }));
    } catch { setErr(t("error")); } finally { setBusy(false); }
  };
  const publish = async () => {
    if (!result) return;
    await api("/teacher/tests/status", { method: "POST", body: JSON.stringify({ test_id: result.test_id, status: "published" }) });
    onDone();
  };
  return (
    <Card title={t("new_test")} sub={t("gen_info")}>
      {!result ? (
        <div className="stack">
          <div className="grid grid-2">
            <div className="field"><label className="label" htmlFor="nt-pair">{t("class_subject")}</label>
              <select id="nt-pair" className="select" style={{ width: "100%" }} value={pair} onChange={(e) => setPair(e.target.value)}>
                {pairs.map((p) => <option key={`${p.class_id}|${p.subject_id}`} value={`${p.class_id}|${p.subject_id}`}>{p.class} · {p.subject}</option>)}
              </select></div>
            <div className="field"><label className="label" htmlFor="nt-topic">{t("test_topic")}</label>
              <select id="nt-topic" className="select" style={{ width: "100%" }} value={topic} onChange={(e) => setTopic(e.target.value)}>
                {(topics.data ?? []).map((x) => <option key={x.topic} value={x.topic}>{x.topic} ({x.questions})</option>)}
              </select></div>
            <div className="field"><label className="label" htmlFor="nt-new">{t("n_new")}</label>
              <input id="nt-new" className="input" type="number" min={1} max={20} value={nNew} onChange={(e) => setNNew(Number(e.target.value))} /></div>
            <div className="field"><label className="label" htmlFor="nt-rev">{t("n_review")}</label>
              <input id="nt-rev" className="input" type="number" min={0} max={10} value={nRev} onChange={(e) => setNRev(Number(e.target.value))} /></div>
          </div>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={mix} onChange={(e) => setMix(e.target.checked)} />{t("mix")}</label>
          {err && <div className="callout callout-warn"><Icon name="alert-triangle" /><div>{err}</div></div>}
          <div className="row"><button className="btn btn-primary" disabled={busy || !topic} onClick={gen}><Icon name="wand" />{t("generate")}</button>
            <button className="btn btn-ghost" onClick={onCancel}>{t("cancel")}</button></div>
        </div>
      ) : (
        <div className="stack">
          <div className="callout callout-info"><Icon name="circle-check" /><div><b>{t("gen_result", { n: result.new_count, r: result.review_count })}</b>
            {result.review_topics.length > 0 && <div className="small">{t("review_topics")}: {result.review_topics.join(", ")}</div>}
            {result.missing_new > 0 && <div className="small">{t("missing_q", { n: result.missing_new })}</div>}</div></div>
          <div className="row"><button className="btn btn-primary" onClick={publish}><Icon name="send" />{t("publish")}</button>
            <button className="btn" onClick={onDone}>{t("save")}</button></div>
        </div>
      )}
    </Card>
  );
}

type Results = { test: { topic: string; class: string; subject: string; status: string; test_date: string };
  students: { name: string; score: number | null; submitted_at: string | null }[];
  topics: { topic: string; is_review: boolean; correct_pct: number | null; answers: number }[] };
function TestResults({ i, testId, onBack }: { i: I18n; testId: string; onBack: () => void }) {
  const { t } = i;
  const { data, err } = useLoad<Results>(`/teacher/tests/results?test=${testId}`);
  return (
    <>
      <div className="row" style={{ gap: 12 }}>
        <button className="btn icon-btn" onClick={onBack} aria-label={t("back")}><Icon name="arrow-left" /></button>
        <div><h1 style={{ fontSize: 22 }}>{data ? `${data.test.class} · ${data.test.subject} — ${data.test.topic}` : t("results")}</h1>
          {data && <p className="small muted">{i.date(data.test.test_date, true)} · {t(`ts_${data.test.status}`)}</p>}</div>
      </div>
      {!data ? <Loading i={i} err={err} /> : (
        <div className="grid grid-2" style={{ alignItems: "start" }}>
          <Card title={t("by_topic")}>
            <div className="stack">{data.topics.map((x) => (
              <div key={x.topic + x.is_review}>
                <div className="row between small"><b>{x.topic} {x.is_review && <Badge tone="accent">{t("review_tag")}</Badge>}</b>
                  <span className="tnum">{x.correct_pct ?? "—"}%</span></div>
                <Progress value={x.correct_pct ?? 0} />
                {x.correct_pct != null && x.correct_pct < 80 && <div className="small" style={{ color: "var(--warn)" }}>{t("not_mastered")}</div>}
              </div>
            ))}</div>
            <p className="small muted" style={{ marginTop: 10 }}><Icon name="scale" /> {t("no_ranking")}</p>
          </Card>
          <Card title={t("results")}>
            <div className="list">{data.students.map((s) => (
              <div key={s.name} className="list-item"><span className="grow">{s.name}</span>
                {s.submitted_at ? <b className="tnum">{Math.round(s.score ?? 0)}%</b> : <span className="small muted">{t("not_submitted")}</span>}</div>
            ))}</div>
          </Card>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- student: weekly tests
type STest = { test_id: string; subject: string; topic: string; test_date: string; status: string; questions: number;
  attempt: { id: string; submitted_at: string | null; score: number | null } | null };
export function StudentTests({ i }: { i: I18n }) {
  const { t } = i;
  const { data, err, reload } = useLoad<STest[]>("/student/tests");
  const [taking, setTaking] = useState<STest | null>(null);
  if (taking) return <TakeTest i={i} test={taking} onDone={() => { setTaking(null); reload(); }} />;
  if (!data) return <Loading i={i} err={err} />;
  return (
    <Card title={t("tab_tests")} sub={t("test_low_stakes")}>
      {data.length === 0 ? <Empty icon="checklist">{t("no_tests")}</Empty> : (
        <div className="list">{data.map((x) => (
          <div key={x.test_id} className="list-item" style={{ flexWrap: "wrap" }}>
            <Icon name="checklist" />
            <div className="grow" style={{ minWidth: 180 }}><b>{x.subject} — {x.topic}</b>
              <div className="small muted">{i.date(x.test_date, true)} · {t("questions_n", { n: x.questions })}</div></div>
            {x.attempt?.submitted_at ? <Badge tone="good">{t("your_score", { s: Math.round(x.attempt.score ?? 0) })}</Badge>
              : x.status === "published" ? <button className="btn btn-primary btn-sm" onClick={() => setTaking(x)}>
                  <Icon name="player-play" />{x.attempt ? t("continue_test") : t("take_test")}</button>
              : <Badge>{t("ts_closed")}</Badge>}
          </div>
        ))}</div>
      )}
    </Card>
  );
}

type Q = { id: string; text: string; options: string[]; topic: string | null; answer: number | null };
function TakeTest({ i, test, onDone }: { i: I18n; test: STest; onDone: () => void }) {
  const { t } = i;
  const [attempt, setAttempt] = useState<{ attempt_id: string; questions: Q[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [score, setScore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => {
    api<{ attempt_id: string; questions: Q[] }>("/student/tests/start", { method: "POST", body: JSON.stringify({ test_id: test.test_id }) })
      .then((a) => { setAttempt(a); setAnswers(Object.fromEntries(a.questions.filter((q) => q.answer != null).map((q) => [q.id, Number(q.answer)]))); })
      .catch(() => setErr(t("error")));
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (qid: string, k: number) => {
    setAnswers({ ...answers, [qid]: k });
    api("/student/tests/answer", { method: "POST", body: JSON.stringify({ attempt_id: attempt!.attempt_id, question_id: qid, choice: k }) }).catch(() => setErr(t("error")));
  };
  const submit = async () => {
    setBusy(true);
    try { const r = await api<{ score: number }>("/student/tests/submit", { method: "POST", body: JSON.stringify({ attempt_id: attempt!.attempt_id }) }); setScore(r.score); window.scrollTo(0, 0); }
    catch { setErr(t("error")); } finally { setBusy(false); }
  };
  if (score != null) return (
    <Card><div className="stack" style={{ alignItems: "center", textAlign: "center", padding: "12px 0" }}>
      <span className="role-icon" style={{ width: 64, height: 64, fontSize: 34, background: "var(--good-soft)", color: "var(--good)" }}><Icon name="circle-check" /></span>
      <b style={{ fontSize: 18 }}>{t("test_done")}</b><div className="stat-value">{t("your_score", { s: Math.round(score) })}</div>
      <p className="small muted">{t("test_low_stakes")}</p>
      <button className="btn btn-primary" onClick={onDone}><Icon name="arrow-left" />{t("back")}</button></div></Card>
  );
  if (!attempt) return <Loading i={i} err={!!err} />;
  const n = attempt.questions.length, a = Object.keys(answers).length;
  return (
    <>
      <div className="row" style={{ gap: 12 }}>
        <button className="btn icon-btn" onClick={onDone} aria-label={t("back")}><Icon name="arrow-left" /></button>
        <div><h1 style={{ fontSize: 22 }}>{test.subject} — {test.topic}</h1><p className="small muted">{t("answered_n", { a, n })}</p></div>
      </div>
      <Progress value={(100 * a) / n} />
      {attempt.questions.map((q, k) => (
        <Card key={q.id} title={`${k + 1}. ${q.text}`}>
          <div className="stack" style={{ gap: 8 }}>{q.options.map((o, oi) => (
            <button key={oi} className={`option ${answers[q.id] === oi ? "selected" : ""}`} onClick={() => choose(q.id, oi)}>
              <span className="letter">{"ABCDEF"[oi]}</span>{o}</button>
          ))}</div>
        </Card>
      ))}
      {err && <div className="callout callout-warn"><Icon name="alert-triangle" /><div>{err}</div></div>}
      <button className="btn btn-primary" disabled={busy || a < n} onClick={submit}><Icon name="check" />{t("submit_test")}</button>
    </>
  );
}

// ---------------------------------------------------------------- zavuch: today's check
type DC = { teacher_id: string; name: string; lessons: number; after_lesson_done: number; topics_written: number;
  next_day_lessons: number; next_day_cards: number; day_closed: boolean };
export function DayCheck({ i }: { i: I18n }) {
  const { t } = i;
  const { data, err } = useLoad<DC[]>(`/office/daycheck?date=${todayIso()}`);
  const mark = (done: number, total: number) => total === 0 ? <span className="muted">—</span>
    : <span className="tnum" style={{ color: done >= total ? "var(--good)" : "var(--warn)", fontWeight: 600 }}>{done} / {total}</span>;
  if (!data) return <Loading i={i} err={err} />;
  return (
    <Card title={t("day_check")} sub={t("day_check_sub")}>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>{t("dc_teacher")}</th><th className="center">{t("dc_after")}</th><th className="center">{t("dc_topics")}</th>
          <th className="center">{t("dc_tomorrow")}</th><th className="center">{t("dc_closed")}</th></tr></thead>
        <tbody>{data.map((r) => (
          <tr key={r.teacher_id}><td><b>{r.name}</b></td>
            <td className="center">{mark(r.after_lesson_done, r.lessons)}</td>
            <td className="center">{mark(r.topics_written, r.lessons)}</td>
            <td className="center">{mark(r.next_day_cards, r.next_day_lessons)}</td>
            <td className="center">{r.day_closed ? <Icon name="moon" /> : <span className="muted">—</span>}</td></tr>
        ))}</tbody>
      </table></div>
      <p className="small muted" style={{ marginTop: 10 }}><Icon name="scale" /> {t("no_ranking")}</p>
    </Card>
  );
}

// ---------------------------------------------------------------- problems with actions
export function ProblemsCard({ i, home, reload }: { i: I18n; home: Home; reload: () => void }) {
  const { t } = i;
  const list = home.problems ?? [];
  const isZavuch = home.role === "zavuch" || home.role === "school_admin";
  const act = async (id: string, status: "handled" | "escalated") => {
    await api("/office/problem", { method: "POST", body: JSON.stringify({ id, status }) }); reload();
  };
  return (
    <Card title={t("problems")} right={<Badge tone="warn">{list.filter((p) => p.status === "open").length}</Badge>}>
      {list.length === 0 ? <Empty icon="mood-happy">{t("nothing")}</Empty> : (
        <div className="list">{list.map((p) => (
          <div key={p.id} className="list-item" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
            <Badge tone={p.severity === "serious" ? "bad" : "warn"}>{t(p.severity)}</Badge>
            <div className="grow small" style={{ minWidth: 180 }}>{p.description}
              {p.status === "escalated" && <div><Badge tone="accent">{t("escalated_badge")}</Badge></div>}</div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" onClick={() => act(p.id, "handled")}><Icon name="check" />{t("handled")}</button>
              {isZavuch && p.status === "open" && <button className="btn btn-sm" onClick={() => act(p.id, "escalated")}><Icon name="arrow-up-right" />{t("escalate")}</button>}
            </div>
          </div>
        ))}</div>
      )}
    </Card>
  );
}
