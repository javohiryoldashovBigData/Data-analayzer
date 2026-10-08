import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useMe, useStore } from "./lib/store";
import { LANGS, useI18n } from "./lib/i18n";
import type { AppNotification, Lang, Role } from "./data/types";
import { Avatar, Icon } from "./components/ui";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Diary from "./pages/Diary";
import Grades from "./pages/Grades";
import AttendancePage from "./pages/Attendance";
import Gate from "./pages/Gate";
import Gradebook from "./pages/Gradebook";
import AskFirst from "./pages/AskFirst";
import ExamCheck from "./pages/ExamCheck";
import Studio from "./pages/Studio";
import Tests from "./pages/Tests";
import TakeTest from "./pages/TakeTest";
import LabPage from "./pages/LabPage";
import Assistant from "./pages/Assistant";
import Settings from "./pages/Settings";
import StudentProfile from "./pages/StudentProfile";

// ---------------------------------------------------------------- theme

export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem("maktab.theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch { /* ignore */ }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("maktab.theme", theme); } catch { /* ignore */ }
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}

// ---------------------------------------------------------------- selected child (parents)

const ChildCtx = createContext<{ childId: string; setChildId: (id: string) => void } | null>(null);

/** For students: themselves. For parents: the selected child. */
export function useChild() {
  const { db, session } = useStore();
  const ctx = useContext(ChildCtx);
  if (session?.role === "student") return { childId: session.id, setChildId: () => {}, children: [] as string[] };
  const parent = db.parents.find((p) => p.id === session?.id);
  const children = parent?.childIds ?? [];
  const childId = ctx && children.includes(ctx.childId) ? ctx.childId : children[0] ?? "";
  return { childId, setChildId: ctx?.setChildId ?? (() => {}), children };
}

function ChildProvider({ children }: { children: ReactNode }) {
  const [childId, setChildId] = useState("");
  return <ChildCtx.Provider value={{ childId, setChildId }}>{children}</ChildCtx.Provider>;
}

// ---------------------------------------------------------------- navigation

interface NavItem { to: string; icon: string; key: string; isNew?: boolean }

const NAV: Record<Role, { section?: string; items: NavItem[] }[]> = {
  director: [
    { items: [{ to: "/", icon: "layout-dashboard", key: "nav_dashboard" }] },
    { section: "nav_sec_attendance", items: [
      { to: "/attendance", icon: "calendar-check", key: "nav_attendance" },
      { to: "/gate", icon: "scan", key: "nav_gate", isNew: true },
    ] },
    { section: "nav_sec_learning", items: [
      { to: "/tests", icon: "checklist", key: "nav_tests", isNew: true },
      { to: "/lab", icon: "flask", key: "nav_lab" },
    ] },
    { section: "nav_sec_ai", items: [{ to: "/assistant", icon: "sparkles", key: "nav_assistant" }] },
  ],
  teacher: [
    { items: [{ to: "/", icon: "layout-dashboard", key: "nav_dashboard" }] },
    { section: "nav_sec_class", items: [
      { to: "/gradebook", icon: "table", key: "nav_gradebook" },
      { to: "/attendance", icon: "calendar-check", key: "nav_attendance" },
    ] },
    { section: "nav_sec_ai_teacher", items: [
      { to: "/ask-first", icon: "hand-finger", key: "nav_askfirst", isNew: true },
      { to: "/exam-check", icon: "file-check", key: "nav_examcheck", isNew: true },
      { to: "/studio", icon: "presentation", key: "nav_studio", isNew: true },
      { to: "/tests", icon: "checklist", key: "nav_tests", isNew: true },
      { to: "/assistant", icon: "sparkles", key: "nav_assistant" },
    ] },
  ],
  student: [
    { items: [
      { to: "/", icon: "layout-dashboard", key: "nav_dashboard" },
      { to: "/diary", icon: "notebook", key: "nav_diary" },
      { to: "/grades", icon: "chart-line", key: "nav_grades" },
    ] },
    { section: "nav_sec_learning", items: [
      { to: "/tests", icon: "checklist", key: "nav_tests", isNew: true },
      { to: "/lab", icon: "flask", key: "nav_lab", isNew: true },
      { to: "/assistant", icon: "sparkles", key: "nav_tutor" },
    ] },
  ],
  parent: [
    { items: [
      { to: "/", icon: "layout-dashboard", key: "nav_dashboard" },
      { to: "/attendance", icon: "map-pin-check", key: "nav_attendance_live", isNew: true },
      { to: "/diary", icon: "notebook", key: "nav_diary" },
      { to: "/grades", icon: "chart-line", key: "nav_grades" },
    ] },
    { section: "nav_sec_ai", items: [{ to: "/assistant", icon: "sparkles", key: "nav_assistant" }] },
  ],
};

export function notificationText(n: AppNotification, t: ReturnType<typeof useI18n>["t"], subj: (id: string) => string, fmtDate: (d: string) => string) {
  const p = { ...n.params };
  if (p.subject) p.subject = subj(p.subject);
  if (p.date) p.date = fmtDate(p.date);
  if (p.reason) p.reason = t(`reason_${p.reason}`);
  return t(`notif_${n.kind}`, p);
}

const NOTIF_ICON: Record<string, [string, string]> = {
  arrived: ["door-enter", "var(--good)"], late: ["clock-exclamation", "var(--warn)"], left: ["door-exit", "var(--accent)"],
  notArrived: ["alert-triangle", "var(--bad)"], skipped: ["run", "var(--bad)"], grade: ["star", "var(--accent)"],
  absenceReported: ["mail", "var(--accent)"], absenceAccepted: ["check", "var(--good)"], testFlag: ["shield-exclamation", "var(--warn)"],
};

