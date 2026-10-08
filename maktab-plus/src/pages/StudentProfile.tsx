import { useParams } from "react-router-dom";
import { useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import { className } from "../lib/queries";
import { attendanceStats, homeworkRate, round1, studentAverage, studentRisk } from "../ai/insights";
import { studentSummary } from "../ai/context";
import { Avatar, Badge, Card, Empty, PageHead, Stat } from "../components/ui";
import AIBox from "../components/AIBox";
import { GradesView } from "./Grades";
import { LiveStatus } from "./Dashboard";

export default function StudentProfile() {
  const { id } = useParams();
  const { db } = useStore();
  const { t } = useI18n();
  const st = db.students.find((s) => s.id === id);
  if (!st) return <Card><Empty>{t("not_found")}</Empty></Card>;
  const parent = db.parents.find((p) => p.childIds.includes(st.id));
  const att = attendanceStats(db, st.id);
  const risk = studentRisk(db, st.id);

  return (
    <>
      <div className="row" style={{ gap: 14 }}>
        <Avatar name={st.name} large />
        <PageHead title={st.name} sub={`${className(db, st.classId)} · ${st.cardCode}${parent ? ` · ${t("parent")}: ${parent.name}, ${parent.phone}` : ""}`} />
      </div>
      <div className="grid grid-4">
        <Stat icon="star" label={t("avg_grade")} value={round1(studentAverage(db, st.id))} />
        <Stat icon="calendar-check" label={t("attendance_30")} value={`${att.rate}%`} foot={`${t("late_n", { n: att.late })} · ${t("skipped_n", { n: att.skipped })}`} />
        <Stat icon="notebook" label={t("homework_done")} value={`${homeworkRate(db, st.id) ?? "—"}%`} />
        <Stat icon="shield-heart" label={t("ai_risk")} value={<Badge tone={risk.level === "high" ? "bad" : risk.level === "medium" ? "warn" : "good"}>{t(`risk_${risk.level}`)}</Badge>}
          foot={risk.reasons.map((r) => t(`riskr_${r.key}`, { v: r.value })).join(" · ") || t("all_good")} />
      </div>
      <Card title={t("today_at_school")}><LiveStatus studentId={st.id} /></Card>
      <GradesView db={db} studentId={st.id} />
      <AIBox title={t("ai_parent_letter")} sub={t("ai_parent_letter_sub")} button={t("generate")}
        prompt={() => `${studentSummary(db, st.id)}\n\nWrite a short, warm and respectful message from the class teacher to the parent${parent ? ` (${parent.name})` : ""}: ` +
          `what is going well, what needs attention (based only on the data), 2–3 concrete things the family can do at home, and an invitation to meet. Suitable for Telegram.`} />
    </>
  );
}
