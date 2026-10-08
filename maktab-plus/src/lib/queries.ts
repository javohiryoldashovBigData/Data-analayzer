import type { DB } from "../data/types";
import { addDays, minutes, today, weekday } from "./date";

export const className = (db: DB, classId: string) => db.classes.find((c) => c.id === classId)?.name ?? "";
export const studentOf = (db: DB, id: string) => db.students.find((s) => s.id === id)!;
export const teacherName = (db: DB, id: string) => db.teachers.find((t) => t.id === id)?.name ?? "";

export function lessonsOn(db: DB, classId: string, date: string) {
  return db.lessons.filter((l) => l.classId === classId && l.day === weekday(date)).sort((a, b) => a.period - b.period);
}

export function teacherLessonsOn(db: DB, teacherId: string, date: string) {
  return db.lessons.filter((l) => l.teacherId === teacherId && l.day === weekday(date)).sort((a, b) => a.period - b.period);
}

/** Classes and subjects a teacher teaches, as unique pairs. */
export function teacherPairs(db: DB, teacherId: string) {
  const seen = new Set<string>();
  const pairs: { classId: string; subjectId: string }[] = [];
  for (const l of db.lessons.filter((x) => x.teacherId === teacherId)) {
    const k = `${l.classId}|${l.subjectId}`;
    if (!seen.has(k)) { seen.add(k); pairs.push({ classId: l.classId, subjectId: l.subjectId }); }
  }
  return pairs.sort((a, b) => className(db, a.classId).localeCompare(className(db, b.classId)));
}

/** Dates (past and today) when this class had this subject, newest last. */
export function lessonDates(db: DB, classId: string, subjectId: string, from: string, to = today()) {
  const days = new Set(db.lessons.filter((l) => l.classId === classId && l.subjectId === subjectId).map((l) => l.day));
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (days.has(weekday(d))) out.push(d);
  return out;
}

export type GateState = "notArrived" | "atSchool" | "late" | "left" | "reported";

export function gateToday(db: DB, studentId: string, date = today()) {
  const evs = db.gate.filter((g) => g.studentId === studentId && g.date === date).sort((a, b) => a.time.localeCompare(b.time));
  const inEv = evs.find((e) => e.type === "in");
  const outEv = [...evs].reverse().find((e) => e.type === "out");
  const report = db.absences.find((a) => a.studentId === studentId && a.date === date);
  let state: GateState = "notArrived";
  if (outEv) state = "left";
  else if (inEv) state = minutes(inEv.time) > minutes(db.settings.lateAfter) ? "late" : "atSchool";
  else if (report) state = "reported";
  return { state, in: inEv?.time, out: outEv?.time, report };
}

export function homeworkFor(db: DB, classId: string, date: string) {
  // Homework set on the previous lesson of each subject is due on `date`.
  return lessonsOn(db, classId, date).map((l) => {
    const hw = db.homework
      .filter((h) => h.classId === classId && h.subjectId === l.subjectId && h.date < date)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    return { lesson: l, hw };
  });
}
