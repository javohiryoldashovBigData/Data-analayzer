import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api, ApiError, getToken, schoolSlug, setToken, type Home, type Kid, type Lesson, type SchoolWindow } from "./api";
import { useLang, type I18n, type Lang } from "./i18n";
import { Avatar, Badge, Card, Empty, GradePill, Icon, PageHead, Progress, Segmented, Stat } from "../components/ui";

const ROLES: { id: string; icon: string; color: string }[] = [
  { id: "teacher", icon: "school", color: "#0f766e" },
  { id: "parent", icon: "heart-handshake", color: "#d8662f" },
  { id: "student", icon: "backpack", color: "#2a78d6" },
  { id: "director", icon: "building-community", color: "#7c3aed" },
  { id: "zavuch", icon: "clipboard-check", color: "#b45309" },
];

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("maktab.theme", theme); } catch { /* ignore */ }
  }, [theme]);
  return { theme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}

// The school's own colour becomes the app's brand colour ("one window per school").
function brandStyle(w: SchoolWindow | null): CSSProperties {
  if (!w) return {};
  return { "--brand": w.brand_color, "--brand-strong": `color-mix(in srgb, ${w.brand_color} 80%, black)`,
           "--brand-soft": `color-mix(in srgb, ${w.brand_color} 14%, transparent)` } as CSSProperties;
}

