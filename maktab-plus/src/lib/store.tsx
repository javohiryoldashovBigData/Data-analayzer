import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AbsenceReason, AppNotification, AttendanceStatus, DB, NotificationKind, Session } from "../data/types";
import { createSeed, DB_VERSION } from "../data/seed";
import { minutes, nowStamp, nowTime, PERIOD_START, today, weekday } from "./date";

const DB_KEY = "maktab.db";
const SESSION_KEY = "maktab.session";

function loadDB(): DB {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const db = JSON.parse(raw) as DB;
      if (db.version === DB_VERSION) return db;
    }
  } catch { /* storage unavailable or corrupt: fall back to a fresh demo */ }
  return createSeed();
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

let idCounter = Date.now();
export const newId = (p: string) => `${p}${(idCounter++).toString(36)}`;

export function notify(db: DB, userId: string, kind: NotificationKind, params: Record<string, string>) {
  const n: AppNotification = { id: newId("n"), userId, kind, params, createdAt: nowStamp(), read: false };
  db.notifications.push(n);
}

/** Who should hear about a student: their parent(s) and the class teacher. */
function guardians(db: DB, studentId: string) {
  const st = db.students.find((s) => s.id === studentId)!;
  const parentIds = db.parents.filter((p) => p.childIds.includes(studentId)).map((p) => p.id);
  const homeroom = db.classes.find((c) => c.id === st.classId)!.homeroomTeacherId;
  return { st, parentIds, homeroom };
}

