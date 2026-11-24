// Step 6: quarter grades and yearly grades.
//  - Teacher sets QUARTER grades (the system suggests, the teacher decides; a
//    grade 1+ away from the suggestion needs a short reason).
//  - Teacher PROPOSES yearly grades once the zavuch opens the window.
//  - Zavuch / director CONFIRM per class + subject (a change needs a reason).
//  - Parents and students see a report card; yearly grades after confirmation.
import { useEffect, useState } from "react";
import { api, ApiError, type Home, type Kid } from "./api";
import type { I18n } from "./i18n";
import { Badge, Card, Empty, Icon, Segmented } from "../components/ui";

type QRow = { student_id: string; first_name: string; last_name: string; count: number; avg: number | null; suggested: number | null; quarter: number | null; note: string | null };
type QSheet = { term: { id: string; number: number; start_date: string; end_date: string }; students: QRow[] };
type YRow = { student_id: string; first_name: string; last_name: string; quarters: (number | null)[]; exam: number | null; missing_quarters: number;
  suggested: number | null; final: number | null;
  proposal: { proposed: number; note: string | null; status: "proposed" | "confirmed"; confirmed_value: number | null; change_reason: string | null } | null };
type YSheet = { window_open: boolean; students: YRow[] };
type Edit = Record<string, { value: number | null; note: string }>;

const ROMAN = ["I", "II", "III", "IV"];
const needsReason = (value: number | null, suggested: number | null) => value != null && (suggested == null || Math.abs(value - suggested) >= 1);

function useJson<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState(false);
  const reload = () => { if (!path) return; setErr(false); setData(null); api<T>(path).then(setData).catch(() => setErr(true)); };
  useEffect(reload, [path, ...deps]);  // eslint-disable-line react-hooks/exhaustive-deps
  return { data, err, reload };
}

