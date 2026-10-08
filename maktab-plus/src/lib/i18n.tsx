import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { L10n, Lang } from "../data/types";
import { DICT } from "./dict";
import { SUBJECTS } from "../data/seed";

export const LANGS: { id: Lang; label: string }[] = [
  { id: "uz", label: "Oʻzbekcha" },
  { id: "ru", label: "Русский" },
  { id: "en", label: "English" },
];

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  tl: (v: L10n) => string;
  subj: (subjectId: string) => string;
  fmtDate: (iso: string, opts?: Intl.DateTimeFormatOptions) => string;
}

const Ctx = createContext<I18n | null>(null);

// Browsers' Uzbek locale data is often incomplete ("M10"), so Uzbek dates are formatted by hand.
const UZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const UZ_MONTHS_SHORT = ["yan", "fev", "mar", "apr", "may", "iyun", "iyul", "avg", "sen", "okt", "noy", "dek"];
const UZ_DAYS = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];
const UZ_DAYS_SHORT = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];

function fmtUz(date: Date, opts: Intl.DateTimeFormatOptions): string {
  const parts: string[] = [];
  if (opts.weekday) parts.push((opts.weekday === "long" ? UZ_DAYS : UZ_DAYS_SHORT)[date.getDay()] + ",");
  if (opts.day) parts.push(String(date.getDate()));
  if (opts.month) parts.push((opts.month === "long" ? UZ_MONTHS : UZ_MONTHS_SHORT)[date.getMonth()]);
  if (!opts.day && !opts.month && !opts.weekday) parts.push(`${date.getDate()} ${UZ_MONTHS_SHORT[date.getMonth()]}`);
  return parts.join(" ").replace(/,$/, "");
}
const LOCALE: Record<Lang, string> = { uz: "uz-Latn-UZ", ru: "ru-RU", en: "en-GB" };

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("maktab.lang") as Lang | null;
    if (saved && ["uz", "ru", "en"].includes(saved)) return saved;
  } catch { /* ignore */ }
  return "uz";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang;
    try { localStorage.setItem("maktab.lang", lang); } catch { /* ignore */ }
  }, [lang]);

  const t = useCallback((key: string, params?: Record<string, string | number>) => {
    const entry = DICT[key];
    let s = entry ? entry[lang] ?? entry.en : key;
    if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
    return s;
  }, [lang]);

  const value = useMemo<I18n>(() => ({
    lang,
    setLang: setLangState,
    t,
    tl: (v) => v[lang] ?? v.en,
    subj: (id) => SUBJECTS.find((s) => s.id === id)?.name[lang] ?? id,
    fmtDate: (iso, opts = { day: "numeric", month: "short" }) => {
      const [y, m, d] = iso.split("-").map(Number);
      if (lang === "uz") return fmtUz(new Date(y, m - 1, d), opts);
      try {
        return new Intl.DateTimeFormat(LOCALE[lang], opts).format(new Date(y, m - 1, d));
      } catch {
        return iso;
      }
    },
  }), [lang, t]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const c = useContext(Ctx);
  if (!c) throw new Error("useI18n outside I18nProvider");
  return c;
}
