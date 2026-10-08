/**
 * Local analytics that work without any AI key: averages, trends, readiness ("who to ask first"),
 * risk detection and the independent-work checks for weekly tests.
 * Everything here is explainable: each score comes with the reasons behind it.
 */
import type { DB, Grade, IntegrityFlag, Question, TestAttempt } from "../data/types";
import { addDays, daysBetween, minutes, today, weekday } from "../lib/date";

export function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function round1(n: number | null): string {
  return n == null ? "—" : n.toFixed(1);
}

/** Least-squares slope of grades over time, in grade points per week. */
export function trendPerWeek(grades: Grade[]): number {
  if (grades.length < 4) return 0;
  const t0 = grades[0].date;
  const xs = grades.map((g) => daysBetween(t0, g.date) / 7);
  const ys = grades.map((g) => g.value);
  const mx = avg(xs)!, my = avg(ys)!;
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  return den === 0 ? 0 : num / den;
}

export function gradesOf(db: DB, studentId: string, subjectId?: string): Grade[] {
  return db.grades
    .filter((g) => g.studentId === studentId && (!subjectId || g.subjectId === subjectId))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function studentAverage(db: DB, studentId: string, subjectId?: string) {
  return avg(gradesOf(db, studentId, subjectId).map((g) => g.value));
}

/** Projected quarter grade: recent grades weigh more, plus the current trend. */
export function forecast(db: DB, studentId: string, subjectId: string): number | null {
  const gs = gradesOf(db, studentId, subjectId);
  if (!gs.length) return null;
  let w = 0, s = 0;
  gs.forEach((g, i) => { const wt = 1 + i / gs.length; w += wt; s += g.value * wt; });
  const projected = s / w + trendPerWeek(gs) * 2;
  return Math.max(2, Math.min(5, projected));
}

export function attendanceStats(db: DB, studentId: string, sinceDays = 30) {
  const since = addDays(today(), -sinceDays);
  const marks = db.marks.filter((m) => m.studentId === studentId && m.date >= since);
  const lessonDays = new Set(db.gate.filter((g) => g.studentId === studentId && g.date >= since && g.type === "in").map((g) => g.date));
  const absentDays = new Set(marks.filter((m) => m.status !== "late").map((m) => m.date));
  const unexplained = marks.filter((m) => m.status === "absent").length;
  const late = db.gate.filter((g) => g.studentId === studentId && g.date >= since && g.type === "in" && minutes(g.time) > minutes(db.settings.lateAfter)).length;
  const total = lessonDays.size + [...absentDays].filter((d) => !lessonDays.has(d)).length;
  const rate = total ? Math.round((lessonDays.size / total) * 100) : 100;
  return { rate, absentDays: [...absentDays].filter((d) => !lessonDays.has(d)).length, unexplained, late, skipped: marks.filter((m) => m.status === "absent" && lessonDays.has(m.date)).length };
}

export function homeworkRate(db: DB, studentId: string, subjectId?: string) {
  const st = db.students.find((s) => s.id === studentId);
  const hw = db.homework.filter((h) => h.classId === st?.classId && (!subjectId || h.subjectId === subjectId) && studentId in h.done);
  if (!hw.length) return null;
  return Math.round((hw.filter((h) => h.done[studentId]).length / hw.length) * 100);
}

// ---------------------------------------------------------------- readiness

export type ReadinessReason =
  | { key: "noHomework" }
  | { key: "lowRecent"; avg: string }
  | { key: "dropping"; slope: string }
  | { key: "missedLast"; date: string }
  | { key: "weakTest"; pct: string }
  | { key: "notAsked"; days: string };

export interface Readiness {
  studentId: string;
  score: number;
  reasons: ReadinessReason[];
  daysSinceAsked: number;
}

/** Ranks the students of a class by how likely they are to be unprepared for today's lesson. */
export function readiness(db: DB, classId: string, subjectId: string, date = today()): Readiness[] {
  const students = db.students.filter((s) => s.classId === classId);
  const prevHw = db.homework
    .filter((h) => h.classId === classId && h.subjectId === subjectId && h.date < date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const prevLessonDate = [...new Set(db.topics.filter((t) => t.classId === classId && t.subjectId === subjectId && t.date < date).map((t) => t.date))].sort().pop();
  const lessonIdsOnPrev = prevLessonDate ? db.lessons.filter((l) => l.classId === classId && l.subjectId === subjectId && l.day === weekday(prevLessonDate)).map((l) => l.id) : [];
  const lastTest = db.tests
    .filter((t) => t.classId === classId && t.subjectId === subjectId && t.status === "closed")
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];

  return students
    .map((s) => {
      const reasons: ReadinessReason[] = [];
      let score = 0;
      if (prevHw && prevHw.done[s.id] === false) { score += 35; reasons.push({ key: "noHomework" }); }
      const gs = gradesOf(db, s.id, subjectId);
      const recent = avg(gs.slice(-3).map((g) => g.value));
      if (recent != null && recent < 3.7) { score += (4.2 - recent) * 18; reasons.push({ key: "lowRecent", avg: recent.toFixed(1) }); }
      const slope = trendPerWeek(gs);
      if (slope < -0.12) { score += 12; reasons.push({ key: "dropping", slope: slope.toFixed(2) }); }
      if (prevLessonDate && db.marks.some((m) => m.studentId === s.id && m.date === prevLessonDate && lessonIdsOnPrev.includes(m.lessonId) && m.status !== "late")) {
        score += 22; reasons.push({ key: "missedLast", date: prevLessonDate });
      }
      if (lastTest) {
        const at = db.attempts.find((a) => a.testId === lastTest.id && a.studentId === s.id);
        if (at && at.score / at.maxScore < 0.6) { score += 15; reasons.push({ key: "weakTest", pct: String(Math.round((at.score / at.maxScore) * 100)) }); }
      }
      const lastGraded = gs[gs.length - 1]?.date;
      const daysSinceAsked = lastGraded ? daysBetween(lastGraded, date) : 99;
      if (daysSinceAsked >= 14) reasons.push({ key: "notAsked", days: String(daysSinceAsked) });
      return { studentId: s.id, score: Math.round(score), reasons, daysSinceAsked };
    })
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------- risk

export interface Risk {
  studentId: string;
  level: "high" | "medium" | "low";
  points: number;
  reasons: { key: "lowAvg" | "falling" | "absences" | "skipped" | "homework"; value: string }[];
}

export function studentRisk(db: DB, studentId: string): Risk {
  const reasons: Risk["reasons"] = [];
  let points = 0;
  const a = studentAverage(db, studentId);
  if (a != null && a < 3.5) { points += a < 3.2 ? 3 : 2; reasons.push({ key: "lowAvg", value: a.toFixed(1) }); }
  const slope = trendPerWeek(gradesOf(db, studentId));
  if (slope < -0.05) { points += 2; reasons.push({ key: "falling", value: slope.toFixed(2) }); }
  const att = attendanceStats(db, studentId, 30);
  if (att.absentDays >= 2) { points += att.absentDays >= 3 ? 2 : 1; reasons.push({ key: "absences", value: String(att.absentDays) }); }
  if (att.skipped > 0) { points += 2; reasons.push({ key: "skipped", value: String(att.skipped) }); }
  const hw = homeworkRate(db, studentId);
  if (hw != null && hw < 65) { points += 1; reasons.push({ key: "homework", value: String(hw) }); }
  return { studentId, points, reasons, level: points >= 5 ? "high" : points >= 3 ? "medium" : "low" };
}

// ---------------------------------------------------------------- independent work

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2));
}