export function GradePicker({ value, onChange, disabled, label }: { value: number | null; onChange: (v: number) => void; disabled?: boolean; label: string }) {
  return (
    <div className="row" role="radiogroup" aria-label={label} style={{ gap: 4, flexWrap: "nowrap" }}>
      {[1, 2, 3, 4, 5].map((v) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled}
          className={`btn btn-sm ${value === v ? "btn-primary" : ""}`} style={{ minWidth: 34, padding: "4px 0", justifyContent: "center" }}
          onClick={() => onChange(v)}>{v}</button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- teacher
export function TeacherGrades({ i, home }: { i: I18n; home: Home }) {
  const { t } = i;
  const pairs = home.assignments ?? [];
  const [pair, setPair] = useState(pairs[0] ? `${pairs[0].class_id}|${pairs[0].subject_id}` : "");
  const [mode, setMode] = useState<"quarter" | "year">("quarter");
  if (!pairs.length) return <Card><Empty icon="star">{t("nothing")}</Empty></Card>;
  const [classId, subjectId] = pair.split("|");
  return (
    <>
      <Card>
        <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
          <div className="field" style={{ margin: 0 }}><label className="label" htmlFor="gr-pair">{t("class_subject")}</label>
            <select id="gr-pair" className="select" value={pair} onChange={(e) => setPair(e.target.value)}>
              {pairs.map((p) => <option key={`${p.class_id}|${p.subject_id}`} value={`${p.class_id}|${p.subject_id}`}>{p.class} · {p.subject}</option>)}
            </select></div>
          <Segmented value={mode} onChange={setMode} items={[{ id: "quarter", label: t("gr_quarter") }, { id: "year", label: t("gr_year") }]} />
        </div>
      </Card>
      {mode === "quarter" ? <QuarterSheet key={pair} i={i} classId={classId} subjectId={Number(subjectId)} />
                          : <YearSheet key={pair} i={i} classId={classId} subjectId={Number(subjectId)} />}
    </>
  );
}

function QuarterSheet({ i, classId, subjectId }: { i: I18n; classId: string; subjectId: number }) {
  const { t } = i;
  const sheet = useJson<QSheet>(`/grades/quarter?class=${classId}&subject=${subjectId}`);
  const [edit, setEdit] = useState<Edit>({});
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [bad, setBad] = useState("");
  useEffect(() => {
    if (sheet.data) setEdit(Object.fromEntries(sheet.data.students.map((s) => [s.student_id, { value: s.quarter ?? s.suggested, note: s.note ?? "" }])));
  }, [sheet.data]);
  if (!sheet.data) return <Card><Empty icon="loader">{sheet.err ? t("error") : t("loading")}</Empty></Card>;
  const rows = sheet.data.students;
  const missing = rows.filter((s) => edit[s.student_id]?.value == null).length;
  const reasonsMissing = rows.filter((s) => needsReason(edit[s.student_id]?.value ?? null, s.suggested) && !edit[s.student_id]?.note.trim()).length;
  const save = async () => {
    setBusy(true); setMsg(null); setBad("");
    try {
      const r = await api<{ saved: number }>("/grades/quarter", { method: "POST", body: JSON.stringify({ class_id: classId, subject_id: subjectId, term_id: sheet.data!.term.id,
        rows: rows.filter((s) => edit[s.student_id]?.value != null).map((s) => ({ student_id: s.student_id, value: edit[s.student_id].value, note: edit[s.student_id].note })) }) });
      setMsg({ ok: true, text: t("gr_saved", { n: r.saved }) }); sheet.reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError && e.code === "reason_required" ? t("gr_reason_needed") : t("error") });
    } finally { setBusy(false); }
  };
  const tm = sheet.data.term;
  return (
    <Card title={t("gr_quarter_title", { n: ROMAN[tm.number - 1] })} sub={`${i.date(tm.start_date)} – ${i.date(tm.end_date)} · ${t("gr_quarter_sub")}`}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th className="sticky-col">{t("student")}</th><th>{t("gr_marks")}</th><th>{t("gr_avg")}</th><th>{t("gr_suggested")}</th><th>{t("gr_grade")}</th><th>{t("gr_reason")}</th></tr></thead>
          <tbody>{rows.map((s) => {
            const e = edit[s.student_id] ?? { value: null, note: "" };
            const need = needsReason(e.value, s.suggested);
            return (
              <tr key={s.student_id} style={bad === s.student_id ? { outline: "2px solid var(--warn)" } : undefined}>
                <td className="sticky-col"><b>{s.last_name} {s.first_name}</b></td>
                <td className="tnum">{s.count}</td>
                <td className="tnum">{s.avg ?? "—"}</td>
                <td>{s.suggested != null ? <b className="tnum">{s.suggested}</b> : <span className="small muted">{t("gr_few_marks")}</span>}</td>
                <td><GradePicker label={`${s.last_name} ${s.first_name}`} value={e.value} onChange={(v) => setEdit({ ...edit, [s.student_id]: { ...e, value: v } })} /></td>
                <td>{need ? <input className="input" style={{ minWidth: 200, borderColor: e.note.trim() ? undefined : "var(--warn)" }}
                  placeholder={t("gr_reason_ph")} aria-label={t("gr_reason")} value={e.note} maxLength={500}
                  onChange={(ev) => setEdit({ ...edit, [s.student_id]: { ...e, note: ev.target.value } })} /> : <span className="small muted">—</span>}</td>
              </tr>);
          })}</tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 14, flexWrap: "wrap", gap: 10 }}>
        <button className="btn btn-primary" disabled={busy || reasonsMissing > 0} onClick={save}><Icon name="device-floppy" />{t("save")}</button>
        {reasonsMissing > 0 && <span className="small" style={{ color: "var(--warn)" }}><Icon name="pencil" /> {t("gr_reasons_left", { n: reasonsMissing })}</span>}
        {missing > 0 && <span className="small muted">{t("gr_not_set", { n: missing })}</span>}
      </div>
      {msg && <div className={`callout ${msg.ok ? "callout-info" : "callout-warn"}`} style={{ marginTop: 12 }}><Icon name={msg.ok ? "check" : "alert-triangle"} /><div>{msg.text}</div></div>}
      <p className="small muted" style={{ marginTop: 10 }}><Icon name="scale" /> {t("gr_fair_note")}</p>
    </Card>
  );
}

