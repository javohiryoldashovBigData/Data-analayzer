// Step 9: safe accounts for pilots.
//  - ChangePassword: shown right after logging in with a first password (from
//    the Excel import or an office reset). The server refuses everything else
//    until it is done.
//  - PeopleCard: the school office finds a person and gives a new first password.
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { I18n } from "./i18n";
import { Badge, Card, Icon } from "../components/ui";

export function ChangePassword({ i, oldPassword, onDone, onCancel }: { i: I18n; oldPassword: string | null; onDone: (token: string) => void; onCancel: () => void }) {
  const { t } = i;
  const [old, setOld] = useState(oldPassword ?? "");
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const mismatch = pw2.length > 0 && pw !== pw2;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (mismatch || pw.length < 8) return;
    setBusy(true); setErr("");
    try {
      const r = await api<{ token: string }>("/password/change", { method: "POST", body: JSON.stringify({ old_password: old, new_password: pw }) });
      onDone(r.token);
    } catch (e) {
      const c = e instanceof ApiError ? e.code : "error";
      setErr(t(["wrong_password", "password_too_short", "password_same", "password_weak", "too_many_attempts"].includes(c) ? `pw_e_${c}` : "error"));
    } finally { setBusy(false); }
  };
  return (
    <Card title={<span><Icon name="key" /> {t("pw_title")}</span>} sub={t("pw_sub")}>
      <form className="stack" onSubmit={submit}>
        {oldPassword === null && (
          <div className="field"><label className="label" htmlFor="pw-old">{t("pw_old")}</label>
            <input id="pw-old" className="input" type={show ? "text" : "password"} autoComplete="current-password" value={old} onChange={(e) => setOld(e.target.value)} /></div>
        )}
        <div className="field"><label className="label" htmlFor="pw-new">{t("pw_new")}</label>
          <input id="pw-new" className="input" type={show ? "text" : "password"} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <div className="small muted">{t("pw_rules")}</div></div>
        <div className="field"><label className="label" htmlFor="pw-new2">{t("pw_repeat")}</label>
          <input id="pw-new2" className="input" type={show ? "text" : "password"} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          {mismatch && <div className="small" style={{ color: "var(--bad)" }}>{t("pw_mismatch")}</div>}</div>
        <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />{t("show_password")}</label>
        {err && <div className="callout callout-warn"><Icon name="alert-triangle" /><div>{err}</div></div>}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={busy || pw.length < 8 || pw !== pw2 || !old}><Icon name="check" />{t("pw_save")}</button>
          <button className="btn btn-ghost" type="button" onClick={onCancel}>{t("logout")}</button>
        </div>
      </form>
    </Card>
  );
}

type Person = { user_id: string; name: string; phone: string | null; roles: string[]; has_login: boolean; must_change: boolean; can_reset: boolean };
export function PeopleCard({ i }: { i: I18n }) {
  const { t } = i;
  const [q, setQ] = useState("");
  const [list, setList] = useState<Person[] | null>(null);
  const [given, setGiven] = useState<{ name: string; login: string; password: string } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const h = setTimeout(() => { api<Person[]>(`/office/people?q=${encodeURIComponent(q)}`).then(setList).catch(() => setList([])); }, 250);
    return () => clearTimeout(h);
  }, [q]);
  const reset = async (p: Person) => {
    setErr(""); setGiven(null);
    try { const r = await api<{ login: string; password: string }>("/office/reset-password", { method: "POST", body: JSON.stringify({ user_id: p.user_id }) }); setGiven({ name: p.name, ...r }); }
    catch (e) { setErr(e instanceof ApiError && e.code === "no_phone" ? t("ppl_no_phone") : t("error")); }
  };
  return (
    <Card title={<span><Icon name="users" /> {t("ppl_title")}</span>} sub={t("ppl_sub")}>
      <input className="input" placeholder={t("ppl_search")} aria-label={t("ppl_search")} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      {given && (
        <div className="callout callout-warn" style={{ marginBottom: 12 }}><Icon name="key" />
          <div><b>{given.name}</b>: login <span className="tnum">{given.login}</span>, {t("password").toLowerCase()} <code>{given.password}</code>
            <div className="small">{t("ppl_given_note")}</div></div></div>
      )}
      {err && <div className="callout callout-warn" style={{ marginBottom: 12 }}><Icon name="alert-triangle" /><div>{err}</div></div>}
      <div className="list">{(list ?? []).slice(0, 12).map((p) => (
        <div key={p.user_id} className="list-item">
          <Icon name="user" />
          <div className="grow"><b>{p.name}</b> <span className="small muted">· {p.roles.map((r) => t(`role_${r}`)).join(", ")}</span>
            <div className="small muted tnum">{p.phone ?? "—"} {p.must_change && <Badge tone="warn">{t("ppl_first_pw")}</Badge>} {!p.has_login && <Badge>{t("ppl_no_login")}</Badge>}</div></div>
          {p.can_reset && <button className="btn btn-sm" onClick={() => reset(p)}><Icon name="key" />{t(p.has_login ? "ppl_reset" : "ppl_give")}</button>}
        </div>))}</div>
    </Card>
  );
}
