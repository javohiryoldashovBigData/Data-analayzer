import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { api, ApiError, getToken, schoolSlug, setToken, type Home, type SchoolWindow } from "./api";
import { useLang, type I18n, type Lang } from "./i18n";
import { FamilyHome } from "./Family";
import { OfficeInbox } from "./Office";
import { DayCheck, ProblemsCard, TeacherArea } from "./Step4";
import { AiBudgetCard } from "./Step5";
import { GradesOverview } from "./Step6";
import { Avatar, Card, Empty, Icon, PageHead, Progress, Stat } from "../components/ui";

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
    } catch (e) {
      // Only a real "session expired" (401) logs you out. With no internet we keep
      // the screen you have, so offline-saved lessons can still sync later.
      if (e instanceof ApiError && e.status === 401) setHome(null);
      else setErr(t("error"));
    }
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
        {home.day && <TeacherArea i={i} home={home} reload={onRefresh} />}
        {home.kids && <FamilyHome i={i} home={home} reload={onRefresh} />}
        {home.stats && <LeaderHome i={i} home={home} reload={onRefresh} />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- director / zavuch
function LeaderHome({ i, home, reload }: { i: I18n; home: Home; reload: () => void }) {
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
        <ProblemsCard i={i} home={home} reload={reload} />
      </div>
      <DayCheck i={i} />
      <GradesOverview i={i} />
      <AiBudgetCard i={i} home={home} />
      <OfficeInbox i={i} home={home} reload={reload} />
      <Card><div className="row between"><span><Icon name="mail" /> {t("absence_pending")}</span><b className="tnum">{c.absence_pending}</b></div></Card>
    </>
  );
}