function YearSheet({ i, classId, subjectId }: { i: I18n; classId: string; subjectId: number }) {
  const { t } = i;
  const sheet = useJson<YSheet>(`/grades/year?class=${classId}&subject=${subjectId}`);
  const [edit, setEdit] = useState<Edit>({});
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (sheet.data) setEdit(Object.fromEntries(sheet.data.students.map((s) => [s.student_id, { value: s.proposal?.proposed ?? s.suggested, note: s.proposal?.note ?? "" }])));
  }, [sheet.data]);
  if (!sheet.data) return <Card><Empty icon="loader">{sheet.err ? t("error") : t("loading")}</Empty></Card>;
  const { students: rows, window_open } = sheet.data;
  const open = rows.filter((s) => s.proposal?.status !== "confirmed");
  const reasonsMissing = open.filter((s) => needsReason(edit[s.student_id]?.value ?? null, s.suggested) && !edit[s.student_id]?.note.trim()).length;
  const unset = open.filter((s) => edit[s.student_id]?.value == null).length;
  const send = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ proposed: number }>("/grades/year/propose", { method: "POST", body: JSON.stringify({ class_id: classId, subject_id: subjectId,
        rows: open.filter((s) => edit[s.student_id]?.value != null).map((s) => ({ student_id: s.student_id, value: edit[s.student_id].value, note: edit[s.student_id].note })) }) });
      setMsg({ ok: true, text: t("gr_sent", { n: r.proposed }) }); sheet.reload();
    } catch (e) { setMsg({ ok: false, text: e instanceof ApiError && e.code === "reason_required" ? t("gr_reason_needed") : t("error") }); }
    finally { setBusy(false); }
  };
  return (
    <Card title={t("gr_year_title")} sub={t("gr_year_sub")}
      right={window_open ? <Badge tone="good" icon="lock-open">{t("gr_window_open")}</Badge> : <Badge icon="lock">{t("gr_window_closed")}</Badge>}>
      {!window_open && <div className="callout callout-info" style={{ marginBottom: 12 }}><Icon name="info-circle" /><div>{t("gr_window_wait")}</div></div>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th className="sticky-col">{t("student")}</th>{ROMAN.map((r) => <th key={r}>{r}</th>)}<th>{t("gr_suggested")}</th><th>{t("gr_grade")}</th><th>{t("gr_reason")}</th><th>{t("status")}</th></tr></thead>
          <tbody>{rows.map((s) => {
            const e = edit[s.student_id] ?? { value: null, note: "" };
            const done = s.proposal?.status === "confirmed";
            const need = !done && needsReason(e.value, s.suggested);
            return (
              <tr key={s.student_id}>
                <td className="sticky-col"><b>{s.last_name} {s.first_name}</b></td>
                {[0, 1, 2, 3].map((k) => <td key={k} className="tnum">{s.quarters?.[k] ?? <span className="muted">·</span>}</td>)}
                <td><b className="tnum">{s.suggested ?? "—"}</b></td>
                <td>{done ? <b className="tnum">{s.final ?? s.proposal?.confirmed_value}</b>
                  : <GradePicker label={`${s.last_name} ${s.first_name}`} value={e.value} disabled={!window_open} onChange={(v) => setEdit({ ...edit, [s.student_id]: { ...e, value: v } })} />}</td>
                <td>{done ? <span className="small muted">{s.proposal?.change_reason ?? "—"}</span>
                  : need ? <input className="input" style={{ minWidth: 200, borderColor: e.note.trim() ? undefined : "var(--warn)" }} disabled={!window_open}
                      placeholder={t("gr_reason_ph")} aria-label={t("gr_reason")} value={e.note} maxLength={500}
                      onChange={(ev) => setEdit({ ...edit, [s.student_id]: { ...e, note: ev.target.value } })} /> : <span className="small muted">—</span>}</td>
                <td>{done ? <Badge tone="good" icon="circle-check">{t("gr_confirmed")}</Badge>
                  : s.proposal ? <Badge tone="warn" icon="send">{t("gr_proposed")}</Badge> : <span className="small muted">—</span>}</td>
              </tr>);
          })}</tbody>
        </table>
      </div>
      {window_open && open.length > 0 && (
        <div className="row" style={{ marginTop: 14, flexWrap: "wrap", gap: 10 }}>
          <button className="btn btn-primary" disabled={busy || reasonsMissing > 0 || unset > 0} onClick={send}><Icon name="send" />{t("gr_send")}</button>
          {reasonsMissing > 0 && <span className="small" style={{ color: "var(--warn)" }}><Icon name="pencil" /> {t("gr_reasons_left", { n: reasonsMissing })}</span>}
          {unset > 0 && <span className="small muted">{t("gr_not_set", { n: unset })}</span>}
        </div>
      )}
      {msg && <div className={`callout ${msg.ok ? "callout-info" : "callout-warn"}`} style={{ marginTop: 12 }}><Icon name={msg.ok ? "check" : "alert-triangle"} /><div>{msg.text}</div></div>}
      <p className="small muted" style={{ marginTop: 10 }}><Icon name="shield-check" /> {t("gr_year_note")}</p>
    </Card>
  );
}

// ---------------------------------------------------------------- zavuch / director
type ORow = { class_id: string; class: string; subject_id: number; subject: string; teacher: string; students: number;
  quarter_done: number; proposed: number; confirmed: number; to_check: number };
type Overview = { window_open: boolean; term_number: number | null; rows: ORow[] };

