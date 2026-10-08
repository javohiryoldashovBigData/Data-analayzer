import { useState } from "react";
import { useChild } from "../App";
import { useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import { addDays, PERIOD_START, today, weekStart } from "../lib/date";
import { className, lessonsOn, studentOf } from "../lib/queries";
import { Badge, Card, GradePill, Icon, PageHead } from "../components/ui";
import ChildSwitcher from "../components/ChildSwitcher";

export default function Diary() {
  const { db } = useStore();
  const { t, subj, fmtDate } = useI18n();
  const { childId } = useChild();
  const st = studentOf(db, childId);
  const [week, setWeek] = useState(weekStart(today()));
  const days = Array.from({ length: 6 }, (_, i) => addDays(week, i));

  return (
    <>
      <PageHead
        title={t("nav_diary")}
        sub={`${st.name} · ${className(db, st.classId)}`}
        right={
          <>
            <ChildSwitcher />
            <div className="row" style={{ gap: 6 }}>
              <button className="btn icon-btn" onClick={() => setWeek(addDays(week, -7))} aria-label={t("prev_week")}><Icon name="chevron-left" /></button>
              <button className="btn" onClick={() => setWeek(weekStart(today()))}>{fmtDate(week)} – {fmtDate(addDays(week, 5))}</button>
              <button className="btn icon-btn" onClick={() => setWeek(addDays(week, 7))} aria-label={t("next_week")}><Icon name="chevron-right" /></button>
            </div>
          </>
        }
      />
      <div className="grid grid-3">
        {days.map((date) => {
          const lessons = lessonsOn(db, st.classId, date);
          const isToday = date === today();
          return (
            <Card key={date} className="day-card" title={<span style={{ textTransform: "capitalize" }}>{fmtDate(date, { weekday: "long", day: "numeric", month: "short" })}</span>} right={isToday ? <Badge tone="brand">{t("today")}</Badge> : undefined}>
              {lessons.map((l) => {
                const topic = db.topics.find((x) => x.classId === st.classId && x.subjectId === l.subjectId && x.date === date);
                const hw = db.homework.find((h) => h.classId === st.classId && h.subjectId === l.subjectId && h.date === date);
                const grades = db.grades.filter((g) => g.studentId === st.id && g.subjectId === l.subjectId && g.date === date);
                const mark = db.marks.find((m) => m.studentId === st.id && m.date === date && m.lessonId === l.id);
                return (
                  <div key={l.id} className="lesson">
                    <span className="period-no">{l.period}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>
                        <span className="subject-dot" style={{ background: db.subjects.find((s) => s.id === l.subjectId)?.color }} />
                        {subj(l.subjectId)} <span className="small muted">{PERIOD_START[l.period - 1]}</span>
                      </div>
                      {topic && <div className="small muted">{topic.topic}</div>}
                      {hw && (
                        <div className="small" style={{ marginTop: 2 }}>
                          <Icon name="notebook" /> {hw.text}
                          {st.id in hw.done && (hw.done[st.id] ? <Badge tone="good" icon="check">{t("done")}</Badge> : <Badge tone="bad">{t("not_done")}</Badge>)}
                        </div>
                      )}
                      {mark && <Badge tone={mark.status === "late" ? "warn" : mark.status === "excused" ? "accent" : "bad"}>{t(`mark_${mark.status}`)}</Badge>}
                    </div>
                    <div className="row" style={{ gap: 4 }}>
                      {grades.map((g) => <GradePill key={g.id} value={g.value} small ai={g.aiSuggested} title={t(`kind_${g.kind}`)} />)}
                    </div>
                  </div>
                );
              })}
            </Card>
          );
        })}
      </div>
    </>
  );
}
