import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import { AIError, streamText, systemPrompt } from "../ai/claude";
import { Card, Icon, Markdown } from "./ui";

export function useAIErrorText() {
  const { t } = useI18n();
  return (e: unknown) => (e instanceof AIError ? t(`aierr_${e.code}`) : t("aierr_other"));
}

/**
 * A card that runs one Claude request and streams the answer.
 * Without an API key it shows the offline `fallback` (if any) and explains how to connect AI.
 */
export default function AIBox({ title, sub, button, prompt, fallback, extraSystem, children }: {
  title: ReactNode;
  sub?: ReactNode;
  button: string;
  prompt: () => string;
  fallback?: () => string;
  extraSystem?: string;
  children?: ReactNode;
}) {
  const { db, session } = useStore();
  const { t, lang } = useI18n();
  const errText = useAIErrorText();
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [offline, setOffline] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const hasKey = !!db.settings.apiKey;

  const run = async () => {
    setErr("");
    setOut("");
    if (!hasKey) {
      if (fallback) { setOut(fallback()); setOffline(true); }
      else setErr(t("aierr_noKey"));
      return;
    }
    setOffline(false);
    setBusy(true);
    abort.current = new AbortController();
    try {
      await streamText({
        apiKey: db.settings.apiKey,
        system: systemPrompt(lang, session!.role, extraSystem),
        content: prompt(),
        onText: (_d, full) => setOut(full),
        signal: abort.current.signal,
      });
    } catch (e) {
      if (!abort.current?.signal.aborted) setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={<span className="row" style={{ gap: 8 }}><span className="ai-chip"><Icon name="sparkles" />AI</span>{title}</span>} sub={sub}
      right={busy
        ? <button className="btn" onClick={() => abort.current?.abort()}><Icon name="player-stop" />{t("stop")}</button>
        : <button className="btn btn-ai" onClick={run}><Icon name="sparkles" />{button}</button>}>
      {children}
      {!hasKey && !out && (
        <div className="callout callout-info small"><Icon name="key" /><div>{fallback ? t("ai_offline_hint") : t("ai_needs_key")} <Link to="/settings">{t("nav_settings")} →</Link></div></div>
      )}
      {err && <div className="callout callout-warn small" style={{ marginTop: 10 }}><Icon name="alert-triangle" /><div>{err} {err === t("aierr_noKey") && <Link to="/settings">{t("nav_settings")} →</Link>}</div></div>}
      {busy && !out && <p className="muted small" style={{ marginTop: 10 }}><Icon name="loader-2" /> {t("thinking")}</p>}
      {out && (
        <div style={{ marginTop: 10 }}>
          {offline && <div className="small muted" style={{ marginBottom: 6 }}><Icon name="cpu" /> {t("offline_result")}</div>}
          <Markdown text={out} />
        </div>
      )}
    </Card>
  );
}
