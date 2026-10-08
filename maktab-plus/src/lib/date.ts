/** Date helpers. Dates are stored as local "YYYY-MM-DD" strings. */

export function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parse(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function today(): string {
  return iso(new Date());
}

export function addDays(s: string, n: number): string {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}

/** 1 = Monday … 7 = Sunday */
export function weekday(s: string): number {
  const w = parse(s).getDay();
  return w === 0 ? 7 : w;
}

export function weekStart(s: string): string {
  return addDays(s, 1 - weekday(s));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
}

export function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function nowStamp(): string {
  return `${today()} ${nowTime()}`;
}

/** Start of the school year that contains the given date (2 September). */
export function schoolYearStart(s: string): string {
  const d = parse(s);
  const year = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${year}-09-02`;
}

export function minutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function fmtTime(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/** Bell schedule: start time of each period. */
export const PERIOD_START = ["08:00", "08:55", "09:50", "10:55", "11:50", "12:45"];
export const PERIOD_LEN = 45;