export function GradesOverview({ i }: { i: I18n }) {
  const { t } = i;
  const ov = useJson<Overview>("/office/grades");
  const [open, setOpen] = useState<ORow | null>(null);
  const [busy, setBusy] = useState(false);
  if (!ov.data) return <Card title={t("gr_overview")}><Empty icon="loader">{ov.err ? t("error") : t("loading")}</Empty></Card>;
  if (open) return <ConfirmSheet i={i} row={open} onBack={() => { setOpen(null); ov.reload(); }} />;
  const toggle = async () => {
    setBusy(true);
    try { await api("/office/grades/window", { method: "POST", body: JSON.stringify({ open: !ov.data!.window_open }) }); ov.reload(); } finally { setBusy(false); }
  };
  const d = ov.data;
  return (
    <Card title={<span><Icon name="certificate" /> {t("gr_overview")}</span>} sub={t("gr_overview_sub", { n: d.term_number ? ROMAN[d.term_number - 1] : "—" })}
      right={<button className={`btn btn-sm ${d.window_open ? "" : "btn-primary"}`} disabled={busy} onClick={toggle}>
        <Icon name={d.window_open ? "lock" : "lock-open"} />{t(d.window_open ? "gr_close_window" : "gr_open_window")}</button>}>
      <p className="small muted" style={{ marginTop: 0 }}>{t(d.window_open ? "gr_window_is_open" : "gr_window_hint")}</p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th className="sticky-col">{t("class_subject")}</th><th>{t("teacher")}</th><th>{t("gr_q_done")}</th><th>{t("gr_y_proposed")}</th><th>{t("gr_to_check")}</th><th>{t("gr_confirmed")}</th><th></th></tr></thead>
          <tbody>{d.rows.map((r) => {
            const ready = r.proposed === r.students && r.confirmed < r.students;
            return (
              <tr key={`${r.class_id}|${r.subject_id}`}>
                <td className="sticky-col"><b>{r.class}</b> · {r.subject}</td>
                <td className="small">{r.teacher}</td>
                <td className="tnum">{r.quarter_done === r.students ? <Badge tone="good">{r.quarter_done}/{r.students}</Badge> : `${r.quarter_done}/${r.students}`}</td>
                <td className="tnum">{r.proposed}/{r.students}</td>
                <td>{r.to_check > 0 ? <Badge tone="warn" icon="eye">{r.to_check}</Badge> : <span className="muted">0</span>}</td>
                <td>{r.confirmed === r.students && r.students > 0 ? <Badge tone="good" icon="circle-check">{t("gr_all")}</Badge> : <span className="tnum">{r.confirmed}</span>}</td>
                <td>{r.proposed > 0 && <button className={`btn btn-sm ${ready ? "btn-primary" : ""}`} onClick={() => setOpen(r)}>{t(ready ? "gr_review" : "gr_view")}</button>}</td>
              </tr>);
          })}</tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}><Icon name="scale" /> {t("no_ranking")}</p>
    </Card>
  );
}

