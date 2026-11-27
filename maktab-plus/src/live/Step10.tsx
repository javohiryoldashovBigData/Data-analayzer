// Step 10: learning centers — groups.
// A group is a class with a name; once it exists, attendance, lesson cards,
// tests, grades and Telegram alerts work exactly like in a school.
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { I18n } from "./i18n";
import { Badge, Card, Empty, Icon, Progress } from "../components/ui";
import { Dialog } from "./Family";

type Slot = { day: number; period: number; start?: string; end?: string };
type Group = { id: string; name: string; course: string | null; subject_id: number | null; subject: string | null; teacher_id: string | null; teacher: string | null;
  starts_on: string | null; ends_on: string | null; capacity: number | null; archived: boolean; students: number; schedule: Slot[] };
type Options = { teachers: { id: string; name: string }[]; subjects: { id: number; name: string }[]; periods: { number: number; start: string; end: string }[] };
const DAYS = ["", "day_1", "day_2", "day_3", "day_4", "day_5", "day_6"];
const hm = (t?: string) => (t ?? "").slice(0, 5);

function useJson<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState(false);
  const reload = () => { if (!path) return; setErr(false); api<T>(path).then(setData).catch(() => setErr(true)); };
  useEffect(reload, [path, ...deps]);  // eslint-disable-line react-hooks/exhaustive-deps
  return { data, err, reload };
}

export function CenterGroups({ i }: { i: I18n }) {
  const { t } = i;
  const groups = useJson<Group[]>("/center/groups");
  const opts = useJson<Options>("/center/options");
  const [edit, setEdit] = useState<Partial<Group> | null>(null);
  const [open, setOpen] = useState<Group | null>(null);
  if (!groups.data || !opts.data) return <Card title={t("cg_title")}><Empty icon="loader">{groups.err ? t("error") : t("loading")}</Empty></Card>;
  if (open) return <GroupDetail i={i} g={open} onBack={() => { setOpen(null); groups.reload(); }} />;
  const when = (g: Group) => g.schedule.length === 0 ? t("cg_no_schedule")
    : `${g.schedule.map((s) => t(DAYS[s.day])).join(", ")} · ${hm(g.schedule[0].start)}${g.schedule.some((s) => s.start !== g.schedule[0].start) ? "…" : ""}`;
  return (
    <Card title={<span><Icon name="users-group" /> {t("cg_title")}</span>} sub={t("cg_sub", { n: groups.data.filter((g) => !g.archived).length })}
      right={<button className="btn btn-sm btn-primary" onClick={() => setEdit({ schedule: [] })}><Icon name="plus" />{t("cg_new")}</button>}>
      {groups.data.length === 0 ? <Empty icon="users-group">{t("cg_empty")}</Empty> : (
        <div className="list">{groups.data.map((g) => {
          const pct = g.capacity ? Math.round((100 * g.students) / g.capacity) : null;
          return (
            <div key={g.id} className="list-item" style={{ alignItems: "flex-start", opacity: g.archived ? 0.6 : 1 }}>
              <Icon name="users-group" />
              <div className="grow" style={{ minWidth: 0 }}>
                <b>{g.name}</b> {g.archived && <Badge>{t("cg_archived")}</Badge>}
                <div className="small muted">{[g.course, g.subject, g.teacher].filter(Boolean).join(" · ")}</div>
                <div className="small"><Icon name="clock" /> {when(g)}</div>
                {g.capacity && <div style={{ maxWidth: 260, marginTop: 4 }}><Progress value={pct ?? 0} /></div>}
              </div>
              <div className="stack" style={{ alignItems: "flex-end", gap: 6 }}>
                <Badge tone={pct !== null && pct >= 100 ? "warn" : "brand"}>{t("cg_count", { n: g.students, c: g.capacity ?? "—" })}</Badge>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-sm" onClick={() => setOpen(g)}><Icon name="list" />{t("cg_students")}</button>
                  <button className="btn btn-sm btn-ghost" aria-label={t("cg_edit")} onClick={() => setEdit(g)}><Icon name="pencil" /></button>
                </div>
              </div>
            </div>);
        })}</div>
      )}
      {edit && <GroupForm i={i} g={edit} opts={opts.data} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); groups.reload(); }} />}
    </Card>
  );
}

