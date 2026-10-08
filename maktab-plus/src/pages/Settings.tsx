import { useState } from "react";
import { useStore } from "../lib/store";
import { LANGS, useI18n } from "../lib/i18n";
import { useTheme } from "../App";
import { MODEL } from "../ai/claude";
import type { Lang } from "../data/types";
import { Badge, Card, Icon, PageHead, Segmented } from "../components/ui";

export default function Settings() {
  const { db, session, update, resetDemo, showToast } = useStore();
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const [key, setKey] = useState(db.settings.apiKey);
  const [show, setShow] = useState(false);

  const exportData = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ ...db, settings: { ...db.settings, apiKey: "" } }, null, 2)], { type: "application/json" }));
    a.download = `maktab-plus-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <PageHead title={t("nav_settings")} />
      <div className="grid grid-2">
        <Card title={<span className="row" style={{ gap: 8 }}><span className="ai-chip">AI</span>{t("ai_connection")}</span>} sub={t("ai_connection_sub")}>
          <div className="stack">
            <div className="row">
              {db.settings.apiKey ? <Badge tone="good" icon="plug-connected">{t("ai_connected")}</Badge> : <Badge tone="warn" icon="plug-x">{t("ai_offline_mode")}</Badge>}
              <span className="small muted">{t("model")}: {MODEL}</span>
            </div>
            <div className="field">
              <label className="label" htmlFor="apikey">Anthropic API key</label>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <input id="apikey" className="input" type={show ? "text" : "password"} value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-..." autoComplete="off" />
                <button className="btn icon-btn" onClick={() => setShow(!show)} aria-label={t("show")}><Icon name={show ? "eye-off" : "eye"} /></button>
              </div>
            </div>
            <div className="row">
              <button className="btn btn-primary" onClick={() => { update((d) => { d.settings.apiKey = key.trim(); }); showToast(t("saved")); }}><Icon name="device-floppy" />{t("save")}</button>
              {db.settings.apiKey && <button className="btn btn-danger" onClick={() => { setKey(""); update((d) => { d.settings.apiKey = ""; }); }}>{t("disconnect")}</button>}
            </div>
            <div className="callout callout-warn small"><Icon name="alert-triangle" /><div>{t("key_warning")}</div></div>
            <p className="small muted">{t("ai_features_list")}</p>
          </div>
        </Card>

        <div className="stack" style={{ gap: 16 }}>
          <Card title={t("appearance")}>
            <div className="stack">
              <div className="row between"><span>{t("language")}</span>
                <Segmented value={lang} onChange={(v) => setLang(v as Lang)} items={LANGS.map((l) => ({ id: l.id, label: l.label }))} /></div>
              <div className="row between"><span>{t("theme")}</span>
                <Segmented value={theme} onChange={(v) => { if (v !== theme) toggle(); }} items={[{ id: "light", label: t("light") }, { id: "dark", label: t("dark") }]} /></div>
            </div>
          </Card>

          {session!.role === "director" && (
            <Card title={t("school_settings")}>
              <div className="row between">
                <label htmlFor="late-after">{t("late_after_label")}</label>
                <input id="late-after" className="input" style={{ width: 130 }} type="time" value={db.settings.lateAfter} onChange={(e) => update((d) => { d.settings.lateAfter = e.target.value; })} />
              </div>
            </Card>
          )}

          <Card title={t("demo_data")} sub={t("demo_data_sub")}>
            <div className="row">
              <button className="btn" onClick={exportData}><Icon name="download" />{t("export_json")}</button>
              <button className="btn btn-danger" onClick={() => { if (confirm(t("reset_confirm"))) { resetDemo(); showToast(t("reset_done")); } }}><Icon name="refresh" />{t("reset_demo")}</button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
