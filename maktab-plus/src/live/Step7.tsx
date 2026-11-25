// Step 7: school fees, payments, debts.
//  - Accountant (and director / school admin): month overview, take a cash /
//    bank payment with a receipt, debts, gentle reminders, fee settings.
//  - Parent: invoices and receipts per child.
// Money is never shown to the zavuch, teachers or children; no child is ever
// blocked at the gate over debt. The database checks every call again.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type Home, type Kid } from "./api";
import type { I18n } from "./i18n";
import { Badge, Card, Empty, Icon, PageHead, Progress, Stat, Tabs } from "../components/ui";
import { Dialog } from "./Family";

export const som = (n: number | string | null | undefined) =>
  `${Math.round(Number(n ?? 0)).toLocaleString("ru-RU").replace(/ /g, " ")} so'm`;
const monthIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
const shiftMonth = (iso: string, k: number) => { const [y, m] = iso.split("-").map(Number); return monthIso(new Date(y, m - 1 + k, 1)); };

function useJson<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState(false);
  const reload = () => { if (!path) return; setErr(false); api<T>(path).then(setData).catch(() => setErr(true)); };
  useEffect(reload, [path, ...deps]);  // eslint-disable-line react-hooks/exhaustive-deps
  return { data, err, reload };
}
const Loading = ({ i, err }: { i: I18n; err: boolean }) => <Card><Empty icon="loader">{err ? i.t("error") : i.t("loading")}</Empty></Card>;

type Overview = {
  month: string;
  this_month: { invoices: number; billed: number; paid: number; remaining: number; paid_count: number };
  total_debt: number; families_in_debt: number;
  by_class: { class: string; billed: number; paid: number }[];
  debtors: { student_id: string; name: string; class: string; months: number; owed: number; oldest_due: string; last_reminder_at: string | null }[];
  recent_payments: { id: string; receipt_no: number; amount: number; provider: string; status: string; created_at: string; name: string; class: string; period_month: string }[];
};

// ---------------------------------------------------------------- accountant / director
type FTab = "overview" | "take" | "settings";
export function FinanceArea({ i, home, embedded }: { i: I18n; home: Home; embedded?: boolean }) {
  const { t } = i;
  const [tab, setTab] = useState<FTab>("overview");
  const [student, setStudent] = useState<string | null>(null);
  const open = (id: string) => { setStudent(id); setTab("take"); window.scrollTo(0, 0); };
  return (
    <>
      {!embedded && <PageHead title={t("hello", { n: home.me.first_name })} sub={t("fin_sub")} />}
      <Tabs value={tab} onChange={(v) => { setTab(v); if (v !== "take") setStudent(null); }} items={[
        { id: "overview", label: t("fin_tab_overview"), icon: "chart-bar" },
        { id: "take", label: t("fin_tab_take"), icon: "cash" },
        { id: "settings", label: t("fin_tab_settings"), icon: "settings" }]} />
      {tab === "overview" && <FinanceOverview i={i} onOpen={open} />}
      {tab === "take" && <TakePayment i={i} studentId={student} onPick={setStudent} />}
      {tab === "settings" && <FeeSettings i={i} />}
    </>
  );
}