function GroupForm({ i, g, opts, onClose, onSaved }: { i: I18n; g: Partial<Group>; opts: Options; onClose: () => void; onSaved: () => void }) {
  const { t } = i;
  const [f, setF] = useState({ name: g.name ?? "", course: g.course ?? "", subject_id: g.subject_id ?? opts.subjects[0]?.id ?? 0,
    teacher_id: g.teacher_id ?? opts.teachers[0]?.id ?? "", starts_on: g.starts_on ?? "", ends_on: g.ends_on ?? "",
    capacity: g.capacity ? String(g.capacity) : "", archived: g.archived ?? false });
  const [slots, setSlots] = useState<Record<number, number>>(Object.fromEntries((g.schedule ?? []).map((s) => [s.day, s.period])));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true); setErr("");
    try {
      await api("/center/group", { method: "POST", body: JSON.stringify({ ...f, id: g.id, capacity: f.capacity ? Number(f.capacity) : null,
        subject_id: Number(f.subject_id), schedule: Object.entries(slots).map(([day, period]) => ({ day: Number(day), period })) }) });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? t(`cg_e_${e.code}`) : t("error")); }
    finally { setBusy(false); }
  };
  const field = (id: string, label: string, el: React.ReactNode) => <div className="field"><label className="label" htmlFor={id}>{label}</label>{el}</div>;
  return (
    <Dialog title={g.id ? t("cg_edit") : t("cg_new")} onClose={onClose} closeLabel={t("cancel")}>
      <div className="stack">
        {field("gf-name", t("cg_name"), <input id="gf-name" className="input" maxLength={80} placeholder="IELTS 6.5 — kechki" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />)}
        <div className="grid grid-2">
          {field("gf-course", t("cg_course"), <input id="gf-course" className="input" maxLength={80} placeholder="IELTS" value={f.course} onChange={(e) => setF({ ...f, course: e.target.value })} />)}
          {field("gf-subj", t("subject"), <select id="gf-subj" className="select" style={{ width: "100%" }} value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: Number(e.target.value) })}>
            {opts.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>)}
          {field("gf-teacher", t("teacher"), <select id="gf-teacher" className="select" style={{ width: "100%" }} value={f.teacher_id} onChange={(e) => setF({ ...f, teacher_id: e.target.value })}>
            {opts.teachers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>)}
          {field("gf-cap", t("cg_capacity"), <input id="gf-cap" className="input" inputMode="numeric" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value.replace(/\D/g, "").slice(0, 3) })} />)}
          {field("gf-start", t("cg_starts"), <input id="gf-start" className="input" type="date" value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value })} />)}
          {field("gf-end", t("cg_ends"), <input id="gf-end" className="input" type="date" value={f.ends_on} onChange={(e) => setF({ ...f, ends_on: e.target.value })} />)}
        </div>
        <div className="field"><span className="label">{t("cg_schedule")}</span>
          <div className="stack" style={{ gap: 6 }}>{[1, 2, 3, 4, 5, 6].map((d) => (
            <div key={d} className="row" style={{ gap: 8 }}>
              <label className="row" style={{ gap: 6, minWidth: 110 }}><input type="checkbox" checked={slots[d] !== undefined}
                onChange={(e) => { const n = { ...slots }; if (e.target.checked) n[d] = opts.periods[0]?.number ?? 1; else delete n[d]; setSlots(n); }} />{t(`${DAYS[d]}_full`)}</label>
              {slots[d] !== undefined && <select className="select" aria-label={t(`${DAYS[d]}_full`)} value={slots[d]} onChange={(e) => setSlots({ ...slots, [d]: Number(e.target.value) })}>
                {opts.periods.map((p) => <option key={p.number} value={p.number}>{hm(p.start)}–{hm(p.end)}</option>)}</select>}
            </div>))}</div></div>
        {g.id && <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} />{t("cg_archive")}</label>}
        {err && <div className="callout callout-warn"><Icon name="alert-triangle" /><div>{err}</div></div>}
        <button className="btn btn-primary" disabled={busy || f.name.trim().length < 2 || !f.teacher_id} onClick={save}><Icon name="check" />{t("save")}</button>
      </div>
    </Dialog>
  );
}