export function NotificationIcon({ kind }: { kind: string }) {
  const [icon, color] = NOTIF_ICON[kind] ?? ["bell", "var(--muted)"];
  return <span className="tl-icon" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}><Icon name={icon} /></span>;
}

function Bell() {
  const { db, session, actions } = useStore();
  const { t, subj, fmtDate } = useI18n();
  const [open, setOpen] = useState(false);
  const mine = db.notifications.filter((n) => n.userId === session?.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = mine.filter((n) => !n.read).length;
  return (
    <div style={{ position: "relative" }}>
      <button className="btn icon-btn" aria-label={t("notifications")} onClick={() => setOpen((o) => !o)}>
        <Icon name="bell" />{unread > 0 && <span className="dot" />}
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 29 }} onClick={() => setOpen(false)} />
          <div className="card" style={{ position: "absolute", right: 0, top: 44, width: "min(380px, calc(100vw - 32px))", zIndex: 30, maxHeight: 460, overflowY: "auto", padding: 14 }}>
            <div className="row between" style={{ marginBottom: 8 }}>
              <h3>{t("notifications")}</h3>
              {unread > 0 && <button className="btn btn-sm btn-ghost" onClick={() => actions.markRead(session!.id)}>{t("mark_read")}</button>}
            </div>
            {mine.length === 0 && <p className="muted small">{t("no_notifications")}</p>}
            <div className="list">
              {mine.slice(0, 30).map((n) => (
                <div key={n.id} className="list-item" style={{ opacity: n.read ? 0.7 : 1 }}>
                  <NotificationIcon kind={n.kind} />
                  <div className="grow">
                    <div className="small">{notificationText(n, t, subj, fmtDate)}</div>
                    <div className="small muted">{n.createdAt.slice(5).replace("-", ".")}</div>
                  </div>
                  {!n.read && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }} />}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Layout({ children }: { children: ReactNode }) {
  const me = useMe()!;
  const { logout } = useStore();
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  useEffect(() => { setMenuOpen(false); window.scrollTo(0, 0); }, [loc.pathname]);

  return (
    <div className="shell">
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <NavLink to="/" className="brand">
          <span className="brand-logo">M+</span>
          <span><div className="brand-name">Maktab+</div><div className="brand-sub">{t(`role_${me.role}`)}</div></span>
        </NavLink>
        {NAV[me.role].map((group, gi) => (
          <div key={gi}>
            {group.section && <div className="nav-section">{t(group.section)}</div>}
            {group.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.to === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                <Icon name={it.icon} /> {t(it.key)}
                {it.isNew && <span className="nav-new">{t("new")}</span>}
              </NavLink>
            ))}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}><Icon name="settings" /> {t("nav_settings")}</NavLink>
        <button className="nav-link" style={{ border: "none", background: "none", cursor: "pointer", textAlign: "left" }} onClick={() => { logout(); navigate("/"); }}>
          <Icon name="switch-horizontal" /> {t("switch_account")}
        </button>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label={t("menu")}><Icon name="menu-2" /></button>
          <span className="topbar-spacer" />
          <select className="select" style={{ minWidth: 0, width: "auto" }} value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t("language")}>
            {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <button className="btn icon-btn" onClick={toggle} aria-label={t("theme")}><Icon name={theme === "dark" ? "sun" : "moon"} /></button>
          <Bell />
          <div className="row" style={{ gap: 8 }}>
            <Avatar name={me.name} />
            <div className="small user-text" style={{ lineHeight: 1.2 }}>
              <div style={{ fontWeight: 600 }}>{me.name}</div>
              <div className="muted">{t(`role_${me.role}`)}</div>
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

function Toast() {
  const { toast } = useStore();
  return toast ? <div className="toast" role="status">{toast}</div> : null;
}

function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { session } = useStore();
  if (!session || !roles.includes(session.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const { session } = useStore();
  return (
    <HashRouter>
      <ChildProvider>
        {!session ? (
          <Login />
        ) : (
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/diary" element={<Guard roles={["student", "parent"]}><Diary /></Guard>} />
              <Route path="/grades" element={<Guard roles={["student", "parent"]}><Grades /></Guard>} />
              <Route path="/attendance" element={<AttendancePage />} />
              <Route path="/gate" element={<Guard roles={["director"]}><Gate /></Guard>} />
              <Route path="/gradebook" element={<Guard roles={["teacher"]}><Gradebook /></Guard>} />
              <Route path="/ask-first" element={<Guard roles={["teacher"]}><AskFirst /></Guard>} />
              <Route path="/exam-check" element={<Guard roles={["teacher"]}><ExamCheck /></Guard>} />
              <Route path="/studio" element={<Guard roles={["teacher"]}><Studio /></Guard>} />
              <Route path="/tests" element={<Guard roles={["teacher", "student", "director"]}><Tests /></Guard>} />
              <Route path="/tests/:id/take" element={<Guard roles={["student"]}><TakeTest /></Guard>} />
              <Route path="/lab" element={<LabPage />} />
              <Route path="/assistant" element={<Assistant />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/student/:id" element={<Guard roles={["teacher", "director"]}><StudentProfile /></Guard>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        )}
        <Toast />
      </ChildProvider>
    </HashRouter>
  );
}