function FinanceOverview({ i, onOpen }: { i: I18n; onOpen: (id: string) => void }) {
  const { t } = i;
  const [month, setMonth] = useState(monthIso(new Date()));
  const ov = useJson<Overview>(`/finance/overview?month=${month}`, [month]);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!ov.data) return <Loading i={i} err={ov.err} />;
  const d = ov.data, m = d.this_month;
  const pct = m.billed > 0 ? Math.round((100 * m.paid) / m.billed) : 0;
  const act = async (path: string, body: object, msg: (r: never) => string) => {
    setBusy(true); setNote(null);
    try { const r = await api<never>(path, { method: "POST", body: JSON.stringify(body) }); setNote({ ok: true, text: msg(r) }); ov.reload(); }
    catch (e) { setNote({ ok: false, text: e instanceof ApiError ? t("error") + ` (${e.code})` : t("error") }); }
    finally { setBusy(false); }
  };
  const [y, mo] = month.split("-").map(Number);
  const monthName = i.date(`${y}-${String(mo).padStart(2, "0")}-01`).replace(/^1 /, "").replace(/ 1$/, "");
  return (
    <>
      <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm" aria-label={t("prev")} onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="chevron-left" /></button>
          <b style={{ minWidth: 120, textAlign: "center", textTransform: "capitalize" }}>{monthName} {y}</b>
          <button className="btn btn-sm" aria-label={t("next")} onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="chevron-right" /></button>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn" disabled={busy} onClick={() => act("/finance/generate", { month }, (r: { created: number; no_rate: number }) =>
            t("fin_generated", { n: r.created }) + (r.no_rate ? " " + t("fin_no_rate", { n: r.no_rate }) : ""))}><Icon name="file-plus" />{t("fin_generate")}</button>
          <button className="btn" disabled={busy || d.families_in_debt === 0} onClick={() => act("/finance/remind", {}, (r: { invoices: number }) =>
            r.invoices ? t("fin_reminded", { n: r.invoices }) : t("fin_reminded_none"))}><Icon name="bell" />{t("fin_remind")}</button>
        </div>
      </div>
      {note && <div className={`callout ${note.ok ? "callout-info" : "callout-warn"}`}><Icon name={note.ok ? "check" : "alert-triangle"} /><div>{note.text}</div></div>}
      <div className="grid grid-4">
        <Stat icon="file-invoice" label={t("fin_billed")} value={som(m.billed)} foot={t("fin_invoices", { n: m.invoices })} />
        <Stat icon="cash" label={t("fin_paid")} value={som(m.paid)} foot={t("fin_paid_count", { n: m.paid_count, all: m.invoices })} />
        <Stat icon="hourglass" label={t("fin_remaining")} value={som(m.remaining)} foot={`${pct}% ${t("fin_collected")}`} />
        <Stat icon="alert-circle" label={t("fin_debt")} value={som(d.total_debt)} foot={t("fin_families", { n: d.families_in_debt })} />
      </div>
      <div className="grid grid-2">
        <Card title={t("fin_by_class")}>
          {d.by_class.length === 0 ? <Empty icon="file-invoice">{t("fin_no_invoices")}</Empty> : (
            <div className="stack">{d.by_class.map((r) => {
              const p = r.billed > 0 ? Math.round((100 * r.paid) / r.billed) : 0;
              return <div key={r.class}><div className="row between small"><b>{r.class}</b><span className="tnum">{som(r.paid)} / {som(r.billed)}</span></div><Progress value={p} /></div>;
            })}</div>)}
        </Card>
        <Card title={t("fin_recent")}>
          {d.recent_payments.length === 0 ? <Empty icon="cash">{t("nothing")}</Empty> : (
            <div className="list">{d.recent_payments.map((p) => (
              <div key={p.id} className="list-item"><Icon name={p.provider === "bank" ? "building-bank" : "cash"} />
                <div className="grow"><b>{p.name}</b> <span className="small muted">· {p.class}</span>
                  <div className="small muted">№{p.receipt_no} · {i.date(p.created_at)}</div></div>
                {p.status === "cancelled" ? <Badge tone="bad">{t("fin_cancelled")}</Badge> : <b className="tnum">{som(p.amount)}</b>}</div>))}</div>)}
        </Card>
      </div>
      <Card title={t("fin_debtors")} sub={t("fin_debtors_sub")}>
        {d.debtors.length === 0 ? <Empty icon="mood-happy">{t("fin_no_debt")}</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th className="sticky-col">{t("student")}</th><th>{t("fin_class")}</th><th>{t("fin_months")}</th><th>{t("fin_owed")}</th><th>{t("fin_since")}</th><th>{t("fin_last_reminder")}</th><th></th></tr></thead>
            <tbody>{d.debtors.map((r) => (
              <tr key={r.student_id}>
                <td className="sticky-col"><b>{r.name}</b></td><td>{r.class}</td><td className="tnum">{r.months}</td>
                <td className="tnum"><b>{som(r.owed)}</b></td><td>{i.date(r.oldest_due)}</td>
                <td className="small muted">{r.last_reminder_at ? i.date(r.last_reminder_at) : "—"}</td>
                <td><button className="btn btn-sm btn-primary" onClick={() => onOpen(r.student_id)}><Icon name="cash" />{t("fin_take")}</button></td>
              </tr>))}</tbody>
          </table></div>)}
        <p className="small muted" style={{ marginTop: 10 }}><Icon name="shield-lock" /> {t("fin_privacy")}</p>
      </Card>
    </>
  );
}