interface Store {
  db: DB;
  session: Session | null;
  toast: string | null;
  login: (s: Session) => void;
  logout: () => void;
  update: (fn: (draft: DB) => void) => void;
  resetDemo: () => void;
  showToast: (msg: string) => void;
  actions: {
    gateScan: (studentId: string, type: "in" | "out", time?: string) => void;
    checkMissing: () => number;
    setMark: (studentId: string, date: string, lessonId: string, status: AttendanceStatus | null) => void;
    reportAbsence: (studentId: string, parentId: string, date: string, reason: AbsenceReason, note: string, until?: string) => void;
    acceptAbsence: (absenceId: string) => void;
    setGrade: (p: { studentId: string; subjectId: string; date: string; value: number | null; kind?: import("../data/types").GradeKind; teacherId: string; comment?: string; aiSuggested?: boolean }) => void;
    markRead: (userId: string) => void;
  };
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB>(loadDB);
  const [session, setSession] = useState<Session | null>(loadSession);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch { /* quota or private mode */ }
  }, [db]);

  useEffect(() => {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch { /* ignore */ }
  }, [session]);

  const update = useCallback((fn: (draft: DB) => void) => {
    setDb((prev) => {
      const draft = structuredClone(prev);
      fn(draft);
      return draft;
    });
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  const actions = useMemo<Store["actions"]>(() => ({
    gateScan(studentId, type, time = nowTime()) {
      update((d) => {
        const date = today();
        d.gate.push({ id: newId("g"), studentId, date, time, type });
        const { st, parentIds } = guardians(d, studentId);
        const late = type === "in" && minutes(time) > minutes(d.settings.lateAfter);
        for (const p of parentIds) notify(d, p, type === "out" ? "left" : late ? "late" : "arrived", { student: st.name, time, date });
        if (late) {
          const first = d.lessons.filter((l) => l.classId === st.classId && l.day === weekday(date)).sort((a, b) => a.period - b.period)[0];
          if (first && !d.marks.some((m) => m.studentId === studentId && m.date === date && m.lessonId === first.id)) {
            d.marks.push({ id: newId("m"), studentId, date, lessonId: first.id, status: "late" });
          }
        }
      });
    },
    checkMissing() {
      let count = 0;
      update((d) => {
        const date = today();
        for (const st of d.students) {
          const arrived = d.gate.some((g) => g.studentId === st.id && g.date === date && g.type === "in");
          const reported = d.absences.some((a) => a.studentId === st.id && a.date === date);
          const already = d.notifications.some((n) => n.kind === "notArrived" && n.params.student === st.name && n.params.date === date);
          if (arrived || reported || already) continue;
          count++;
          const { parentIds, homeroom } = guardians(d, st.id);
          for (const p of parentIds) notify(d, p, "notArrived", { student: st.name, date, time: nowTime() });
          notify(d, homeroom, "notArrived", { student: st.name, date, time: nowTime() });
        }
      });
      return count;
    },
    setMark(studentId, date, lessonId, status) {
      update((d) => {
        d.marks = d.marks.filter((m) => !(m.studentId === studentId && m.date === date && m.lessonId === lessonId));
        if (!status) return;
        d.marks.push({ id: newId("m"), studentId, date, lessonId, status });
        // At school (checked in, not out) but absent from a lesson → possible skipped lesson.
        const ins = d.gate.filter((g) => g.studentId === studentId && g.date === date);
        const inside = ins.some((g) => g.type === "in") && !ins.some((g) => g.type === "out");
        if (status === "absent" && inside) {
          const lesson = d.lessons.find((l) => l.id === lessonId)!;
          const { st, parentIds, homeroom } = guardians(d, studentId);
          const params = { student: st.name, subject: lesson.subjectId, period: String(lesson.period), date, time: PERIOD_START[lesson.period - 1] };
          for (const p of parentIds) notify(d, p, "skipped", params);
          notify(d, homeroom, "skipped", params);
        }
      });
    },
    reportAbsence(studentId, parentId, date, reason, note, until) {
      update((d) => {
        d.absences.push({ id: newId("ab"), studentId, parentId, date, reason, note, until, status: "pending", createdAt: nowStamp() });
        const { st, homeroom } = guardians(d, studentId);
        notify(d, homeroom, "absenceReported", { student: st.name, date, reason, until: until ?? "" });
      });
    },
    acceptAbsence(absenceId) {
      update((d) => {
        const a = d.absences.find((x) => x.id === absenceId);
        if (!a) return;
        a.status = "accepted";
        const st = d.students.find((s) => s.id === a.studentId)!;
        const dayLessons = d.lessons.filter((l) => l.classId === st.classId && l.day === weekday(a.date));
        for (const l of dayLessons) {
          if (a.until && PERIOD_START[l.period - 1] >= a.until) continue;
          d.marks = d.marks.filter((m) => !(m.studentId === st.id && m.date === a.date && m.lessonId === l.id));
          d.marks.push({ id: newId("m"), studentId: st.id, date: a.date, lessonId: l.id, status: "excused" });
        }
        notify(d, a.parentId, "absenceAccepted", { student: st.name, date: a.date });
      });
    },
    setGrade({ studentId, subjectId, date, value, kind = "oral", teacherId, comment, aiSuggested }) {
      update((d) => {
        const existing = d.grades.find((g) => g.studentId === studentId && g.subjectId === subjectId && g.date === date && g.kind === kind);
        if (value == null) {
          d.grades = d.grades.filter((g) => g !== existing);
          return;
        }
        if (existing) Object.assign(existing, { value, comment, aiSuggested, teacherId });
        else d.grades.push({ id: newId("gr"), studentId, subjectId, date, value, kind, teacherId, comment, aiSuggested });
        const { st, parentIds } = guardians(d, studentId);
        for (const p of parentIds) notify(d, p, "grade", { student: st.name, subject: subjectId, value: String(value), date });
      });
    },
    markRead(userId) {
      update((d) => { d.notifications.forEach((n) => { if (n.userId === userId) n.read = true; }); });
    },
  }), [update]);

  const value: Store = {
    db, session, toast,
    login: (s) => setSession(s),
    logout: () => setSession(null),
    update,
    resetDemo: () => { const apiKey = db.settings.apiKey; const fresh = createSeed(); fresh.settings.apiKey = apiKey; setDb(fresh); },
    showToast,
    actions,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

/** Convenience lookups for the signed-in user. */
export function useMe() {
  const { db, session } = useStore();
  if (!session) return null;
  const { role, id } = session;
  const name =
    role === "director" ? "Shavkat Mirzayev"
    : role === "teacher" ? db.teachers.find((t) => t.id === id)?.name
    : role === "student" ? db.students.find((s) => s.id === id)?.name
    : db.parents.find((p) => p.id === id)?.name;
  return { role, id, name: name ?? "—" };
}
