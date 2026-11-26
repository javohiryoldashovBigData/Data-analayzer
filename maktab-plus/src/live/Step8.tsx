// Step 8a: connect Telegram (school messages come to the person's own Telegram).
// The web app only asks the server for a ONE-TIME link; the bot worker does the rest.
import { useEffect, useState } from "react";
import { api } from "./api";
import type { I18n } from "./i18n";
import { Badge, Card, Icon } from "../components/ui";

type Status = { linked: boolean; linked_at?: string; via?: string; bot: string | null };

export function TelegramCard({ i }: { i: I18n }) {
  const { t } = i;
  const [st, setSt] = useState<Status | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [err, setErr] = useState("");
  const load = () => api<Status>("/telegram/status").then(setSt).catch(() => setSt(null));
  useEffect(() => { load(); }, []);
  if (!st) return null;
  const connect = async () => {
    setErr("");
    try {
      const r = await api<{ url: string }>("/telegram/link", { method: "POST" });
      window.open(r.url, "_blank", "noopener"); setWaiting(true);
    } catch { setErr(t("error")); }
  };
  const unlink = async () => { await api("/telegram/unlink", { method: "POST" }); load(); };
  return (
    <Card title={<span><Icon name="brand-telegram" /> {t("tg_title")}</span>}
      right={st.linked ? <Badge tone="good" icon="check">{t("tg_linked")}</Badge> : undefined}>
      {!st.bot ? <p className="small muted" style={{ margin: 0 }}>{t("tg_not_ready")}</p>
        : st.linked ? (
          <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
            <span className="small muted">{t("tg_linked_sub")}</span>
            <button className="btn btn-sm btn-ghost" onClick={unlink}><Icon name="unlink" />{t("tg_unlink")}</button>
          </div>
        ) : (
          <div className="stack">
            <span className="small muted">{t("tg_why")}</span>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={connect}><Icon name="brand-telegram" />{t("tg_connect")}</button>
              {waiting && <button className="btn" onClick={load}><Icon name="refresh" />{t("tg_check")}</button>}
            </div>
            {waiting && <span className="small muted">{t("tg_waiting")}</span>}
            {err && <span className="small" style={{ color: "var(--bad)" }}>{err}</span>}
          </div>
        )}
      <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}><Icon name="shield-lock" /> {t("tg_privacy")}</p>
    </Card>
  );
}
