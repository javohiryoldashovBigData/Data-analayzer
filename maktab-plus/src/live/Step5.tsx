// Step 5: AI with a hard budget.
//  - Teacher: "Prepare next week" — free Library cards first, the rest goes to a
//    night AI job (cheap Batch). Drafts are always checked by the teacher.
//  - Student / parent: "Topic review" — only for children who didn't get a topic.
//  - Director / school admin: AI spend against the school's monthly cap.
import { useState } from "react";
import { api, ApiError, type Home, type Kid } from "./api";
import type { I18n } from "./i18n";
import { Badge, Card, Icon, Progress } from "../components/ui";

export type AiBudget = {
  allowed: boolean; reason: string; plan: string;
  my_remaining_cents: number; school_remaining_cents: number;
  my_jobs: { id: string; feature: string; status: string; lessons: number; sent: boolean; created_at: string }[];
  school: { cap_cents: number; used_cents: number; requests: number } | null;
};
type PrepResult = { lessons: number; already_ready: number; from_library: number; ai_queued: number; no_topic: number; ai_blocked?: string; ai_skipped?: number; budget: AiBudget };
export type Review = { id: string; student_ids: string[]; subject: string; topic: string; status: string; created_at: string;
  content: { title?: string; steps?: string[]; example?: string; try_it?: string } };

const CENTS_PER_LESSON = 0.5;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function nextMonday() { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return iso(d); }

// ---------------------------------------------------------------- teacher
export function PrepWeekCard({ i, home }: { i: I18n; home: Home }) {
  const { t } = i;
  const week = nextMonday();
  const [res, setRes] = useState<PrepResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!home.day) return null;
  const go = async () => {
    setBusy(true); setErr("");
    try { setRes(await api<PrepResult>("/teacher/ai/prep", { method: "POST", body: JSON.stringify({ week_start: week }) })); }
    catch (e) { setErr(e instanceof ApiError ? e.code : "error"); }
    finally { setBusy(false); }
  };
  const left = res ? Math.floor(Math.min(Number(res.budget.my_remaining_cents), Number(res.budget.school_remaining_cents ?? Infinity)) / CENTS_PER_LESSON) : null;
  const waiting = (res?.budget.my_jobs ?? []).filter((j) => j.status === "pending");
  return (
    <Card title={<span><Icon name="sparkles" /> {t("prep_title")}</span>} sub={t("prep_sub", { d: i.date(week, true) })}>
      <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
        <button className="btn btn-primary" disabled={busy} onClick={go}><Icon name="wand" />{busy ? t("loading") : t("prep_button")}</button>
        <span className="small muted"><Icon name="books" /> {t("prep_library_first")}</span>
      </div>
      {err && <div className="callout callout-warn" style={{ marginTop: 12 }}><Icon name="alert-triangle" /><div>{t("error")}</div></div>}
      {res && (
        <div className="stack" style={{ marginTop: 14 }}>
          <div className="grid grid-3">
            <div className="list-item"><Icon name="books" /><div className="grow"><b className="tnum">{res.from_library}</b><div className="small muted">{t("prep_from_library")}</div></div></div>
            <div className="list-item"><Icon name="sparkles" /><div className="grow"><b className="tnum">{res.ai_queued}</b><div className="small muted">{t("prep_ai_queued")}</div></div></div>
            <div className="list-item"><Icon name="circle-check" /><div className="grow"><b className="tnum">{res.already_ready}</b><div className="small muted">{t("prep_ready")}</div></div></div>
          </div>
          {res.ai_queued > 0 && <div className="callout callout-info"><Icon name="moon" /><div>{t("prep_tonight", { n: res.ai_queued })}</div></div>}
          {res.ai_blocked && <div className="callout callout-warn"><Icon name="lock" /><div>{t(res.ai_blocked === "school_budget_reached" ? "prep_school_cap" : "prep_my_cap", { n: res.ai_skipped ?? 0 })}</div></div>}
          {res.no_topic > 0 && <p className="small muted"><Icon name="pencil" /> {t("prep_no_topic", { n: res.no_topic })}</p>}
          <p className="small muted"><Icon name="eye-check" /> {t("prep_check")}{left != null && <> · {t("prep_left", { n: left })}</>}{waiting.length > 0 && <> · {t("prep_waiting", { n: waiting.length })}</>}</p>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- student / parent
export function ReviewCards({ i, home, kid }: { i: I18n; home: Home; kid: Kid }) {
  const { t } = i;
  const list = (home.reviews ?? []).filter((r) => r.student_ids.includes(kid.id));
  if (list.length === 0) return null;
  return (
    <>{list.map((r) => (
      <Card key={r.id} title={<span><Icon name="bulb" /> {t("review_title")}: {r.topic}</span>} sub={`${r.subject} · ${i.date(r.created_at)}`}
        right={<Badge tone="accent" icon="sparkles">{t("review_badge")}</Badge>}>
        <p className="small muted" style={{ marginTop: 0 }}>{t(home.role === "parent" ? "review_why_parent" : "review_why")}</p>
        {r.content.title && <h3 style={{ margin: "6px 0 10px" }}>{r.content.title}</h3>}
        <ol className="stack" style={{ paddingLeft: 20, margin: 0 }}>{(r.content.steps ?? []).map((s, k) => <li key={k}>{s}</li>)}</ol>
        {r.content.example && <div className="callout callout-info" style={{ marginTop: 12 }}><Icon name="math" /><div><b>{t("review_example")}:</b> <span className="tnum">{r.content.example}</span></div></div>}
        {r.content.try_it && <div className="callout" style={{ marginTop: 8 }}><Icon name="pencil" /><div><b>{t("review_try")}:</b> <span className="tnum">{r.content.try_it}</span></div></div>}
      </Card>
    ))}</>
  );
}

// ---------------------------------------------------------------- director / school admin
export function AiBudgetCard({ i, home }: { i: I18n; home: Home }) {
  const { t } = i;
  const b = home.aiBudget;
  if (!b?.school) return null;            // zavuch: no money numbers
  const { cap_cents, used_cents, requests } = b.school;
  const pct = cap_cents > 0 ? Math.min(100, Math.round((100 * Number(used_cents)) / Number(cap_cents))) : 100;
  const usd = (c: number) => `$${(Number(c) / 100).toFixed(Number(c) > 0 && Number(c) < 10 ? 3 : 2)}`;   // tiny Batch costs stay visible
  return (
    <Card title={<span><Icon name="sparkles" /> {t("ai_spend_title")}</span>} sub={t("ai_spend_sub", { p: b.plan === "pro" ? "Pro" : "Standard" })}
      right={<Badge tone={pct >= 90 ? "bad" : pct >= 70 ? "warn" : "good"}>{pct}%</Badge>}>
      <div className="row between small"><span>{t("ai_used", { u: usd(used_cents), c: usd(cap_cents) })}</span><span className="muted tnum">{t("ai_requests", { n: requests })}</span></div>
      <Progress value={pct} />
      <p className="small muted" style={{ marginTop: 10 }}><Icon name="shield-check" /> {t("ai_hard_cap")}</p>
    </Card>
  );
}
