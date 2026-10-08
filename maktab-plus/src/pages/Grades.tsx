import { useChild } from "../App";
import { useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import { className, studentOf } from "../lib/queries";
import { weekStart } from "../lib/date";
import { avg, forecast, gradesOf, round1, trendPerWeek } from "../ai/insights";
import { Badge, Card, GradePill, PageHead } from "../components/ui";
import { GradeDistribution, LineChart } from "../components/charts";
import ChildSwitcher from "../components/ChildSwitcher";

export default function Grades() {
  const { db } = useStore();
  const { childId } = useChild();
  return <GradesView db={db} studentId={childId} withSwitcher />;
}

/** Grades overview for one student; also used on the teacher's student profile. */
export function GradesView({ db, studentId, withSwitcher }: { db: ReturnType<typeof useStore>["db"]; studentId: string; withSwitcher?: boolean }) {
  const { t, subj, fmtDate } = useI18n();
  const st = studentOf(db, studentId);
  const all = gradesOf(db, st.id);
  const counts: Record<number, number> = {};
  all.forEach((g) => { counts[g.value] = (counts[g.value] ?? 0) + 1; });

  // weekly average trend
  const byWeek = new Map<string, number[]>();
  all.forEach((g) => {
    const key = weekStart(g.date);
    byWeek.set(key, [...(byWeek.get(key) ?? []), g.value]);
  });
  const trend = [...byWeek.entries()].sort().map(([k, v]) => ({ label: fmtDate(k), value: avg(v)! }));

  const rows = db.subjects
    .map((s) => {
      const gs = gradesOf(db, st.id, s.id);
      return { s, gs, a: avg(gs.map((g) => g.value)), f: forecast(db, st.id, s.id), slope: trendPerWeek(gs) };
    })
    .filter((r) => r.gs.length);

  return (
    <>
      {withSwitcher && <PageHead title={t("nav_grades")} sub={`${st.name} · ${className(db, st.classId)}`} right={<ChildSwitcher />} />}
      <div className="grid grid-2">
        <Card title={t("avg_trend")} sub={t("avg_trend_sub")}><LineChart points={trend} /></Card>
        <Card title={t("grade_distribution")} sub={t("grades_total", { n: all.length })}><GradeDistribution counts={counts} /></Card>
      </div>
      <Card title={t("by_subject")} sub={t("forecast_explain")}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="sticky-col">{t("subject")}</th>
                <th>{t("grades")}</th>
                <th className="center">{t("average")}</th>
                <th className="center">{t("trend")}</th>
                <th className="center"><span className="ai-chip">AI</span> {t("forecast")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, gs, a, f, slope }) => (
                <tr key={s.id}>
                  <td className="sticky-col" style={{ fontWeight: 550 }}><span className="subject-dot" style={{ background: s.color }} />{subj(s.id)}</td>
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                      {gs.slice(-12).map((g) => <GradePill key={g.id} value={g.value} small ai={g.aiSuggested} title={`${fmtDate(g.date)} · ${t(`kind_${g.kind}`)}`} />)}
                    </div>
                  </td>
                  <td className="center tnum" style={{ fontWeight: 650 }}>{round1(a)}</td>
                  <td className="center">
                    {slope > 0.05 ? <Badge tone="good" icon="trending-up">{t("up")}</Badge> : slope < -0.05 ? <Badge tone="bad" icon="trending-down">{t("down")}</Badge> : <Badge icon="minus">{t("stable")}</Badge>}
                  </td>
                  <td className="center">{f != null && <GradePill value={Math.round(f)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