type Member = { student_id: string; name: string; own_phone: string | null; enrolled_at: string; parent: string | null };
function GroupDetail({ i, g, onBack }: { i: I18n; g: Group; onBack: () => void }) {
  const { t } = i;
  const members = useJson<Member[]>(`/center/group/students?id=${g.id}`);
  const [q, setQ] = useState("");
  const found = useJson<{ student_id: string; name: string; groups: string[] }[]>(q.trim().length >= 2 ? `/center/students?q=${encodeURIComponent(q)}` : null, [q]);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const enroll = async (student_id: string, active: boolean) => {
    setMsg(null);
    try { await api("/center/enroll", { method: "POST", body: JSON.stringify({ group_id: g.id, student_id, active }) }); members.reload(); setQ(""); setMsg({ ok: true, text: t(active ? "cg_added" : "cg_left") }); }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiError && e.code === "group_full" ? t("cg_e_group_full") : t("error") }); }
  };
  const inGroup = new Set((members.data ?? []).map((m) => m.student_id));
  return (
    <Card title={<span><button className="btn btn-sm btn-ghost" aria-label={t("back")} onClick={onBack}><Icon name="arrow-left" /></button> {g.name}</span>}
      sub={[g.teacher, t("cg_count", { n: members.data?.length ?? g.students, c: g.capacity ?? "—" })].filter(Boolean).join(" · ")}
      right={<button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}><Icon name="user-plus" />{t("cg_new_student")}</button>}>
      {msg && <div className={`callout ${msg.ok ? "callout-info" : "callout-warn"}`} style={{ marginBottom: 12 }}><Icon name={msg.ok ? "check" : "alert-triangle"} /><div>{msg.text}</div></div>}
      <input className="input" placeholder={t("cg_find_student")} aria-label={t("cg_find_student")} value={q} onChange={(e) => setQ(e.target.value)} />
      {q.trim().length >= 2 && (
        <div className="list" style={{ marginTop: 8 }}>{(found.data ?? []).filter((s) => !inGroup.has(s.student_id)).slice(0, 8).map((s) => (
          <div key={s.student_id} className="list-item"><Icon name="user" /><div className="grow"><b>{s.name}</b>
            <div className="small muted">{s.groups.length ? s.groups.join(", ") : t("cg_no_group")}</div></div>
            <button className="btn btn-sm" onClick={() => enroll(s.student_id, true)}><Icon name="plus" />{t("cg_add")}</button></div>))}
          {found.data && found.data.filter((s) => !inGroup.has(s.student_id)).length === 0 && <p className="small muted">{t("cg_not_found")}</p>}
        </div>)}
      <div className="list" style={{ marginTop: 12 }}>{(members.data ?? []).map((m) => (
        <div key={m.student_id} className="list-item">
          <Icon name="user" />
          <div className="grow"><b>{m.name}</b>
            <div className="small muted">{m.own_phone ? <><Icon name="device-mobile" /> {m.own_phone} · {t("cg_own_login")}</> : m.parent ? <><Icon name="heart-handshake" /> {m.parent}</> : t("cg_no_contact")}</div></div>
          <button className="btn btn-sm btn-ghost" onClick={() => enroll(m.student_id, false)}><Icon name="logout" />{t("cg_remove")}</button>
        </div>))}</div>
      {adding && <NewStudent i={i} group={g} onClose={() => setAdding(false)} onDone={(text) => { setAdding(false); members.reload(); setMsg({ ok: true, text }); }} />}
    </Card>
  );
}

