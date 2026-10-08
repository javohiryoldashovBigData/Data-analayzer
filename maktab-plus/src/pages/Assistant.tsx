import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useChild } from "../App";
import { useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import { streamText, systemPrompt } from "../ai/claude";
import { buildContext } from "../ai/context";
import { attendanceStats, homeworkRate, studentAverage, studentRisk, gradesOf, avg, trendPerWeek } from "../ai/insights";
import { useAIErrorText } from "../components/AIBox";
import { studentOf } from "../lib/queries";
import { Card, Icon, Markdown, PageHead } from "../components/ui";
import ChildSwitcher from "../components/ChildSwitcher";
import type { Role } from "../data/types";

interface Msg { role: "user" | "assistant"; content: string; offline?: boolean }

const QUICK: Record<Role, string[]> = {
  student: ["q_student_weak", "q_student_explain", "q_student_plan", "q_student_practice"],
  parent: ["q_parent_report", "q_parent_help", "q_parent_attendance", "q_parent_talk"],
  teacher: ["q_teacher_class", "q_teacher_letter", "q_teacher_ideas", "q_teacher_weak"],
  director: ["q_director_report", "q_director_risk", "q_director_attendance", "q_director_actions"],
};

export default function Assistant() {
  const { db, session } = useStore();
  const { t, lang, subj } = useI18n();
  const { childId } = useChild();
  const errText = useAIErrorText();
  const role = session!.role;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const hasKey = !!db.settings.apiKey;
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs]);
  useEffect(() => { setMsgs([]); }, [childId]);

  /** Offline answer from local analytics, used when no AI key is connected. */
  const offlineAnswer = (): string => {
    if (role === "student" || role === "parent") {
      const sid = role === "student" ? session!.id : childId;
      const st = studentOf(db, sid);
      const rows = db.subjects.map((s) => ({ s: s.id, gs: gradesOf(db, sid, s.id) })).filter((r) => r.gs.length)
        .map((r) => ({ ...r, a: avg(r.gs.map((g) => g.value))!, tr: trendPerWeek(r.gs) }));
      const weak = [...rows].sort((a, b) => a.a - b.a).slice(0, 3);
      const strong = [...rows].sort((a, b) => b.a - a.a).slice(0, 3);
      const att = attendanceStats(db, sid);
      const risk = studentRisk(db, sid);
      return `## ${t("offline_report_title", { name: st.name })}\n` +
        `- ${t("avg_grade")}: **${studentAverage(db, sid)?.toFixed(1)}**\n- ${t("attendance_30")}: **${att.rate}%** (${t("late_n", { n: att.late })})\n- ${t("homework_done")}: **${homeworkRate(db, sid) ?? "—"}%**\n- ${t("ai_risk")}: **${t(`risk_${risk.level}`)}**\n\n` +
        `### ${t("strong_subjects")}\n${strong.map((r) => `- ${subj(r.s)} — ${r.a.toFixed(1)}`).join("\n")}\n\n### ${t("needs_attention")}\n` +
        weak.map((r) => `- ${subj(r.s)} — ${r.a.toFixed(1)}${r.tr < -0.05 ? ` (${t("down")})` : ""}`).join("\n") +
        `\n\n### ${t("advice")}\n- ${t("advice_1", { subject: subj(weak[0]?.s ?? "math") })}\n- ${t("advice_2")}\n- ${t("advice_3")}`;
    }
    return t("offline_generic");
  };

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const history = msgs.filter((m) => !m.offline).map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setInput("");
    if (!hasKey) {
      setMsgs((m) => [...m, { role: "assistant", content: offlineAnswer(), offline: true }]);
      return;
    }
    setBusy(true);
    setMsgs((m) => [...m, { role: "assistant", content: "" }]);
    const roleRules: Record<Role, string> = {
      student: "You are this student's personal tutor. Teach and explain step by step, ask a guiding question, and give practice tasks. Do not simply hand over finished homework answers; help them get there.",
      parent: "You help a parent understand their child's progress and how to support them at home. Be encouraging and concrete.",
      teacher: "You are a teaching assistant. Help with analysis of classes, lesson ideas, differentiated tasks and messages to parents.",
      director: "You help the school director with school-level analysis, reports and decisions.",
    };
    try {
      await streamText({
        apiKey: db.settings.apiKey,
        system: systemPrompt(lang, role, `${roleRules[role]}\n\n<school_data>\n${buildContext(db, session!, role === "parent" ? childId : undefined)}\n</school_data>`),
        history,
        content: text,
        onText: (_d, full) => setMsgs((m) => [...m.slice(0, -1), { role: "assistant", content: full }]),
      });
    } catch (e) {
      setMsgs((m) => [...m.slice(0, -1), { role: "assistant", content: `⚠️ ${errText(e)}`, offline: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title={role === "student" ? t("nav_tutor") : t("nav_assistant")} sub={t(`assistant_sub_${role}`)} right={<ChildSwitcher />} />
      {!hasKey && (
        <div className="callout callout-info small"><Icon name="key" /><div>{t("assistant_offline")} <Link to="/settings">{t("nav_settings")} →</Link></div></div>
      )}
      <Card>
        <div className="stack" style={{ minHeight: 320 }}>
          {msgs.length === 0 && (
            <div className="stack" style={{ alignItems: "center", textAlign: "center", padding: "20px 0" }}>
              <span className="brand-logo" style={{ width: 52, height: 52, background: "linear-gradient(135deg,#0f766e,#2a78d6)" }}><Icon name="sparkles" /></span>
              <h2>{t("assistant_hello")}</h2>
              <p className="muted small" style={{ maxWidth: 480 }}>{t(`assistant_intro_${role}`)}</p>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%" }}>
              <div style={{
                background: m.role === "user" ? "var(--brand)" : "var(--surface-2)", color: m.role === "user" ? "#fff" : "var(--text)",
                padding: "10px 14px", borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
              }}>
                {m.role === "user" ? m.content : m.content ? <Markdown text={m.content} /> : <span className="muted"><Icon name="dots" /> {t("thinking")}</span>}
              </div>
              {m.offline && m.role === "assistant" && <div className="small muted" style={{ marginTop: 3 }}><Icon name="cpu" /> {t("offline_result")}</div>}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <div className="row" style={{ marginTop: 14, gap: 6 }}>
          {QUICK[role].map((k) => <button key={k} className="btn btn-sm" onClick={() => send(t(k))} disabled={busy}>{t(k)}</button>)}
        </div>
        <form className="row" style={{ marginTop: 10, flexWrap: "nowrap" }} onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("ask_anything")} aria-label={t("ask_anything")} />
          <button className="btn btn-ai" type="submit" disabled={busy || !input.trim()}><Icon name="send" /></button>
        </form>
      </Card>
      <p className="small muted"><Icon name="shield-lock" /> {t(`assistant_privacy_${role === "director" ? "director" : "default"}`)}</p>
    </>
  );
}
