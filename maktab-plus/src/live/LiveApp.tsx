import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
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

const ROLE_KEY = "maktab.live.role";
const getRole = () => { try { return localStorage.getItem(ROLE_KEY); } catch { return null; } };
const putRole = (r: string | null) => { try { if (r) localStorage.setItem(ROLE_KEY, r); else localStorage.removeItem(ROLE_KEY); } catch { /* ignore */ } };

// Demo accounts shown ONLY in the demo school's window. Everyone: maktab2026.
const DEMO_ACCOUNTS: { role: string; name: string; login: string }[] = [
  { role: "teacher", name: "Aziza Karimova", login: "+998 90 000 01 11" },
  { role: "teacher_parent", name: "Kamola Yusupova", login: "+998 90 000 01 12" },
  { role: "parent", name: "Dilshod Rahimov", login: "+998 90 000 01 21" },
  { role: "student", name: "Sardor Rahimov", login: "sardor.r" },
  { role: "director", name: "Nodira Sattorova", login: "+998 90 000 01 01" },
  { role: "zavuch", name: "Jamshid Tolipov", login: "+998 90 000 01 02" },
];
const DEMO_PASSWORD = "maktab2026";

export default function LiveApp() {
  const i = useLang();
  const { t } = i;
  const slug = useMemo(schoolSlug, []);
  const [win, setWin] = useState<SchoolWindow | null>(null);
  const [winErr, setWinErr] = useState(false);
  const [home, setHome] = useState<Home | null>(null);
  const [roles, setRoles] = useState<string[] | null>(null);   // set after login when the person must choose
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api<SchoolWindow>(`/window/${slug}`).then((w) => { setWin(w); document.title = `${w.name} · Maktab+`; }).catch(() => setWinErr(true));
  }, [slug]);

  const open = async (role: string | null) => {
    setBusy(true); setErr("");
    try {
      const h = await api<Home>(`/home${role ? `?role=${encodeURIComponent(role)}` : ""}`);
      putRole(h.role); setHome(h); setRoles(null); window.scrollTo(0, 0);
    } catch (e) { if ((e as ApiError).status !== 401) setErr(t("error")); setHome(null); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (getToken()) open(getRole()); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const login = async (loginName: string, password: string) => {
    setBusy(true); setErr("");
    try {
      const r = await api<{ token: string; roles: string[] }>("/login", { method: "POST", body: JSON.stringify({ slug, login: loginName, password }) });
      setToken(r.token); putRole(null);
      if (r.roles.length > 1) { setRoles(r.roles); setBusy(false); }   // "who are you today?"
      else await open(r.roles[0]);
    } catch (e) {
      const code = (e as ApiError).code;
      setErr(t(code === "bad_credentials" ? "bad_credentials" : code === "too_many_attempts" ? "too_many" : "error"));
      setBusy(false);
    }
  };
  const logout = () => { setToken(null); putRole(null); setHome(null); setRoles(null); };

  if (winErr) return <div className="login"><Card><Empty icon="building-off">{t("not_found")}</Empty></Card></div>;
  return (
    <div style={{ ...brandStyle(win), minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {home ? <Shell i={i} win={win} home={home} onLogout={logout} onRefresh={() => open(home.role)} onSwitch={() => setRoles(home.roles)} busy={busy} />
       : roles ? <Frame i={i} win={win}><RoleChooser i={i} roles={roles} onPick={open} onCancel={logout} busy={busy} /></Frame>
       : <Frame i={i} win={win}><LoginForm i={i} demo={slug === "demo"} onLogin={login} busy={busy} err={err} /></Frame>}
      {home && roles && (
        <div className="modal-scrim" onClick={() => setRoles(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <RoleChooser i={i} roles={roles} onPick={open} onCancel={() => setRoles(null)} busy={busy} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- login
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

// The school's own page: its logo and name on top, then the form.
function Frame({ i, win, children }: { i: I18n; win: SchoolWindow | null; children: ReactNode }) {
  const { t } = i;
  return (
    <div className="login" style={{ flex: 1 }}>
      <div className="login-box" style={{ width: "min(440px, 100%)" }}>
        <div className="row between">
          <div className="row" style={{ minWidth: 0 }}>
            <Logo win={win} size={46} />
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: 21 }}>{win?.name ?? "Maktab+"}</h1>
              <p className="small muted">Maktab+</p>
            </div>
          </div>
          <LangSelect i={i} />
        </div>
        {children}
        <p className="small muted" style={{ textAlign: "center" }}><Icon name="lock" /> {t("hosted_uz")}</p>
      </div>
    </div>
  );
}

function LoginForm({ i, demo, onLogin, busy, err }: { i: I18n; demo: boolean; onLogin: (l: string, p: string) => void; busy: boolean; err: string }) {
  const { t } = i;
  const [login, setLogin] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  return (
    <>
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); onLogin(login, pw); }}>
        <h2 style={{ fontSize: 18 }}>{t("sign_in")}</h2>
        <div className="field">
          <label className="label" htmlFor="login">{t("login_label")}</label>
          <input id="login" className="input" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username"
                 placeholder="+998 90 123 45 67" inputMode="text" autoFocus required />
        </div>
        <div className="field">
          <label className="label" htmlFor="pw">{t("password")}</label>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input id="pw" className="input" type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)}
                   autoComplete="current-password" required />
            <button type="button" className="btn icon-btn" onClick={() => setShow(!show)} aria-label={t("show_password")}><Icon name={show ? "eye-off" : "eye"} /></button>
          </div>
        </div>
        {err && <div className="callout callout-warn"><Icon name="alert-triangle" /><div>{err}</div></div>}
        <button className="btn btn-primary" type="submit" disabled={busy || !login.trim() || !pw}>
          {busy ? t("loading") : <>{t("enter_as")} <Icon name="arrow-right" /></>}
        </button>
        <p className="small muted"><Icon name="help-circle" /> {t("forgot")}</p>
      </form>
      {demo && (
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>{t("demo_accounts")}</summary>
          <p className="small muted" style={{ margin: "8px 0" }}>{t("demo_sub")} {t("password")}: <b>{DEMO_PASSWORD}</b></p>
          <div className="list">
            {DEMO_ACCOUNTS.map((a) => (
              <div key={a.login} className="list-item">
                <div className="grow"><b>{t(`demo_${a.role}`)}</b><div className="small muted">{a.name} · {a.login}</div></div>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onLogin(a.login, DEMO_PASSWORD)}>{t("enter_as")}</button>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

// Shown only when one person has more than one role in this school
// (e.g. a teacher whose own child studies here). Only their REAL roles appear.
function RoleChooser({ i, roles, onPick, onCancel, busy }: { i: I18n; roles: string[]; onPick: (r: string) => void; onCancel: () => void; busy: boolean }) {
  const { t } = i;
  return (
    <div className="stack">
      <div className="card stack">
        <h2 style={{ fontSize: 18 }}>{t("who_today")}</h2>
        <p className="small muted">{t("who_today_sub")}</p>
        {roles.map((r) => {
          const st = ROLES.find((x) => x.id === r) ?? { icon: "user", color: "#666" };
          return (
            <button key={r} className="card role-card" style={{ flexDirection: "row", alignItems: "center" }} disabled={busy} onClick={() => onPick(r)}>
              <span className="role-icon" style={{ background: `color-mix(in srgb, ${st.color} 14%, transparent)`, color: st.color }}><Icon name={st.icon} /></span>
              <div className="grow"><b>{t(`role_${r}`)}</b><div className="small muted">{t(`role_${r}_d`)}</div></div>
              <Icon name="arrow-right" />
            </button>
          );
        })}
        <button className="btn btn-ghost" onClick={onCancel}>{t("cancel")}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- shell
function Shell({ i, win, home, onLogout, onRefresh, onSwitch, busy }: { i: I18n; win: SchoolWindow | null; home: Home; onLogout: () => void; onRefresh: () => void; onSwitch: () => void; busy: boolean }) {
  const { t } = i;
  const theme = useTheme();
  const name = `${home.me.first_name} ${home.me.last_name}`;
  const role = home.role;
  return (
    <div className="main" style={{ minHeight: "100vh" }}>
      <header className="topbar">
        <Logo win={win} />
        <div style={{ minWidth: 0 }}>
          <div className="topbar-title hide-narrow" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{win?.name ?? home.school?.name}</div>
          <div className="small muted" style={{ whiteSpace: "nowrap" }}>{t(`role_${role}`)}</div>
        </div>
        <div className="topbar-spacer" />
        {home.roles.length > 1 && <button className="btn" onClick={onSwitch}><Icon name="switch-horizontal" /><span className="user-text">{t("switch_role")}</span></button>}
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
