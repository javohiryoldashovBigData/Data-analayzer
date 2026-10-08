/**
 * Builds the school data the assistant may see. Access follows the user's role:
 * a student or parent sees only their own child's data, a teacher their classes, the director the school.
 */
import type { DB, Session } from "../data/types";
import { addDays, today } from "../lib/date";
import { className, studentOf, teacherPairs } from "../lib/queries";
import { attendanceStats, avg, forecast, homeworkRate, readiness, studentAverage, studentRisk, trendPerWeek, gradesOf } from "./insights";

const subjName = (db: DB, id: string) => db.subjects.find((s) => s.id === id)?.name.en ?? id;

export function studentSummary(db: DB, studentId: string): string {
  const st = studentOf(db, studentId);
  const att = attendanceStats(db, studentId, 30);
  const risk = studentRisk(db, studentId);
  const lines = [
    `Student: ${st.name}, class ${className(db, st.classId)}.`,
    `Overall average: ${studentAverage(db, studentId)?.toFixed(2) ?? "n/a"} (scale 2–5). Homework done: ${homeworkRate(db, studentId) ?? "n/a"}%.`,
    `Attendance (30 days): ${att.rate}% present, ${att.late} late arrivals, ${att.absentDays} absent days, ${att.skipped} lessons missed while at school.`,
    `Risk level: ${risk.level}${risk.reasons.length ? ` (${risk.reasons.map((r) => `${r.key}=${r.value}`).join(", ")})` : ""}.`,
    "By subject (average, trend per week, forecast, last grades):",
  ];
  for (const s of db.subjects) {
    const gs = gradesOf(db, studentId, s.id);
    if (!gs.length) continue;
    lines.push(`- ${subjName(db, s.id)}: avg ${avg(gs.map((g) => g.value))!.toFixed(2)}, trend ${trendPerWeek(gs).toFixed(2)}, forecast ${forecast(db, studentId, s.id)?.toFixed(1)}, last: ${gs.slice(-5).map((g) => g.value).join(" ")}`);
  }
  const attempts = db.attempts.filter((a) => a.studentId === studentId);
  for (const a of attempts) {
    const test = db.tests.find((x) => x.id === a.testId)!;
    const wrongTopics = test.questionIds
      .map((qid) => db.questions.find((q) => q.id === qid)!)
      .filter((q) => q && (q.type === "mcq" ? a.answers[q.id] !== q.answer : false))
      .map((q) => q.topic.en);
    lines.push(`Weekly test ${subjName(db, test.subjectId)}: ${a.score}/${a.maxScore}${wrongTopics.length ? `, mistakes on: ${[...new Set(wrongTopics)].join(", ")}` : ""}.`);
  }
  const recentTopics = db.topics.filter((x) => x.classId === st.classId && x.date >= addDays(today(), -10) && x.date <= today());
  lines.push(`Topics this fortnight: ${[...new Set(recentTopics.map((x) => `${subjName(db, x.subjectId)}: ${x.topic}`))].slice(0, 14).join("; ")}.`);
  return lines.join("\n");
}

export function buildContext(db: DB, session: Session, childId?: string): string {
  switch (session.role) {
    case "student":
      return studentSummary(db, session.id);
    case "parent": {
      const parent = db.parents.find((p) => p.id === session.id)!;
      const ids = childId ? [childId] : parent.childIds;
      return `Parent: ${parent.name}.\n\n` + ids.map((id) => studentSummary(db, id)).join("\n\n");
    }
    case "teacher": {
      const teacher = db.teachers.find((x) => x.id === session.id)!;
      const out = [`Teacher: ${teacher.name}. Subjects: ${teacher.subjectIds.map((s) => subjName(db, s)).join(", ")}.${teacher.homeroomClassId ? ` Homeroom teacher of ${className(db, teacher.homeroomClassId)}.` : ""}`];
      for (const p of teacherPairs(db, teacher.id)) {
        const studs = db.students.filter((s) => s.classId === p.classId);
        const ready = readiness(db, p.classId, p.subjectId);
        out.push(`\nClass ${className(db, p.classId)} — ${subjName(db, p.subjectId)}:`);
        for (const s of studs) {
          const r = ready.find((x) => x.studentId === s.id)!;
          out.push(`- ${s.name}: avg ${studentAverage(db, s.id, p.subjectId)?.toFixed(2) ?? "n/a"}, homework ${homeworkRate(db, s.id, p.subjectId) ?? "n/a"}%, readiness risk ${r.score}${r.reasons.length ? ` (${r.reasons.map((x) => x.key).join(", ")})` : ""}`);
        }
      }
      return out.join("\n");
    }
    case "director": {
      const out = [`School: ${db.schoolName}. ${db.students.length} students, ${db.teachers.length} teachers.`];
      for (const c of db.classes) {
        const studs = db.students.filter((s) => s.classId === c.id);
        out.push(`Class ${c.name}: average ${avg(studs.map((s) => studentAverage(db, s.id) ?? 0))?.toFixed(2)}, attendance ${Math.round(avg(studs.map((s) => attendanceStats(db, s.id).rate))!)}%.`);
      }
      for (const s of db.subjects) {
        out.push(`${subjName(db, s.id)} school average: ${avg(db.grades.filter((g) => g.subjectId === s.id).map((g) => g.value))?.toFixed(2)}`);
      }
      const risks = db.students.map((s) => studentRisk(db, s.id)).filter((r) => r.level !== "low");
      out.push(`Students at risk: ${risks.map((r) => `${studentOf(db, r.studentId).name} (${className(db, studentOf(db, r.studentId).classId)}, ${r.level}: ${r.reasons.map((x) => x.key).join(", ")})`).join("; ") || "none"}.`);
      return out.join("\n");
    }
  }
}