type Account = { student_id: string; name: string; class: string; discount: { percent: number; reason: string } | null;
  invoices: { id: string; period_month: string; amount: number; paid: number; remaining: number; due_date: string; status: string; overdue: boolean;
    payments: { id: string; receipt_no: number; amount: number; provider: string; status: string; created_at: string; cancelled_reason: string | null }[] }[] };

function TakePayment({ i, studentId, onPick }: { i: I18n; studentId: string | null; onPick: (id: string | null) => void }) {
  const { t } = i;
  const list = useJson<{ student_id: string; name: string; class: string; remaining: number }[]>("/finance/students");
  const [q, setQ] = useState("");
  const shown = useMemo(() => (list.data ?? []).filter((s) => `${s.name} ${s.class}`.toLowerCase().includes(q.toLowerCase())), [list.data, q]);
  if (studentId) return <StudentAccount i={i} id={studentId} onBack={() => { onPick(null); list.reload(); }} />;
  if (!list.data) return <Loading i={i} err={list.err} />;
  return (
    <Card title={t("fin_find")}>
      <input className="input" placeholder={t("fin_search")} aria-label={t("fin_search")} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      <div className="list">{shown.slice(0, 40).map((s) => (
        <button key={s.student_id} className="list-item" style={{ width: "100%", textAlign: "left", background: "none", border: 0, cursor: "pointer" }} onClick={() => onPick(s.student_id)}>
          <Icon name="user" /><div className="grow"><b>{s.name}</b> <span className="small muted">· {s.class}</span></div>
          {Number(s.remaining) > 0 ? <Badge tone="warn">{som(s.remaining)}</Badge> : <Badge tone="good" icon="check">{t("fin_clear")}</Badge>}
        </button>))}</div>
    </Card>
  );
}