// a new student goes through the same checked import as the Excel file (one row)
function NewStudent({ i, group, onClose, onDone }: { i: I18n; group: Group; onClose: () => void; onDone: (msg: string) => void }) {
  const { t } = i;
  const [adult, setAdult] = useState(false);
  const [f, setF] = useState({ last_name: "", first_name: "", birth_date: "", phone: "", parent_first_name: "", parent_last_name: "", parent_phone: "", relation: "ona" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [logins, setLogins] = useState<{ name: string; login: string; password: string }[] | null>(null);
  const save = async () => {
    setBusy(true); setErr("");
    const row = { row: 1, ...f, class: group.name, birth_date: f.birth_date ? f.birth_date.split("-").reverse().join(".") : "",
      ...(adult ? { parent_first_name: "", parent_last_name: "", parent_phone: "" } : { phone: f.phone }) };
    try {
      const r = await api<{ ok: boolean; committed: boolean; errors: { code: string; field: string }[]; logins?: { name: string; login: string; password: string }[] }>(
        "/office/import", { method: "POST", body: JSON.stringify({ commit: true, data: { students: [row] } }) });
      if (!r.committed) { setErr(r.errors.map((e) => t(`imp_e_${e.code}`)).join(" · ")); return; }
      if (r.logins?.length) setLogins(r.logins); else onDone(t("cg_added"));
    } catch { setErr(t("error")); } finally { setBusy(false); }
  };
  if (logins) return (
    <Dialog title={t("cg_new_student")} onClose={() => onDone(t("cg_added"))} closeLabel={t("imp_done")}>
      <div className="stack"><div className="callout callout-warn"><Icon name="key" /><div>{t("imp_pw_once", { n: logins.length })}</div></div>
        {logins.map((l) => <div key={l.login} className="list-item"><b className="grow">{l.name}</b><span className="tnum">{l.login}</span><code>{l.password}</code></div>)}
        <button className="btn btn-primary" onClick={() => onDone(t("cg_added"))}>{t("imp_done")}</button></div>
    </Dialog>);
  const inp = (k: keyof typeof f, label: string, extra: Record<string, string> = {}) => (
    <div className="field"><label className="label" htmlFor={`ns-${k}`}>{label}</label>
      <input id={`ns-${k}`} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></div>);
  return (
    <Dialog title={`${t("cg_new_student")} · ${group.name}`} onClose={onClose} closeLabel={t("cancel")}>
      <div className="stack">
        <div className="grid grid-2">{inp("last_name", t("cg_last"))}{inp("first_name", t("cg_first"))}</div>
        {inp("birth_date", t("cg_birth"), { type: "date" })}
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />{t("cg_adult")}</label>
        {adult ? inp("phone", t("cg_own_phone"), { inputMode: "tel", placeholder: "+998 90 123 45 67" }) : (
          <>
            <div className="grid grid-2">{inp("parent_last_name", t("cg_parent_last"))}{inp("parent_first_name", t("cg_parent_first"))}</div>
            {inp("parent_phone", t("cg_parent_phone"), { inputMode: "tel", placeholder: "+998 90 123 45 67" })}
            {inp("phone", t("cg_teen_phone"), { inputMode: "tel" })}
          </>)}
        {err && <div className="callout callout-warn"><Icon name="alert-triangle" /><div>{err}</div></div>}
        <button className="btn btn-primary" disabled={busy || !f.last_name.trim() || !f.first_name.trim()} onClick={save}><Icon name="check" />{t("save")}</button>
      </div>
    </Dialog>
  );
}
