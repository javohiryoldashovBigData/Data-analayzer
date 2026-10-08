import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import { fmtTime, minutes, nowTime, today } from "../lib/date";
import { className, gateToday } from "../lib/queries";
import { notificationText } from "../App";
import { Avatar, Badge, Card, Empty, Icon, PageHead } from "../components/ui";

/**
 * Entrance check-in. In the prototype the guard types or picks a card code; in production a tablet at the
 * gate reads the student's QR/NFC card. Every scan instantly notifies the parent.
 */
export default function Gate() {
  const { db, actions, showToast } = useStore();
  const { t, subj, fmtDate } = useI18n();
  const [code, setCode] = useState("");
  const [useClock, setUseClock] = useState(true);
  const [manualTime, setManualTime] = useState("07:50");
  const [last, setLast] = useState<{ studentId: string; type: "in" | "out"; time: string } | null>(null);
  const date = today();
  const time = useClock ? nowTime() : manualTime;

  const match = useMemo(() => {
    const q = code.trim().toLowerCase();
    if (!q) return [];
    return db.students.filter((s) => s.cardCode.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 6);
  }, [code, db.students]);

  const scan = (studentId: string) => {
    const g = gateToday(db, studentId, date);
    const type: "in" | "out" = g.in && !g.out ? "out" : "in";
    actions.gateScan(studentId, type, time);
    setLast({ studentId, type, time });
    setCode("");
  };

  const simulateMorning = () => {
    let n = 0;
    const waiting = db.students.filter((s) => !gateToday(db, s.id, date).in && !gateToday(db, s.id, date).report);
    // Everyone but two students arrives; a few are late.
    waiting.slice(0, Math.max(0, waiting.length - 2)).forEach((s, i) => {
      const tm = fmtTime(minutes("07:31") + ((i * 7) % 28) + (i % 6 === 5 ? 35 : 0));
      actions.gateScan(s.id, "in", tm);
      n++;
    });
    showToast(t("simulated_n", { n }));
  };

  const feed = db.gate.filter((g) => g.date === date).sort((a, b) => b.time.localeCompare(a.time)).slice(0, 12);
  const lastStudent = last ? db.students.find((s) => s.id === last.studentId) : null;
  const lastParent = lastStudent ? db.parents.find((p) => p.childIds.includes(lastStudent.id)) : null;
  const lastNote = lastParent ? [...db.notifications].reverse().find((n) => n.userId === lastParent.id) : null;

  return (
    <>
      <PageHead title={t("nav_gate")} sub={t("gate_sub")} right={<button className="btn" onClick={simulateMorning}><Icon name="player-play" />{t("simulate_morning")}</button>} />
      <div className="grid grid-2">
        <Card title={t("scanner")} sub={t("scanner_sub")}>
          <div className="stack">
            <div className="scanner">
              <div className="scanner-frame">
                {lastStudent ? (
                  <div className="scan-ok" key={`${last!.studentId}${last!.time}${last!.type}`} style={{ textAlign: "center", color: "#fff" }}>
                    <div style={{ fontSize: 40 }}><Icon name={last!.type === "in" ? "door-enter" : "door-exit"} /></div>
                    <div style={{ fontWeight: 700 }}>{lastStudent.name}</div>
                    <div className="small">{t(last!.type === "in" ? "checked_in" : "checked_out")} · {last!.time}</div>
                  </div>
                ) : (
                  <div style={{ textAlign: "center" }}><div style={{ fontSize: 42 }}><Icon name="qrcode" /></div><div className="small">{t("show_card")}</div></div>
                )}
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="gate-code">{t("card_or_name")}</label>
              <input id="gate-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="MK-1001"
                onKeyDown={(e) => { if (e.key === "Enter" && match[0]) scan(match[0].id); }} autoComplete="off" />
            </div>
            {match.length > 0 && (
              <div className="list">
                {match.map((s) => {
                  const g = gateToday(db, s.id, date);
                  return (
                    <div key={s.id} className="list-item">
                      <Avatar name={s.name} />
                      <div className="grow"><div style={{ fontWeight: 550 }}>{s.name}</div><div className="small muted">{s.cardCode} · {className(db, s.classId)}</div></div>
                      <button className="btn btn-primary btn-sm" onClick={() => scan(s.id)}>{g.in && !g.out ? t("check_out") : t("check_in")}</button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="row small">
              <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={useClock} onChange={(e) => setUseClock(e.target.checked)} /> {t("use_real_time")}</label>
              {!useClock && <input className="input" style={{ width: 120 }} type="time" value={manualTime} onChange={(e) => setManualTime(e.target.value)} aria-label={t("time")} />}
              <span className="muted">{t("late_after", { time: db.settings.lateAfter })}</span>
            </div>
          </div>
        </Card>

        <div className="stack" style={{ gap: 16 }}>
          <Card title={t("parent_sees")} sub={t("parent_sees_sub")}>
            {lastNote && lastParent ? (
              <div style={{ background: "var(--surface-2)", borderRadius: 16, padding: 14, maxWidth: 340 }}>
                <div className="row small muted" style={{ marginBottom: 8 }}><Icon name="brand-telegram" /> Maktab+ bot · {lastParent.name}</div>
                <div style={{ background: "var(--surface)", borderRadius: "4px 14px 14px 14px", padding: "10px 12px", boxShadow: "var(--shadow)" }}>
                  {notificationText(lastNote, t, subj, (d) => fmtDate(d))}
                  <div className="small muted" style={{ textAlign: "right" }}>{lastNote.createdAt.slice(11)}</div>
                </div>
              </div>
            ) : <Empty icon="device-mobile-message">{t("scan_to_preview")}</Empty>}
          </Card>
          <Card title={t("live_feed")} sub={t("today")}>
            {feed.length === 0 ? <Empty>{t("no_scans")}</Empty> : (
              <div className="list">
                {feed.map((g) => {
                  const s = db.students.find((x) => x.id === g.studentId)!;
                  const late = g.type === "in" && minutes(g.time) > minutes(db.settings.lateAfter);
                  return (
                    <div key={g.id} className="list-item small">
                      <span className="tnum" style={{ fontWeight: 600, width: 44 }}>{g.time}</span>
                      <div className="grow">{s.name} <span className="muted">· {className(db, s.classId)}</span></div>
                      <Badge tone={g.type === "out" ? "accent" : late ? "warn" : "good"} icon={g.type === "out" ? "door-exit" : "door-enter"}>{g.type === "out" ? t("left") : late ? t("late") : t("arrived")}</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
