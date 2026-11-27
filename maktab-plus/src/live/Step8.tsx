// Step 8a: connect Telegram (school messages come to the person's own Telegram).
// The web app only asks the server for a ONE-TIME link; the bot worker does the rest.
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { readXlsx, writeXlsx, download, excelDate, type Sheet } from "./xlsx";
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

// ---------------------------------------------------------------- Step 8b: school setup from Excel
// The file is read HERE in the browser; the server only gets plain rows and the
// database checks every one (preview first, then save all-or-nothing).

type ImpErr = { sheet: "teachers" | "students" | "timetable"; row: number; field: string; code: string; value?: string };
type ImpResult = { ok: boolean; committed: boolean; errors: ImpErr[]; warnings: ImpErr[];
  summary: Record<string, number>; logins?: { name: string; role: string; login: string; password: string; child?: string }[] };

const SHEETS = {
  teachers: { uz: "O'qituvchilar", alt: ["oqituvchilar", "учителя", "teachers"],
              cols: ["Familiya", "Ism", "Telefon", "Sinf rahbari (sinf)"], widths: [18, 16, 18, 20] },
  students: { uz: "O'quvchilar", alt: ["oquvchilar", "ученики", "students"],
              cols: ["Familiya", "Ism", "Otasining ismi", "Sinf yoki guruh", "Tug'ilgan sana", "Jinsi", "Ota-ona familiyasi", "Ota-ona ismi", "Ota-ona telefoni", "Kim (ona/ota/...)", "O'quvchining o'z telefoni"],
              widths: [16, 14, 16, 22, 15, 10, 18, 14, 18, 16, 22] },
  timetable: { uz: "Dars jadvali", alt: ["darsjadvali", "расписание", "timetable"],
               cols: ["Sinf", "Kun", "Dars (1-9)", "Fan", "O'qituvchi telefoni"], widths: [8, 14, 10, 18, 20] },
} as const;
const norm = (s: string) => s.toLowerCase().replace(/[\s'’‘`ʻ-]/g, "");

export function templateBlob(): Blob {
  return writeXlsx([
    { name: "Ko'rsatma", plain: true, widths: [100], rows: [
      ["Maktab+ — maktabni sozlash shabloni"],
      ["1. \"O'qituvchilar\", \"O'quvchilar\" va \"Dars jadvali\" varaqlarini to'ldiring. Birinchi qatorni (sarlavha) o'chirmang."],
      ["2. Telefon: +998 90 123 45 67 yoki 901234567. Telefon — login bo'ladi."],
      ["3. Sinf: 5-A, 7-B kabi. Kun: Dushanba … Shanba yoki 1–6. Fan nomi Maktab+ dagidek: Matematika, Ingliz tili …"],
      ["4. Tug'ilgan sana: 21.05.2014. Jinsi: o'g'il / qiz. Kim: ona, ota, buvi, bobo, aka, opa."],
      ["O'quv markaz: \"Sinf yoki guruh\" ustuniga guruh nomini yozing (guruh avval Maktab+ da ochilgan bo'lsin). Katta yoshli o'quvchining o'z telefonini oxirgi ustunga yozing — u o'zi login oladi."],
      ["5. Faylni Maktab+ ga yuklang: avval tekshiriladi, xato bo'lsa hech narsa saqlanmaydi. Qayta yuklash xavfsiz — takror yaratilmaydi."],
      ["Misol (O'quvchilar): Aliyev | Ali | Valiyevich | 5-A | 12.03.2015 | o'g'il | Aliyeva | Malika | +998935556677 | ona"],
    ] },
    ...Object.values(SHEETS).map((s) => ({ name: s.uz, rows: [[...s.cols]], widths: [...s.widths] })),
  ]);
}

export function rowsFromSheets(sheets: Sheet[]) {
  const find = (k: keyof typeof SHEETS) => sheets.find((s) => norm(s.name) === norm(SHEETS[k].uz) || (SHEETS[k].alt as readonly string[]).includes(norm(s.name)));
  const body = (s?: Sheet) => (s?.rows ?? []).map((r, i) => ({ r, row: i + 1 })).slice(1).filter(({ r }) => r.some((c) => (c ?? "").trim() !== ""));
  return {
    found: { teachers: !!find("teachers"), students: !!find("students"), timetable: !!find("timetable") },
    data: {
      teachers: body(find("teachers")).map(({ r, row }) => ({ row, last_name: r[0], first_name: r[1], phone: r[2], class_teacher_of: r[3] })),
      students: body(find("students")).map(({ r, row }) => ({ row, last_name: r[0], first_name: r[1], middle_name: r[2], class: r[3],
        birth_date: excelDate(r[4] ?? ""), gender: r[5], parent_last_name: r[6], parent_first_name: r[7], parent_phone: r[8], relation: r[9], phone: r[10] })),
      timetable: body(find("timetable")).map(({ r, row }) => ({ row, class: r[0], day: r[1], period: r[2], subject: r[3], teacher_phone: r[4] })),
    },
  };
}

export function SchoolSetup({ i }: { i: I18n }) {
  const { t } = i;
  const [file, setFile] = useState<{ name: string; data: ReturnType<typeof rowsFromSheets>["data"]; found: Record<string, boolean> } | null>(null);
  const [res, setRes] = useState<ImpResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pick = async (f: File | undefined) => {
    setErr(""); setRes(null); setFile(null);
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { setErr(t("imp_too_big")); return; }
    try {
      const parsed = rowsFromSheets(readXlsx(await f.arrayBuffer()));
      if (!parsed.found.teachers && !parsed.found.students && !parsed.found.timetable) { setErr(t("imp_no_sheets")); return; }
      setFile({ name: f.name, ...parsed }); await run(parsed.data, false);
    } catch { setErr(t("imp_not_xlsx")); }
  };
  const run = async (data: object, commit: boolean) => {
    setBusy(true); setErr("");
    try { setRes(await api<ImpResult>("/office/import", { method: "POST", body: JSON.stringify({ data, commit }) })); }
    catch (e) { setErr(e instanceof ApiError ? t(`imp_x_${e.code}`) : t("error")); }
    finally { setBusy(false); }
  };
  const sheetName = (s: string) => SHEETS[s as keyof typeof SHEETS]?.uz ?? s;
  const sm = res?.summary ?? {};
  return (
    <Card title={<span><Icon name="file-spreadsheet" /> {t("imp_title")}</span>} sub={t("imp_sub")}>
      {!res?.committed && (
        <div className="stack">
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={() => download(templateBlob(), "Maktab+_shablon.xlsx")}><Icon name="download" />{t("imp_template")}</button>
            <label className="btn btn-primary" style={{ cursor: "pointer" }}>
              <Icon name="upload" />{t("imp_upload")}
              <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden
                onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {file && <span className="small muted"><Icon name="file" /> {file.name}</span>}
          </div>
          <p className="small muted" style={{ margin: 0 }}>{t("imp_how")}</p>
        </div>
      )}
      {busy && <p className="small muted"><Icon name="loader" /> {t("loading")}</p>}
      {err && <div className="callout callout-warn" style={{ marginTop: 12 }}><Icon name="alert-triangle" /><div>{err}</div></div>}
      {res && !res.committed && (
        <div className="stack" style={{ marginTop: 14 }}>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <Badge tone="brand">{t("imp_s_classes", { n: sm.classes_new })}</Badge>
            <Badge tone="brand">{t("imp_s_teachers", { n: sm.teachers_new, m: sm.teachers_existing })}</Badge>
            <Badge tone="brand">{t("imp_s_students", { n: sm.students_new, m: sm.students_existing })}</Badge>
            <Badge tone="brand">{t("imp_s_parents", { n: sm.parents_new, m: sm.parents_existing })}</Badge>
            <Badge tone="brand">{t("imp_s_slots", { n: sm.timetable_rows })}</Badge>
          </div>
          {res.errors.length > 0 ? (
            <>
              <div className="callout callout-warn"><Icon name="alert-triangle" /><div><b>{t("imp_has_errors", { n: res.errors.length })}</b> {t("imp_fix_and_retry")}</div></div>
              <div className="table-wrap"><table className="table">
                <thead><tr><th>{t("imp_sheet")}</th><th>{t("imp_row")}</th><th>{t("imp_problem")}</th><th>{t("imp_value")}</th></tr></thead>
                <tbody>{res.errors.slice(0, 200).map((e, k) => (
                  <tr key={k}><td>{sheetName(e.sheet)}</td><td className="tnum">{e.row}</td><td>{t(`imp_e_${e.code}`)}</td><td className="small muted">{e.value ?? ""}</td></tr>))}</tbody>
              </table></div>
            </>
          ) : (
            <div className="callout callout-info"><Icon name="circle-check" /><div><b>{t("imp_all_good")}</b>
              {res.warnings.length > 0 && <div className="small">{t("imp_warn_no_phone", { n: res.warnings.length })}</div>}</div></div>
          )}
          {res.ok && file && <div><button className="btn btn-primary" disabled={busy} onClick={() => run(file.data, true)}><Icon name="device-floppy" />{t("imp_save")}</button></div>}
        </div>
      )}
      {res?.committed && <LoginSlips i={i} res={res} onDone={() => { setRes(null); setFile(null); }} />}
    </Card>
  );
}

function LoginSlips({ i, res, onDone }: { i: I18n; res: ImpResult; onDone: () => void }) {
  const { t } = i;
  const logins = res.logins ?? [];
  const xls = () => download(writeXlsx([{ name: "Loginlar", widths: [26, 10, 18, 12, 24],
    rows: [["F.I.Sh.", "Rol", "Login", "Parol", "Farzandi"], ...logins.map((l) => [l.name, t(`role_${l.role}`), l.login, l.password, l.child ?? ""])] }]), "Maktab+_loginlar.xlsx");
  return (
    <div className="stack" style={{ marginTop: 6 }}>
      <div className="callout callout-info"><Icon name="circle-check" /><div><b>{t("imp_saved")}</b>
        <div className="small">{t("imp_s_students", { n: res.summary.students_new, m: res.summary.students_existing })} · {t("imp_s_teachers", { n: res.summary.teachers_new, m: res.summary.teachers_existing })}</div></div></div>
      {logins.length > 0 ? (
        <>
          <div className="callout callout-warn"><Icon name="key" /><div>{t("imp_pw_once", { n: logins.length })}</div></div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>F.I.Sh.</th><th>{t("imp_role")}</th><th>Login</th><th>{t("password")}</th><th>{t("imp_child")}</th></tr></thead>
            <tbody>{logins.map((l) => (
              <tr key={l.login}><td><b>{l.name}</b></td><td>{t(`role_${l.role}`)}</td><td className="tnum">{l.login}</td><td><code>{l.password}</code></td><td className="small muted">{l.child ?? ""}</td></tr>))}</tbody>
          </table></div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary" onClick={xls}><Icon name="download" />{t("imp_download_logins")}</button>
            <button className="btn" onClick={onDone}>{t("imp_done")}</button>
          </div>
        </>
      ) : <div><button className="btn" onClick={onDone}>{t("imp_done")}</button></div>}
    </div>
  );
}
