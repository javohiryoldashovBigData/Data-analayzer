// Step 11: a new director's "first steps" + quick "add a teacher" (no Excel needed).
import { useEffect, useState } from "react";
import { api } from "./api";
import type { I18n } from "./i18n";
import { Badge, Card, Icon } from "../components/ui";
import { Dialog } from "./Family";

type Steps = { kind: "school" | "center"; teachers: number; classes: number; students: number; timetable: number; telegram: boolean };
const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

export function FirstSteps({ i }: { i: I18n }) {
  const { t } = i;
  const [s, setS] = useState<Steps | null>(null);
  const [adding, setAdding] = useState(false);
  const load = () => api<Steps>("/office/first-steps").then(setS).catch(() => setS(null));
  useEffect(() => { load(); }, []);
  if (!s) return null;
  const rows: { done: boolean; label: string; count?: number; action: React.ReactNode }[] = [
    { done: s.teachers > 0, label: t("fs_teachers"), count: s.teachers,
      action: <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}><Icon name="user-plus" />{t("fs_add_teacher")}</button> },
    s.kind === "center"
      ? { done: s.classes > 0, label: t("fs_groups"), count: s.classes, action: <button className="btn btn-sm" onClick={() => go("sec-groups")}>{t("fs_go")}</button> }
      : { done: s.classes > 0 && s.timetable > 0, label: t("fs_classes"), count: s.classes, action: <button className="btn btn-sm" onClick={() => go("sec-setup")}>{t("fs_go")}</button> },
    { done: s.students > 0, label: t("fs_students"), count: s.students,
      action: <button className="btn btn-sm" onClick={() => go(s.kind === "center" ? "sec-groups" : "sec-setup")}>{t("fs_go")}</button> },
    { done: s.telegram, label: t("fs_telegram"), action: <button className="btn btn-sm" onClick={() => go("sec-telegram")}>{t("fs_go")}</button> },
  ];
  if (rows.every((r) => r.done)) return null;
  return (
    <Card title={<span><Icon name="list-check" /> {t("fs_title")}</span>} sub={t("fs_sub")}>
      <div className="list">{rows.map((r, k) => (
        <div key={k} className="list-item">
          <span className="role-icon" style={{ width: 30, height: 30, background: r.done ? "var(--good-soft)" : "var(--surface-2)", color: r.done ? "var(--good)" : "var(--muted)" }}>
            {r.done ? <Icon name="check" /> : <b>{k + 1}</b>}</span>
          <div className="grow"><b style={{ textDecoration: r.done ? "line-through" : undefined, opacity: r.done ? 0.7 : 1 }}>{r.label}</b>
            {r.count !== undefined && r.count > 0 && <> <Badge tone="good">{t("fs_done", { n: r.count })}</Badge></>}</div>
          {!r.done && r.action}
        </div>))}</div>
      {adding && <AddTeacher i={i} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
    </Card>
  );
}

// one teacher → the same checked import as the Excel file (one row)
export function AddTeacher({ i, onClose, onDone }: { i: I18n; onClose: () => void; onDone: () => void }) {
  const { t } = i;
  const [f, setF] = useState({ last_name: "", first_name: "", phone: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [login, setLogin] = useState<{ name: string; login: string; password: string } | null>(null);
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api<{ committed: boolean; errors: { code: string }[]; logins?: { name: string; login: string; password: string }[] }>(
        "/office/import", { method: "POST", body: JSON.stringify({ commit: true, data: { teachers: [{ row: 1, ...f }] } }) });
      if (!r.committed) { setErr(r.errors.map((e) => t(`imp_e_${e.code}`)).join(" · ")); return; }
      if (r.logins?.length) setLogin(r.logins[0]); else onDone();
    } catch { setErr(t("error")); } finally { setBusy(false); }
  };
  if (login) return (
    <Dialog title={t("at_title")} onClose={onDone} closeLabel={t("imp_done")}>
      <div className="stack">
        <div className="callout callout-warn"><Icon name="key" /><div>{t("imp_pw_once", { n: 1 })}</div></div>
        <div className="list-item"><b className="grow">{login.name}</b><span className="tnum">{login.login}</span><code>{login.password}</code></div>
        <button className="btn btn-primary" onClick={onDone}>{t("imp_done")}</button>
      </div>
    </Dialog>);
  return (
    <Dialog title={t("at_title")} onClose={onClose} closeLabel={t("cancel")}>
      <div className="stack">
        <div className="grid grid-2">
          <div className="field"><label className="label" htmlFor="at-last">{t("cg_last")}</label><input id="at-last" className="input" value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></div>
          <div className="field"><label className="label" htmlFor="at-first">{t("cg_first")}</label><input id="at-first" className="input" value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></div>
        </div>
        <div className="field"><label className="label" htmlFor="at-phone">{t("at_phone")}</label><input id="at-phone" className="input" inputMode="tel" placeholder="+998 90 123 45 67" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        {err && <div className="callout callout-warn"><Icon name="alert-triangle" /><div>{err}</div></div>}
        <button className="btn btn-primary" disabled={busy || !f.last_name.trim() || !f.first_name.trim() || f.phone.replace(/\D/g, "").length < 9} onClick={save}><Icon name="check" />{t("save")}</button>
      </div>
    </Dialog>
  );
}