function ConfirmSheet({ i, row, onBack }: { i: I18n; row: ORow; onBack: () => void }) {
  const { t } = i;
  const sheet = useJson<YSheet>(`/grades/year?class=${row.class_id}&subject=${row.subject_id}`);
  const [chg, setChg] = useState<Record<string, { value: number; reason: string }>>({});
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!sheet.data) return <Card><Empty icon="loader">{sheet.err ? t("error") : t("loading")}</Empty></Card>;
  const rows = sheet.data.students;
  const pending = rows.filter((s) => s.proposal?.status === "proposed");
  const missing = rows.filter((s) => !s.proposal).length;
  const reasonsMissing = Object.values(chg).filter((c) => !c.reason.trim()).length;
  const confirm = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ confirmed: number }>("/office/grades/confirm", { method: "POST", body: JSON.stringify({ class_id: row.class_id, subject_id: row.subject_id,
        changes: Object.entries(chg).map(([student_id, c]) => ({ student_id, value: c.value, reason: c.reason })) }) });
      setMsg({ ok: true, text: t("gr_confirmed_n", { n: r.confirmed }) }); setChg({}); sheet.reload();
    } catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? t(`gr_err_${e.code}`) : t("error") }); }
    finally { setBusy(false); }
  };
  return (
    <Card title={<span><button className="btn btn-sm btn-ghost" aria-label={t("back")} onClick={onBack}><Icon name="arrow-left" /></button> {row.class} · {row.subject}</span>}
      sub={t("gr_confirm_sub", { t: row.teacher })}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th className="sticky-col">{t("student")}</th>{ROMAN.map((r) => <th key={r}>{r}</th>)}<th>{t("gr_suggested")}</th><th>{t("gr_teacher_grade")}</th><th>{t("gr_teacher_reason")}</th><th>{t("gr_final")}</th><th>{t("gr_reason")}</th></tr></thead>
          <tbody>{rows.map((s) => {
            const p = s.proposal; const c = chg[s.student_id];
            const flag = p && p.status === "proposed" && (p.note || p.proposed !== s.suggested);
            const bg = c ? "var(--brand-soft)" : flag ? "var(--warn-soft)" : undefined;   // changed by me / needs a look
            const value = c?.value ?? p?.confirmed_value ?? p?.proposed ?? null;
            return (
              <tr key={s.student_id} style={bg ? { background: bg } : undefined}>
                <td className="sticky-col" style={bg ? { background: bg } : undefined}><b>{s.last_name} {s.first_name}</b></td>
                {[0, 1, 2, 3].map((k) => <td key={k} className="tnum">{s.quarters?.[k] ?? <span className="muted">·</span>}</td>)}
                <td className="tnum">{s.suggested ?? "—"}</td>
                <td><b className="tnum">{p?.proposed ?? "—"}</b></td>
                <td className="small" style={{ whiteSpace: "normal", minWidth: 160 }}>{p?.note ?? <span className="muted">—</span>}</td>
                <td>{p?.status === "confirmed" ? <Badge tone="good" icon="circle-check">{p.confirmed_value}</Badge>
                  : p ? <GradePicker label={`${s.last_name} ${s.first_name}`} value={value}
                      onChange={(v) => { const n = { ...chg }; if (v === p.proposed) delete n[s.student_id]; else n[s.student_id] = { value: v, reason: c?.reason ?? "" }; setChg(n); }} />
                  : <span className="small muted">{t("gr_no_proposal")}</span>}</td>
                <td>{c ? <input className="input" style={{ minWidth: 200, borderColor: c.reason.trim() ? undefined : "var(--warn)" }} placeholder={t("gr_change_reason_ph")}
                    aria-label={t("gr_reason")} value={c.reason} maxLength={500} onChange={(ev) => setChg({ ...chg, [s.student_id]: { ...c, reason: ev.target.value } })} />
                  : p?.change_reason ? <span className="small muted">{p.change_reason}</span> : <span className="small muted">—</span>}</td>
              </tr>);
          })}</tbody>
        </table>
      </div>
      {pending.length > 0 && (
        <div className="row" style={{ marginTop: 14, flexWrap: "wrap", gap: 10 }}>
          <button className="btn btn-primary" disabled={busy || missing > 0 || reasonsMissing > 0} onClick={confirm}><Icon name="circle-check" />{t("gr_confirm_btn", { n: pending.length })}</button>
          {missing > 0 && <span className="small" style={{ color: "var(--warn)" }}>{t("gr_missing", { n: missing })}</span>}
          {reasonsMissing > 0 && <span className="small" style={{ color: "var(--warn)" }}><Icon name="pencil" /> {t("gr_reasons_left", { n: reasonsMissing })}</span>}
        </div>
      )}
      {msg && <div className={`callout ${msg.ok ? "callout-info" : "callout-warn"}`} style={{ marginTop: 12 }}><Icon name={msg.ok ? "check" : "alert-triangle"} /><div>{msg.text}</div></div>}
      <p className="small muted" style={{ marginTop: 10 }}><Icon name="history" /> {t("gr_audit_note")}</p>
    </Card>
  );
}

// ---------------------------------------------------------------- parent / student
type RC = { subject_id: number; subject: string; quarters: (number | null)[] | null; final: number | null }[];
export function ReportCard({ i, kid }: { i: I18n; kid: Kid }) {
  const { t } = i;
  const rc = useJson<RC>(`/family/report?student=${kid.id}`, [kid.id]);
  return (
    <Card title={<span><Icon name="certificate" /> {t("gr_report")}</span>} sub={t("gr_report_sub")}>
      {!rc.data ? <Empty icon="loader">{rc.err ? t("error") : t("loading")}</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th className="sticky-col">{t("subject")}</th>{ROMAN.map((r) => <th key={r}>{r}</th>)}<th>{t("gr_final")}</th></tr></thead>
            <tbody>{rc.data.map((r) => (
              <tr key={r.subject_id}>
                <td className="sticky-col"><b>{r.subject}</b></td>
                {[0, 1, 2, 3].map((k) => <td key={k} className="tnum">{r.quarters?.[k] ?? <span className="muted">·</span>}</td>)}
                <td>{r.final != null ? <b className="tnum">{r.final}</b> : <span className="muted">·</span>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      <p className="small muted" style={{ marginTop: 10 }}><Icon name="shield-check" /> {t("gr_report_note")}</p>
    </Card>
  );
}
