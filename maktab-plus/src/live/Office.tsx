// School office (director / zavuch / admin): parents' messages — answer or forward to a teacher.
import { useState } from "react";
import { api, type Home } from "./api";
import type { I18n } from "./i18n";
import { Badge, Card, Empty, Icon } from "../components/ui";

export function OfficeInbox({ i, home, reload }: { i: I18n; home: Home; reload: () => void }) {
  const { t } = i;
  const list = home.inbox ?? [];
  const open = list.filter((m) => m.status === "open").length;
  return (
    <Card title={t("parent_messages")} sub={t("office_role")} right={<Badge tone={open ? "warn" : "good"}>{open}</Badge>}>
      {list.length === 0 ? <Empty icon="messages">{t("nothing")}</Empty> : (
        <div className="list">{list.map((m) => <InboxItem key={m.id} i={i} m={m} teachers={home.staffTeachers ?? []} reload={reload} />)}</div>
      )}
    </Card>
  );
}

function InboxItem({ i, m, teachers, reload }: { i: I18n; m: NonNullable<Home["inbox"]>[number]; teachers: { id: string; name: string }[]; reload: () => void }) {
  const { t } = i;
  const [reply, setReply] = useState("");
  const [fwd, setFwd] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const send = async (body: Record<string, unknown>) => {
    setBusy(true); setErr("");
    try { await api("/office/reply", { method: "POST", body: JSON.stringify({ id: m.id, ...body }) }); reload(); }
    catch { setErr(t("error")); } finally { setBusy(false); }
  };
  const fwdName = teachers.find((x) => x.id === m.forwarded_to)?.name;
  return (
    <div className="list-item" style={{ alignItems: "flex-start" }}>
      <Icon name="message-2" />
      <div className="grow stack" style={{ gap: 6, minWidth: 0 }}>
        <div className="row between" style={{ flexWrap: "wrap", gap: 6 }}>
          <span className="row" style={{ gap: 8 }}><b>{m.topic}</b>
            <Badge tone={m.status === "answered" ? "good" : m.status === "forwarded" ? "accent" : m.status === "closed" ? "" : "warn"}>{t(`ms_${m.status}`)}</Badge></span>
          <span className="small muted">{m.parent} · {m.student}{m.class ? ` (${m.class})` : ""} · {i.date(m.created_at)}</span>
        </div>
        {m.about_teacher && <div className="small muted"><Icon name="user" /> {t("about_teacher")}: {m.about_teacher}</div>}
        <div className="small">{m.body}</div>
        {m.reply && <div className="callout callout-info small"><Icon name="corner-down-right" /><div>{m.reply}</div></div>}
        {fwdName && <div className="small muted"><Icon name="share" /> {t("forwarded_to", { n: fwdName })}</div>}
        {m.status === "open" && (
          <div className="stack" style={{ gap: 6 }}>
            <textarea className="textarea" rows={2} maxLength={2000} placeholder={t("reply_ph")} value={reply} onChange={(e) => setReply(e.target.value)} aria-label={t("reply")} />
            <div className="row" style={{ flexWrap: "wrap" }}>
              <button className="btn btn-primary btn-sm" disabled={busy || !reply.trim()} onClick={() => send({ reply })}><Icon name="send" />{t("reply")}</button>
              <select className="select" value={fwd} onChange={(e) => setFwd(e.target.value)} aria-label={t("forward")}>
                <option value="">{t("forward_to_teacher")}</option>
                {teachers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <button className="btn btn-sm" disabled={busy || !fwd} onClick={() => send({ forward_to: fwd })}><Icon name="share" />{t("forward")}</button>
            </div>
            {err && <div className="small" style={{ color: "var(--bad)" }}>{err}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