export function similarity(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((w) => { if (tb.has(w)) inter++; });
  return inter / (ta.size + tb.size - inter);
}

/**
 * Signals that a student may not have worked alone. These are prompts for the teacher to look closer,
 * never automatic verdicts — the final decision is always the teacher's.
 */
export function integrityFlags(db: DB, attempt: TestAttempt): IntegrityFlag[] {
  const test = db.tests.find((t) => t.id === attempt.testId)!;
  const qs = test.questionIds.map((id) => db.questions.find((q) => q.id === id)!).filter(Boolean) as Question[];
  const others = db.attempts.filter((a) => a.testId === attempt.testId && a.id !== attempt.id);
  const nameOf = (sid: string) => db.students.find((s) => s.id === sid)?.name ?? "?";
  const flags: IntegrityFlag[] = [];

  // 1. written answers almost identical to another student's. Short answers are skipped because
  //    correct short answers naturally look alike; one flag per other student, however many questions match.
  const similarTo = new Map<string, number>();
  for (const q of qs.filter((q) => q.type === "short")) {
    const mine = String(attempt.answers[q.id] ?? "");
    if (mine.trim().length < 25) continue;
    for (const o of others) {
      if (similarity(mine, String(o.answers[q.id] ?? "")) >= 0.85) similarTo.set(o.studentId, (similarTo.get(o.studentId) ?? 0) + 1);
    }
  }
  for (const [sid, count] of similarTo) {
    flags.push({ kind: "similar", detail: { other: nameOf(sid), count: String(count) }, weight: 2 });
  }
  // 2. same wrong choices as another student
  const wrong = qs.filter((q) => q.type === "mcq" && attempt.answers[q.id] !== q.answer);
  for (const o of others) {
    const shared = wrong.filter((q) => o.answers[q.id] === attempt.answers[q.id]).length;
    const sameAll = qs.every((q) => o.answers[q.id] === attempt.answers[q.id]);
    if (wrong.length > 0 && shared === wrong.length && sameAll) {
      flags.push({ kind: "samePattern", detail: { other: nameOf(o.studentId), wrong: String(shared) }, weight: 2 });
      break;
    }
  }
  // 3. result far above the student's usual level in this subject
  const usual = studentAverage(db, attempt.studentId, test.subjectId);
  const pct = (attempt.score / attempt.maxScore) * 100;
  if (usual != null) {
    const expected = ((usual - 2) / 3) * 100;
    if (pct - expected >= 35) flags.push({ kind: "levelJump", detail: { pct: String(Math.round(pct)), usual: usual.toFixed(1) }, weight: 1 });
  }
  // 4. answered implausibly fast
  const fast = qs.filter((q) => (attempt.seconds[q.id] ?? 99) < (q.type === "short" ? 15 : 5)).length;
  if (fast >= Math.ceil(qs.length / 2)) flags.push({ kind: "tooFast", detail: { count: String(fast) }, weight: 1 });
  // 5. browser behaviour
  if (attempt.pasteCount > 0) flags.push({ kind: "paste", detail: { count: String(attempt.pasteCount) }, weight: 1 });
  if (attempt.blurCount >= 2) flags.push({ kind: "leftWindow", detail: { count: String(attempt.blurCount) }, weight: 1 });
  // 6. could not explain their own answer in the follow-up
  if (attempt.followUp?.verdict === "weak") flags.push({ kind: "followUpWeak", detail: {}, weight: 2 });
  return flags;
}

export function integrityStatus(flags: IntegrityFlag[]): "ok" | "check" | "review" {
  const w = flags.reduce((s, f) => s + f.weight, 0);
  return w >= 3 ? "review" : w >= 1 ? "check" : "ok";
}

/** Local follow-up check: does the explanation actually mention the key ideas? */
export function judgeFollowUpLocally(q: Question, answer: string): "ok" | "weak" {
  const text = answer.toLowerCase();
  if (text.trim().length < 20) return "weak";
  const keys = Array.isArray(q.answer)
    ? q.answer
    : [...tokens(q.explain.uz), ...tokens(q.explain.ru), ...tokens(q.explain.en)];
  const hits = keys.filter((k) => text.includes(String(k).toLowerCase())).length;
  return hits >= 1 ? "ok" : "weak";
}

export function percentToGrade(pct: number): number {
  return pct >= 86 ? 5 : pct >= 71 ? 4 : pct >= 56 ? 3 : 2;
}