function StudentAccount({ i, id, onBack }: { i: I18n; id: string; onBack: () => void }) {
  const { t } = i;
  const acc = useJson<Account>(`/finance/student?id=${id}`, [id]);
  const [pay, setPay] = useState<{ inv: Account["invoices"][number]; amount: string; method: "cash" | "bank"; note: string } | null>(null);
  const [cancel, setCancel] = useState<{ id: string; reason: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!acc.data) return <Loading i={i} err={acc.err} />;
  const a = acc.data;
  const doPay = async () => {
    if (!pay) return; setBusy(true);
    try {
      const r = await api<{ receipt_no: number; remaining: number }>("/finance/pay", { method: "POST", body: JSON.stringify({
        invoice_id: pay.inv.id, amount: Number(pay.amount.replace(/\s/g, "")), method: pay.method, note: pay.note }) });
      setMsg({ ok: true, text: t("fin_receipt", { n: r.receipt_no, r: som(r.remaining) }) }); setPay(null); acc.reload();
    } catch (e) { setMsg({ ok: false, text: e instanceof ApiError && e.code === "bad_amount" ? t("fin_bad_amount") : t("error") }); setPay(null); }
    finally { setBusy(false); }
  };
  const doCancel = async () => {
    if (!cancel) return; setBusy(true);
    try { await api("/finance/cancel-payment", { method: "POST", body: JSON.stringify({ payment_id: cancel.id, reason: cancel.reason }) }); setMsg({ ok: true, text: t("fin_pay_cancelled") }); setCancel(null); acc.reload(); }
    catch { setMsg({ ok: false, text: t("error") }); }
    finally { setBusy(false); }
  };
  const owed = a.invoices.reduce((s, x) => s + Number(x.remaining), 0);
  return (
    <>
      <Card title={<span><button className="btn btn-sm btn-ghost" aria-label={t("back")} onClick={onBack}><Icon name="arrow-left" /></button> {a.name} · {a.class}</span>}
        sub={a.discount ? t("fin_discount_line", { p: a.discount.percent, r: a.discount.reason }) : t("fin_no_discount")}
        right={owed > 0 ? <Badge tone="warn">{t("fin_owes", { s: som(owed) })}</Badge> : <Badge tone="good" icon="check">{t("fin_clear")}</Badge>}>
        {msg && <div className={`callout ${msg.ok ? "callout-info" : "callout-warn"}`} style={{ marginBottom: 12 }}><Icon name={msg.ok ? "receipt" : "alert-triangle"} /><div>{msg.text}</div></div>}
        <div className="stack">{a.invoices.map((inv) => (
          <div key={inv.id} className="card" style={{ padding: 14, boxShadow: "none" }}>
            <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
              <div><b style={{ textTransform: "capitalize" }}>{i.date(inv.period_month).replace(/^1 /, "").replace(/ 1$/, "")}</b>
                <div className="small muted">{t("fin_due", { d: i.date(inv.due_date) })} · {som(inv.amount)}</div></div>
              <div className="row" style={{ gap: 8 }}>
                <InvoiceBadge i={i} status={inv.status} paid={Number(inv.paid)} overdue={inv.overdue} />
                {Number(inv.remaining) > 0 && <button className="btn btn-sm btn-primary" onClick={() => setPay({ inv, amount: String(Math.round(Number(inv.remaining))), method: "cash", note: "" })}>
                  <Icon name="cash" />{t("fin_take")} {som(inv.remaining)}</button>}
              </div>
            </div>
            {inv.payments.length > 0 && <div className="list" style={{ marginTop: 8 }}>{inv.payments.map((p) => (
              <div key={p.id} className="list-item small"><Icon name={p.provider === "bank" ? "building-bank" : "cash"} />
                <div className="grow">№{p.receipt_no} · {i.date(p.created_at)} · {t(`fin_m_${p.provider}`)}
                  {p.cancelled_reason && <div className="muted">{t("fin_cancel_reason")}: {p.cancelled_reason}</div>}</div>
                {p.status === "cancelled" ? <Badge tone="bad">{t("fin_cancelled")}</Badge> : <>
                  <b className="tnum">{som(p.amount)}</b>
                  <button className="btn btn-sm btn-ghost" aria-label={t("fin_cancel_pay")} title={t("fin_cancel_pay")} onClick={() => setCancel({ id: p.id, reason: "" })}><Icon name="x" /></button></>}
              </div>))}</div>}
          </div>))}</div>
      </Card>
      {pay && (
        <Dialog title={t("fin_take_title", { m: i.date(pay.inv.period_month).replace(/^1 /, "") })} onClose={() => setPay(null)} closeLabel={t("cancel")}>
          <div className="stack">
            <div className="field"><label className="label" htmlFor="fp-amt">{t("fin_amount")}</label>
              <input id="fp-amt" className="input" inputMode="numeric" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value.replace(/[^\d\s]/g, "") })} />
              <div className="small muted">{t("fin_max", { s: som(pay.inv.remaining) })}</div></div>
            <div className="row" style={{ gap: 8 }} role="radiogroup" aria-label={t("fin_method")}>
              {(["cash", "bank"] as const).map((m) => <button key={m} role="radio" aria-checked={pay.method === m} className={`btn ${pay.method === m ? "btn-primary" : ""}`} onClick={() => setPay({ ...pay, method: m })}>
                <Icon name={m === "bank" ? "building-bank" : "cash"} />{t(`fin_m_${m}`)}</button>)}
            </div>
            <div className="field"><label className="label" htmlFor="fp-note">{t("fin_note")}</label>
              <input id="fp-note" className="input" maxLength={300} value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></div>
            <button className="btn btn-primary" disabled={busy || !(Number(pay.amount.replace(/\s/g, "")) > 0)} onClick={doPay}><Icon name="check" />{t("fin_confirm_pay")}</button>
          </div>
        </Dialog>)}
      {cancel && (
        <Dialog title={t("fin_cancel_pay")} onClose={() => setCancel(null)} closeLabel={t("cancel")}>
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>{t("fin_cancel_hint")}</p>
            <input className="input" aria-label={t("fin_cancel_reason")} placeholder={t("fin_cancel_reason")} maxLength={300} value={cancel.reason} onChange={(e) => setCancel({ ...cancel, reason: e.target.value })} />
            <button className="btn btn-primary" disabled={busy || cancel.reason.trim().length < 3} onClick={doCancel}>{t("fin_cancel_pay")}</button>
          </div>
        </Dialog>)}
    </>
  );
}

function InvoiceBadge({ i, status, paid, overdue }: { i: I18n; status: string; paid: number; overdue: boolean }) {
  const { t } = i;
  if (status === "paid") return <Badge tone="good" icon="circle-check">{t("fin_st_paid")}</Badge>;
  if (overdue) return <Badge tone="bad" icon="clock">{paid > 0 ? t("fin_st_part_late") : t("fin_st_late")}</Badge>;
  if (paid > 0) return <Badge tone="warn">{t("fin_st_part")}</Badge>;
  return <Badge>{t("fin_st_open")}</Badge>;
}

