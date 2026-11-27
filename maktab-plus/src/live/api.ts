// Talks to the Maktab+ API server (server/index.mjs). The server runs every
// request as the logged-in user inside the database, so RLS decides the data.
const KEY = "maktab.live.token";

export function getToken(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function setToken(t: string | null) {
  try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch { /* private mode */ }
}

export class ApiError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  const data = await res.json().catch(() => ({ error: "bad_response" }));
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiError(data.error ?? "error", res.status);
  }
  return data as T;
}

// The school "window": from the subdomain (school-a.maktabplus.uz) or ?school=,
// falling back to the public demo school.
export function schoolSlug(): string {
  const q = new URLSearchParams(location.search).get("school");
  if (q) return q.toLowerCase();
  const sub = location.hostname.split(".")[0];
  if (location.hostname.split(".").length > 2 && /^[a-z0-9-]+$/.test(sub) && sub !== "www") return sub;
  return "demo";
}

// ---- shapes returned by /api/home ----------------------------------------------
export type SchoolWindow = { school_id: string; name: string; logo_url: string | null; brand_color: string; mode: "private" | "government"; org_kind?: "school" | "center" };
export type AskFirst = { student_id: string; name: string; score: number };
export type Lesson = {
  period: number; start: string | null; end: string | null; class: string; class_id: string;
  subject: string; subject_id: number; substitution: boolean;
  card: { id: string; status: "draft" | "ai_draft" | "approved"; topic: string | null } | null;
  attendance_done: boolean; lesson_done: boolean; ask_first: AskFirst[];
};
export type Kid = { id: string; first_name: string; last_name: string; class: string; class_id: string };
export type Home = {
  me: { first_name: string; last_name: string };
  school: { school_id: string; slug: string; name: string; org_kind?: "school" | "center" } | null;
  roles: string[];
  role: string;
  day?: { date: string; lessons: Lesson[]; absence_reports_pending: number; closed: boolean };
  kids?: Kid[];
  gateToday?: { student_id: string; direction: "in" | "out"; scanned_at: string }[];
  grades?: { student_id: string; value: number; grade_type: string; comment: string | null; created_at: string; subject: string }[];
  attendance?: { student_id: string; present: number; late: number; absent: number; total: number }[];
  homework?: { class_id: string; description: string; due_date: string; subject: string }[];
  teachers?: { student_id: string; teacher_id: string; first_name: string; last_name: string; subject: string | null; is_class_teacher: boolean }[];
  absenceReports?: { id: string; student_id: string; absence_date: string; reason: string | null; status: string }[];
  stats?: { students: number; attendance_rate: number | null; avg_current_grade: number | null };
  counts?: { classes: number; teachers: number; problems_open: number; absence_pending: number; arrived_today: number };
  problems?: { id: string; category: string; severity: "small" | "serious"; description: string; status: string; created_at: string }[];
  classAttendance?: { class: string; rate: number }[];
  messages?: { id: string; student_id: string; topic: string; body: string; status: string; reply: string | null; created_at: string; answered_at: string | null }[];
  absenceToReview?: { id: string; student_id: string; absence_date: string; reason: string | null; first_name: string; last_name: string; class: string }[];
  forwarded?: { id: string; topic: string; body: string; status: string; created_at: string; student: string }[];
  inbox?: { id: string; topic: string; body: string; status: string; reply: string | null; created_at: string; forwarded_to: string | null; student: string; class: string | null; parent: string | null; about_teacher: string | null }[];
  staffTeachers?: { id: string; name: string }[];
  isClassTeacher?: boolean;
  assignments?: { class_id: string; class: string; subject_id: number; subject: string }[];
  seesMoney?: boolean;
  canSetup?: boolean;
  reviews?: import("./Step5").Review[];
  aiBudget?: import("./Step5").AiBudget;
};
export type DiaryLesson = { date: string; period: number; subject_id: number; subject: string; start: string | null; end: string | null; topic: string | null };
