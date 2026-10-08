import { useState } from "react";
import { useStore } from "../lib/store";
import { LANGS, useI18n } from "../lib/i18n";
import type { Lang, Role } from "../data/types";
import { Icon } from "../components/ui";

const ROLE_STYLE: Record<Role, { icon: string; color: string }> = {
  director: { icon: "building-community", color: "#7c3aed" },
  teacher: { icon: "school", color: "#0f766e" },
  student: { icon: "backpack", color: "#2a78d6" },
  parent: { icon: "heart-handshake", color: "#d8662f" },
};

export default function Login() {
  const { db, login } = useStore();
  const { t, lang, setLang } = useI18n();
  const [teacherId, setTeacherId] = useState("t1");
  const [studentId, setStudentId] = useState(db.students[0].id);
  const [parentId, setParentId] = useState(db.parents[0].id);

  const people: Record<Role, { value: string; set: (v: string) => void; options: { id: string; label: string }[] } | null> = {
    director: null,
    teacher: { value: teacherId, set: setTeacherId, options: db.teachers.map((x) => ({ id: x.id, label: x.name })) },
    student: { value: studentId, set: setStudentId, options: db.students.map((s) => ({ id: s.id, label: `${s.name} · ${db.classes.find((c) => c.id === s.classId)?.name}` })) },
    parent: { value: parentId, set: setParentId, options: db.parents.map((p) => ({ id: p.id, label: p.name })) },
  };
  const ids: Record<Role, string> = { director: "d1", teacher: teacherId, student: studentId, parent: parentId };

  return (
    <div className="login">
      <div className="login-box">
        <div className="row between">
          <div className="row">
            <span className="brand-logo" style={{ width: 46, height: 46, fontSize: 20 }}>M+</span>
            <div>
              <h1 style={{ fontSize: 26 }}>Maktab+</h1>
              <p className="muted">{t("tagline")}</p>
            </div>
          </div>
          <select className="select" value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t("language")}>
            {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>

        <div className="callout callout-info">
          <Icon name="info-circle" />
          <div><b>{t("demo_title")}</b> {t("demo_text", { school: db.schoolName })}</div>
        </div>

        <div className="grid grid-4">
          {(Object.keys(ROLE_STYLE) as Role[]).map((role) => {
            const st = ROLE_STYLE[role];
            const p = people[role];
            return (
              <div key={role} className="card role-card">
                <span className="role-icon" style={{ background: `color-mix(in srgb, ${st.color} 14%, transparent)`, color: st.color }}><Icon name={st.icon} /></span>
                <div>
                  <h2>{t(`role_${role}`)}</h2>
                  <p className="small muted" style={{ marginTop: 4, minHeight: 60 }}>{t(`role_${role}_desc`)}</p>
                </div>
                {p ? (
                  <select className="select" style={{ width: "100%" }} value={p.value} onChange={(e) => p.set(e.target.value)} aria-label={t(`role_${role}`)}>
                    {p.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                ) : (
                  <div className="input" style={{ background: "var(--surface-2)" }}>Shavkat Mirzayev</div>
                )}
                <button className="btn btn-primary" onClick={() => login({ role, id: ids[role] })}>
                  {t("enter")} <Icon name="arrow-right" />
                </button>
              </div>
            );
          })}
        </div>
        <p className="small muted" style={{ textAlign: "center" }}>{t("login_footer")}</p>
      </div>
    </div>
  );
}