type Settings = { due_day: number; grades: { grade_level: number; students: number; monthly_amount: number | null }[];
  discounts: { student_id: string; name: string; class: string; percent: number; reason: string }[] };
function FeeSettings({ i }: { i: I18n }) {
  const { t } = i;
  const st = useJson<Settings>("/finance/settings");
  const studs = useJson<{ student_id: string; name: string; class: string }[]>("/finance/students");
  const [rates, setRates] = useState<Record<number, string>>({});
  const [disc, setDisc] = useState({ student_id: "", percent: "10", reason: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (st.data) setRates(Object.fromEntries(st.data.grades.map((g) => [g.grade_level, g.monthly_amount != null ? String(Math.round(Number(g.monthly_amount))) : ""]))); }, [st.data]);
  if (!st.data) return <Loading i={i} err={st.err} />;
  const saveRate = async (g: number) => {
    try { await api("/finance/rate", { method: "POST", body: JSON.stringify({ grade_level: g, amount: Number(rates[g]) }) }); setMsg({ ok: true, text: t("fin_rate_saved") }); st.reload(); }
    catch { setMsg({ ok: false, text: t("error") }); }
  };
  const saveDisc = async (student_id: string, percent: number, reason: string) => {
    try { await api("/finance/discount", { method: "POST", body: JSON.stringify({ student_id, percent, reason }) }); setMsg({ ok: true, text: t("fin_disc_saved") }); setDisc({ student_id: "", percent: "10", reason: "" }); st.reload(); }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiError && e.code === "reason_required" ? t("fin_reason_needed") : t("error") }); }
  };
  return (
    <>
      {msg && <div className={`callout ${msg.ok ? "callout-info" : "callout-warn"}`}><Icon name={msg.ok ? "check" : "alert-triangle"} /><div>{msg.text}</div></div>}
      <div className="grid grid-2">
        <Card title={t("fin_rates")} sub={t("fin_rates_sub", { d: st.data.due_day })}>
          <div className="stack">{st.data.grades.map((g) => (
            <div key={g.grade_level} className="row" style={{ gap: 8 }}>
              <b style={{ minWidth: 80 }}>{t("fin_grade", { g: g.grade_level })}</b>
              <input className="input" inputMode="numeric" aria-label={t("fin_grade", { g: g.grade_level })} style={{ maxWidth: 160 }} value={rates[g.grade_level] ?? ""}
                onChange={(e) => setRates({ ...rates, [g.grade_level]: e.target.value.replace(/\D/g, "") })} />
              <span className="small muted grow">{t("fin_students_n", { n: g.students })}</span>
              <button className="btn btn-sm" onClick={() => saveRate(g.grade_level)}>{t("save")}</button>
            </div>))}</div>
          <p className="small muted" style={{ marginTop: 10 }}>{t("fin_rates_note")}</p>
        </Card>
        <Card title={t("fin_discounts")} sub={t("fin_discounts_sub")}>
          <div className="list">{st.data.discounts.map((d) => (
            <div key={d.student_id} className="list-item"><Badge tone="brand">−{d.percent}%</Badge>
              <div className="grow"><b>{d.name}</b> <span className="small muted">· {d.class}</span><div className="small muted">{d.reason}</div></div>
              <button className="btn btn-sm btn-ghost" aria-label={t("fin_remove")} onClick={() => saveDisc(d.student_id, 0, "")}><Icon name="trash" /></button></div>))}</div>
          <div className="stack" style={{ marginTop: 12 }}>
            <select className="select" style={{ width: "100%" }} aria-label={t("student")} value={disc.student_id} onChange={(e) => setDisc({ ...disc, student_id: e.target.value })}>
              <option value="">{t("fin_pick_student")}</option>
              {(studs.data ?? []).map((s) => <option key={s.student_id} value={s.student_id}>{s.name} · {s.class}</option>)}
            </select>
            <div className="row" style={{ gap: 8 }}>
              <input className="input" inputMode="numeric" aria-label="%" style={{ maxWidth: 80 }} value={disc.percent} onChange={(e) => setDisc({ ...disc, percent: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
              <input className="input grow" placeholder={t("fin_disc_reason")} aria-label={t("fin_disc_reason")} maxLength={300} value={disc.reason} onChange={(e) => setDisc({ ...disc, reason: e.target.value })} />
            </div>
            <button className="btn" disabled={!disc.student_id || disc.reason.trim().length < 3} onClick={() => saveDisc(disc.student_id, Number(disc.percent), disc.reason)}><Icon name="plus" />{t("fin_add_disc")}</button>
          </div>
        </Card>
      </div>
    </>
  );
}

// director / school admin: a summary on the home page, opens the full area
export function FinanceSummaryCard({ i, home }: { i: I18n; home: Home }) {
  const { t } = i;
  const [open, setOpen] = useState(false);
  const ov = useJson<Overview>(home.seesMoney ? "/finance/overview" : null);
  if (!home.seesMoney || !ov.data) return null;
  if (open) return <><div className="row between"><h2 style={{ margin: 0 }}><Icon name="cash" /> {t("fin_title")}</h2>
    <button className="btn btn-sm" onClick={() => setOpen(false)}><Icon name="x" />{t("close")}</button></div><FinanceArea i={i} home={home} embedded /></>;
  const m = ov.data.this_month, pct = m.billed > 0 ? Math.round((100 * m.paid) / m.billed) : 0;
  return (
    <Card title={<span><Icon name="cash" /> {t("fin_title")}</span>} sub={t("fin_summary_sub")}
      right={<button className="btn btn-sm" onClick={() => setOpen(true)}>{t("fin_details")}</button>}>
      <div className="row between small"><span>{t("fin_this_month_paid", { p: som(m.paid), b: som(m.billed) })}</span><b className="tnum">{pct}%</b></div>
      <Progress value={pct} />
      <p className="small" style={{ marginTop: 10 }}><Icon name="alert-circle" /> {t("fin_debt_line", { s: som(ov.data.total_debt), n: ov.data.families_in_debt })}</p>
    </Card>
  );
}

// ---------------------------------------------------------------- parent
type Fee = { id: string; student_id: string; period_month: string; amount: number; base_amount: number | null; discount_percent: number;
  due_date: string; status: string; paid: number; payments: { receipt_no: number; amount: number; provider: string; created_at: string }[] };
export function ParentFees({ i, kid }: { i: I18n; kid: Kid }) {
  const { t } = i;
  const fees = useJson<Fee[]>("/family/fees");
  if (!fees.data) return <Loading i={i} err={fees.err} />;
  const mine = fees.data.filter((f) => f.student_id === kid.id);
  const today = new Date().toISOString().slice(0, 10);
  const owed = mine.reduce((s, f) => s + Math.max(Number(f.amount) - Number(f.paid), 0), 0);
  return (
    <Card title={<span><Icon name="receipt" /> {t("fin_parent_title")}</span>} sub={`${kid.first_name} · ${kid.class}`}
      right={owed > 0 ? <Badge tone="warn">{t("fin_to_pay", { s: som(owed) })}</Badge> : <Badge tone="good" icon="check">{t("fin_all_paid")}</Badge>}>
      {mine.length === 0 ? <Empty icon="receipt">{t("nothing")}</Empty> : (
        <div className="list">{mine.map((f) => (
          <div key={f.id} className="list-item" style={{ alignItems: "flex-start" }}>
            <Icon name="calendar" />
            <div className="grow">
              <b style={{ textTransform: "capitalize" }}>{i.date(f.period_month).replace(/^1 /, "").replace(/ 1$/, "")}</b>
              <div className="small muted">{som(f.amount)}{f.discount_percent > 0 && <> · {t("fin_discount_pct", { p: f.discount_percent })}</>} · {t("fin_due", { d: i.date(f.due_date) })}</div>
              {f.payments.map((p) => <div key={p.receipt_no} className="small">✓ {t("fin_receipt_line", { n: p.receipt_no, s: som(p.amount), d: i.date(p.created_at) })}</div>)}
            </div>
            <InvoiceBadge i={i} status={f.status} paid={Number(f.paid)} overdue={f.status === "issued" && f.due_date < today} />
          </div>))}</div>)}
      <div className="callout callout-info" style={{ marginTop: 12 }}><Icon name="building-bank" /><div>{t("fin_how_to_pay")}</div></div>
      <p className="small muted" style={{ marginTop: 8 }}><Icon name="heart-handshake" /> {t("fin_parent_note")}</p>
    </Card>
  );
}