export default function LiveApp() {
  const i = useLang();
  const { t } = i;
  const slug = useMemo(schoolSlug, []);
  const [win, setWin] = useState<SchoolWindow | null>(null);
  const [winErr, setWinErr] = useState(false);
  const [home, setHome] = useState<Home | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api<SchoolWindow>(`/window/${slug}`).then((w) => { setWin(w); document.title = `${w.name} · Maktab+`; }).catch(() => setWinErr(true));
  }, [slug]);

  const load = () => {
    if (!getToken()) return;
    setBusy(true); setErr("");
    api<Home>("/home").then(setHome).catch((e: ApiError) => { if (e.status !== 401) setErr(t("error")); setHome(null); }).finally(() => setBusy(false));
  };
  useEffect(load, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const login = async (role: string) => {
    setBusy(true); setErr("");
    try {
      const r = await api<{ token: string }>("/login/demo", { method: "POST", body: JSON.stringify({ slug, role }) });
      setToken(r.token);
      setHome(await api<Home>("/home"));
    } catch { setErr(t("error")); } finally { setBusy(false); }
  };
  const logout = () => { setToken(null); setHome(null); };

  if (winErr) return <div className="login"><Card><Empty icon="building-off">{t("not_found")}</Empty></Card></div>;
  return (
    <div style={{ ...brandStyle(win), minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {home ? <Shell i={i} win={win} home={home} onLogout={logout} onRefresh={load} busy={busy} />
            : <Landing i={i} win={win} onLogin={login} busy={busy} err={err} />}
    </div>
  );
}

// ---------------------------------------------------------------- landing
function LangSelect({ i }: { i: I18n }) {
  return (
    <select className="select" value={i.lang} onChange={(e) => i.setLang(e.target.value as Lang)} aria-label="Til / Язык / Language">
      <option value="uz">O‘zbekcha</option><option value="ru">Русский</option><option value="en">English</option>
    </select>
  );
}
function Logo({ win, size = 36 }: { win: SchoolWindow | null; size?: number }) {
  return win?.logo_url
    ? <img src={win.logo_url} alt="" width={size} height={size} style={{ borderRadius: 10 }} />
    : <span className="brand-logo" style={{ width: size, height: size, fontSize: size * 0.45 }}>M+</span>;
}

function Landing({ i, win, onLogin, busy, err }: { i: I18n; win: SchoolWindow | null; onLogin: (r: string) => void; busy: boolean; err: string }) {
  const { t } = i;
  return (
    <div className="login" style={{ flex: 1 }}>
      <div className="login-box">
        <div className="row between">
          <div className="row">
            <Logo win={win} size={46} />
            <div>
              <h1 style={{ fontSize: 24 }}>{win?.name ?? "Maktab+"}</h1>
              <p className="muted">Maktab+</p>
            </div>
          </div>
          <LangSelect i={i} />
        </div>
        <div className="callout callout-info">
          <Icon name="player-play" />
          <div><b>{t("demo_title")}</b> {t("demo_sub")}</div>
        </div>
        <div className="grid grid-3">
          {ROLES.map((r) => (
            <button key={r.id} className="card role-card" onClick={() => onLogin(r.id)} disabled={busy}>
              <span className="role-icon" style={{ background: `color-mix(in srgb, ${r.color} 14%, transparent)`, color: r.color }}><Icon name={r.icon} /></span>
              <div>
                <h2>{t(`role_${r.id}`)}</h2>
                <p className="small muted" style={{ marginTop: 4 }}>{t(`role_${r.id}_d`)}</p>
              </div>
              <span className="btn btn-primary" style={{ alignSelf: "flex-start" }}>{t("enter_as")} <Icon name="arrow-right" /></span>
            </button>
          ))}
        </div>
        {err && <div className="callout callout-warn"><Icon name="alert-triangle" /><div>{err}</div></div>}
        <p className="small muted" style={{ textAlign: "center" }}><Icon name="lock" /> {t("hosted_uz")}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- shell
function Shell({ i, win, home, onLogout, onRefresh, busy }: { i: I18n; win: SchoolWindow | null; home: Home; onLogout: () => void; onRefresh: () => void; busy: boolean }) {
  const { t } = i;
  const theme = useTheme();
  const name = `${home.me.first_name} ${home.me.last_name}`;
  const role = home.roles[0] ?? "";
  return (
    <div className="main" style={{ minHeight: "100vh" }}>
      <header className="topbar">
        <Logo win={win} />
        <div style={{ minWidth: 0 }}>
          <div className="topbar-title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{win?.name ?? home.school?.name}</div>
          <div className="small muted">{t(`role_${role}`)}</div>
        </div>
        <div className="topbar-spacer" />
        <LangSelect i={i} />
        <button className="btn icon-btn hide-narrow" onClick={onRefresh} aria-label="refresh" disabled={busy}><Icon name="refresh" /></button>
        <button className="btn icon-btn" onClick={theme.toggle} aria-label="theme"><Icon name={theme.theme === "dark" ? "sun" : "moon"} /></button>
        <div className="row hide-narrow" style={{ gap: 8 }}><Avatar name={name} /><span className="user-text">{name}</span></div>
        <button className="btn" onClick={onLogout}><Icon name="logout" /><span className="user-text">{t("logout")}</span></button>
      </header>
      <main className="content">
        {home.day && <TeacherHome i={i} home={home} />}
        {home.kids && <FamilyHome i={i} home={home} />}
        {home.stats && <LeaderHome i={i} home={home} />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- teacher
function TeacherHome({ i, home }: { i: I18n; home: Home }) {
  const { t } = i;
  const day = home.day!;
  const done = day.lessons.filter((l) => l.lesson_done).length;
  return (
    <>
      <PageHead title={t("hello", { n: home.me.first_name })} sub={i.date(day.date, true)} />
      <div className="grid grid-3">
        <Stat icon="calendar" label={t("lessons_today")} value={day.lessons.length} />
        <Stat icon="circle-check" label={t("lessons_done")} value={`${done} / ${day.lessons.length}`} />
        <Stat icon="mail" label={t("absence_pending")} value={day.absence_reports_pending} />
      </div>
      <Card title={t("lessons_today")} sub={i.date(day.date, true)}>
        {day.lessons.length === 0 ? <Empty icon="mug">{t("no_lessons")}</Empty> : (
          <div className="list">{day.lessons.map((l) => <LessonRow key={l.period} i={i} l={l} />)}</div>
        )}
        <p className="small muted" style={{ marginTop: 10 }}><Icon name="info-circle" /> {t("next_step")}</p>
      </Card>
    </>
  );
}
function LessonRow({ i, l }: { i: I18n; l: Lesson }) {
  const { t } = i;
  const card = l.card ? <Badge tone={l.card.status === "approved" ? "good" : "accent"}>{t(`card_${l.card.status}`)}</Badge> : <Badge>{t("card_none")}</Badge>;
  return (
    <div className="list-item" style={{ alignItems: "flex-start" }}>
      <span className="period-no">{l.period}</span>
      <div className="grow stack" style={{ gap: 6 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <b>{l.class} · {l.subject}</b>
          <span className="small muted">{l.start?.slice(0, 5)}–{l.end?.slice(0, 5)}</span>
          {l.substitution && <Badge tone="warn">{t("substitution")}</Badge>}
          {card}
          {l.attendance_done && <Badge tone="good">{t("att_done")}</Badge>}
          {l.lesson_done && <Badge tone="good" icon="check">{t("lesson_done")}</Badge>}
        </div>
        {l.ask_first.length > 0 && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <span className="small muted"><Icon name="hand-finger" /> {t("ask_first")}:</span>
            {l.ask_first.map((a) => <span key={a.student_id} className="badge">{a.name}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- parent / student
function FamilyHome({ i, home }: { i: I18n; home: Home }) {
  const { t } = i;
  const kids = home.kids ?? [];
  const [kidId, setKidId] = useState(kids[0]?.id ?? "");
  const kid = kids.find((k) => k.id === kidId) ?? kids[0];
  if (!kid) return <Card><Empty>{t("nothing")}</Empty></Card>;
  const isParent = home.roles.includes("parent");
  return (
    <>
      <PageHead title={t("hello", { n: home.me.first_name })} sub={`${kid.first_name} ${kid.last_name} · ${kid.class}`}
        right={kids.length > 1 ? <Segmented value={kid.id} onChange={setKidId} items={kids.map((k) => ({ id: k.id, label: `${k.first_name} · ${k.class}` }))} /> : undefined} />
      <KidView i={i} home={home} kid={kid} isParent={isParent} />
    </>
  );
}
function KidView({ i, home, kid, isParent }: { i: I18n; home: Home; kid: Kid; isParent: boolean }) {
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
function dedupeTeachers(rows: NonNullable<Home["teachers"]>) {
  const m = new Map<string, { teacher_id: string; first_name: string; last_name: string; subjects: string[]; is_class_teacher: boolean }>();
  for (const r of rows) {
    const e = m.get(r.teacher_id) ?? { teacher_id: r.teacher_id, first_name: r.first_name, last_name: r.last_name, subjects: [], is_class_teacher: false };
    if (r.subject && !e.subjects.includes(r.subject)) e.subjects.push(r.subject);
    e.is_class_teacher ||= r.is_class_teacher;
    m.set(r.teacher_id, e);
  }
  return [...m.values()].sort((a, b) => Number(b.is_class_teacher) - Number(a.is_class_teacher));
}

// ---------------------------------------------------------------- director / zavuch
function LeaderHome({ i, home }: { i: I18n; home: Home }) {
  const { t } = i;
  const s = home.stats!, c = home.counts!;
  return (
    <>
      <PageHead title={t("hello", { n: home.me.first_name })} sub={t("teachers_classes", { t: c.teachers, c: c.classes })} />
      <div className="grid grid-4">
        <Stat icon="users" label={t("students")} value={s.students} />
        <Stat icon="door-enter" label={t("arrived_today")} value={`${c.arrived_today} / ${s.students}`} />
        <Stat icon="calendar-check" label={t("attendance_rate")} value={s.attendance_rate != null ? `${s.attendance_rate}%` : "—"} />
        <Stat icon="star" label={t("avg_school")} value={s.avg_current_grade ?? "—"} />
      </div>
      <div className="grid grid-2">
        <Card title={t("by_class")}>
          <div className="stack">{(home.classAttendance ?? []).map((r) => (
            <div key={r.class}><div className="row between small"><b>{r.class}</b><span className="tnum">{r.rate}%</span></div><Progress value={r.rate} /></div>))}</div>
          <p className="small muted" style={{ marginTop: 12 }}><Icon name="scale" /> {t("no_ranking")}</p>
        </Card>
        <Card title={t("problems")} right={<Badge tone="warn">{c.problems_open}</Badge>}>
          {(home.problems ?? []).length === 0 ? <Empty icon="mood-happy">{t("nothing")}</Empty> : (
            <div className="list">{home.problems!.map((p) => (
              <div key={p.id} className="list-item" style={{ alignItems: "flex-start" }}>
                <Badge tone={p.severity === "serious" ? "bad" : "warn"}>{t(p.severity)}</Badge>
                <div className="grow small">{p.description}</div>
                <span className="small muted">{i.date(p.created_at)}</span></div>))}</div>
          )}
        </Card>
      </div>
      <Card><div className="row between"><span><Icon name="mail" /> {t("absence_pending")}</span><b className="tnum">{c.absence_pending}</b></div></Card>
    </>
  );
}
