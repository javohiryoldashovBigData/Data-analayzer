// The public website: what Maktab+ is, the two demos, and self sign-up.
// A director creates their school or learning center here and lands, logged
// in, in their own window (live.html?school=<address>).
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, setToken } from "../live/api";
import { useLang, type I18n, type Lang } from "../live/i18n";
import { Card, Icon } from "../components/ui";

type Region = { id: number; uz: string; ru: string };

// "Yangi Bilim markazi" → "yangi-bilim-markazi" (Latin; o'/g' and Cyrillic simplified)
const CYR: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h" };
export function toSlug(name: string) {
  return name.toLowerCase().split("").map((c) => CYR[c] ?? c).join("")
    .replace(/[ʻʼ'‘’`]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
}

export default function Site() {
  const i = useLang();
  const { t } = i;
  useEffect(() => { document.title = t("site_title"); }, [t]);
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header className="topbar" style={{ position: "static", justifyContent: "space-between" }}>
        <div className="row" style={{ gap: 10 }}>
          <span className="role-icon" style={{ width: 38, height: 38, background: "var(--brand)", color: "#fff", fontWeight: 800, borderRadius: 10 }}>M+</span>
          <b style={{ fontSize: 18 }}>Maktab+</b>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <select className="select" aria-label="Til / Язык / Language" value={i.lang} onChange={(e) => i.setLang(e.target.value as Lang)}>
            <option value="uz">O'zbekcha</option><option value="ru">Русский</option><option value="en">English</option>
          </select>
          <a className="btn" href="#kirish"><Icon name="login" />{t("site_login")}</a>
        </div>
      </header>
      <main style={{ maxWidth: 1080, margin: "0 auto", paddingInline: "max(16px, env(safe-area-inset-left, 0px))", paddingBlock: "32px 64px", display: "flex", flexDirection: "column", gap: 40 }}>
        <section className="stack" style={{ gap: 18, maxWidth: 760 }}>
          <span className="small" style={{ color: "var(--brand)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{t("site_eyebrow")}</span>
          <h1 style={{ fontSize: "clamp(30px, 5vw, 46px)", lineHeight: 1.15, margin: 0, textWrap: "balance" }}>{t("site_h1")}</h1>
          <p style={{ fontSize: 18, color: "var(--text-2)", margin: 0 }}>{t("site_lead")}</p>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <a className="btn btn-primary" href="#boshlash" style={{ fontSize: 16, padding: "12px 18px" }}><Icon name="rocket" />{t("site_start")}</a>
            <a className="btn" href="live.html?school=demo-markaz"><Icon name="users-group" />{t("site_demo_center")}</a>
            <a className="btn" href="live.html?school=demo"><Icon name="school" />{t("site_demo_school")}</a>
          </div>
          <p className="small muted" style={{ margin: 0 }}><Icon name="gift" /> {t("site_free_pilot")}</p>
        </section>

        <section className="grid grid-2">
          <Card title={<span><Icon name="users-group" /> {t("site_center_title")}</span>}>
            <ul className="stack" style={{ margin: 0, paddingLeft: 18, gap: 6 }}>{["site_c1", "site_c2", "site_c3", "site_c4", "site_c5"].map((k) => <li key={k}>{t(k)}</li>)}</ul>
          </Card>
          <Card title={<span><Icon name="school" /> {t("site_school_title")}</span>}>
            <ul className="stack" style={{ margin: 0, paddingLeft: 18, gap: 6 }}>{["site_s1", "site_s2", "site_s3", "site_s4", "site_s5"].map((k) => <li key={k}>{t(k)}</li>)}</ul>
          </Card>
        </section>

        <section className="grid grid-3">
          {[["brand-telegram", "site_p1"], ["shield-lock", "site_p2"], ["scale", "site_p3"]].map(([ic, k]) => (
            <div key={k} className="card" style={{ padding: 18 }}><b><Icon name={ic} /> {t(`${k}_t`)}</b><p className="small muted" style={{ margin: "6px 0 0" }}>{t(`${k}_d`)}</p></div>))}
        </section>

        <section id="boshlash"><SignUp i={i} /></section>
        <section id="kirish"><EnterWindow i={i} /></section>
      </main>
      <footer className="small muted" style={{ textAlign: "center", paddingBlock: 24 }}>Maktab+ · {t("site_footer")}</footer>
    </div>
  );
}

function SignUp({ i }: { i: I18n }) {
  const { t } = i;
  const [regions, setRegions] = useState<Region[]>([]);
  const [f, setF] = useState({ kind: "center", org_name: "", slug: "", region_id: "", first_name: "", last_name: "", phone: "", password: "", password2: "", agree: false });
  const [slugEdited, setSlugEdited] = useState(false);
  const [free, setFree] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { api<Region[]>("/signup/regions").then(setRegions).catch(() => setRegions([])); }, []);
  const slug = slugEdited ? f.slug : toSlug(f.org_name);
  useEffect(() => {
    setFree(null); if (slug.length < 4) return;
    const h = setTimeout(() => api<{ free: boolean }>(`/signup/slug?s=${encodeURIComponent(slug)}`).then((r) => setFree(r.free)).catch(() => setFree(null)), 350);
    return () => clearTimeout(h);
  }, [slug]);
  const mismatch = f.password2.length > 0 && f.password !== f.password2;
  const ready = f.org_name.trim().length >= 3 && slug.length >= 4 && free !== false && f.region_id && f.first_name.trim().length >= 2
    && f.last_name.trim().length >= 2 && f.phone.replace(/\D/g, "").length >= 9 && f.password.length >= 8 && !mismatch && f.agree;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!ready) return;
    setBusy(true); setErr("");
    try {
      const r = await api<{ token: string; slug: string }>("/signup", { method: "POST", body: JSON.stringify({ ...f, slug, region_id: Number(f.region_id) }) });
      setToken(r.token); window.location.href = `live.html?school=${encodeURIComponent(r.slug)}`;
    } catch (e2) {
      const c = e2 instanceof ApiError ? e2.code : "error";
      setErr(t(`su_e_${c}`) !== `su_e_${c}` ? t(`su_e_${c}`) : t("error"));
    } finally { setBusy(false); }
  };
  const inp = (k: keyof typeof f, label: string, extra: Record<string, string> = {}) => (
    <div className="field"><label className="label" htmlFor={`su-${k}`}>{label}</label>
      <input id={`su-${k}`} className="input" value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></div>);
  return (
    <Card title={<span><Icon name="rocket" /> {t("su_title")}</span>} sub={t("su_sub")}>
      <form className="stack" onSubmit={submit}>
        <div className="grid grid-2" role="radiogroup" aria-label={t("su_kind")}>
          {(["center", "school"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={f.kind === k} onClick={() => setF({ ...f, kind: k })}
              className="card" style={{ textAlign: "left", padding: 16, cursor: "pointer", borderColor: f.kind === k ? "var(--brand)" : undefined, boxShadow: f.kind === k ? "0 0 0 2px var(--brand-soft)" : undefined }}>
              <b><Icon name={k === "center" ? "users-group" : "school"} /> {t(k === "center" ? "su_center" : "su_school")}</b>
              <div className="small muted">{t(k === "center" ? "su_center_d" : "su_school_d")}</div>
            </button>))}
        </div>
        <div className="grid grid-2">
          {inp("org_name", t(f.kind === "center" ? "su_org_center" : "su_org_school"), { maxLength: "80", placeholder: f.kind === "center" ? "Bilim Plus o'quv markazi" : "Zukko xususiy maktabi" })}
          <div className="field"><label className="label" htmlFor="su-region">{t("su_region")}</label>
            <select id="su-region" className="select" style={{ width: "100%" }} value={f.region_id} onChange={(e) => setF({ ...f, region_id: e.target.value })}>
              <option value="">{t("su_pick")}</option>{regions.map((r) => <option key={r.id} value={r.id}>{i.lang === "ru" ? r.ru : r.uz}</option>)}</select></div>
        </div>
        <div className="field"><label className="label" htmlFor="su-slug">{t("su_address")}</label>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <span className="small muted">…/live.html?school=</span>
            <input id="su-slug" className="input" style={{ maxWidth: 260 }} value={slug} onChange={(e) => { setSlugEdited(true); setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }); }} />
            {slug.length >= 4 && free === true && <span className="small" style={{ color: "var(--good)" }}><Icon name="check" /> {t("su_free")}</span>}
            {free === false && <span className="small" style={{ color: "var(--bad)" }}><Icon name="x" /> {t("su_taken")}</span>}
          </div></div>
        <div className="grid grid-2">{inp("first_name", t("su_first"), { maxLength: "40" })}{inp("last_name", t("su_last"), { maxLength: "40" })}</div>
        {inp("phone", t("su_phone"), { inputMode: "tel", placeholder: "+998 90 123 45 67", autoComplete: "tel" })}
        <div className="grid grid-2">
          {inp("password", t("su_password"), { type: "password", autoComplete: "new-password" })}
          {inp("password2", t("pw_repeat"), { type: "password", autoComplete: "new-password" })}
        </div>
        {mismatch && <div className="small" style={{ color: "var(--bad)" }}>{t("pw_mismatch")}</div>}
        <div className="small muted">{t("pw_rules")}</div>
        <label className="row small" style={{ gap: 8, alignItems: "flex-start" }}>
          <input type="checkbox" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} style={{ marginTop: 3 }} />
          <span>{t("su_agree")}</span></label>
        {err && <div className="callout callout-warn"><Icon name="alert-triangle" /><div>{err}</div></div>}
        <div><button className="btn btn-primary" type="submit" disabled={busy || !ready} style={{ fontSize: 16, padding: "12px 18px" }}><Icon name="check" />{busy ? t("loading") : t("su_create")}</button></div>
      </form>
    </Card>
  );
}

function EnterWindow({ i }: { i: I18n }) {
  const { t } = i;
  const [s, setS] = useState("");
  const href = useMemo(() => `live.html?school=${encodeURIComponent(s.trim().toLowerCase())}`, [s]);
  return (
    <Card title={<span><Icon name="login" /> {t("site_login")}</span>} sub={t("site_login_sub")}>
      <form className="row" style={{ gap: 8, flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); if (s.trim()) window.location.href = href; }}>
        <input className="input" style={{ maxWidth: 280 }} aria-label={t("su_address")} placeholder="bilim-plus" value={s} onChange={(e) => setS(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
        <button className="btn btn-primary" type="submit" disabled={!s.trim()}><Icon name="arrow-right" />{t("site_open")}</button>
      </form>
    </Card>
  );
}
