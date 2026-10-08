import { useEffect, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";

export function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <i className={`ti ti-${name} ${className}`} aria-hidden="true" />;
}

export function Card({ title, sub, right, children, className = "" }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {right && <div className="right">{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {right && <div className="right">{right}</div>}
    </div>
  );
}

export function Stat({ label, value, foot, icon }: { label: ReactNode; value: ReactNode; foot?: ReactNode; icon?: string }) {
  return (
    <div className="card stat">
      <span className="stat-label">{icon && <Icon name={icon} />}{label}</span>
      <span className="stat-value">{value}</span>
      {foot && <span className="stat-foot">{foot}</span>}
    </div>
  );
}

export function Badge({ tone = "", icon, children }: { tone?: "" | "good" | "warn" | "bad" | "brand" | "accent"; icon?: string; children: ReactNode }) {
  return <span className={`badge ${tone ? `badge-${tone}` : ""}`}>{icon && <Icon name={icon} />}{children}</span>;
}

export function GradePill({ value, small, ai, title }: { value: number; small?: boolean; ai?: boolean; title?: string }) {
  const v = Math.max(2, Math.min(5, Math.round(value)));
  return <span className={`grade grade-${v} ${small ? "grade-sm" : ""} ${ai ? "ai" : ""}`} title={title}>{value % 1 ? value.toFixed(1) : value}</span>;
}

export function Avatar({ name, large }: { name: string; large?: boolean }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return <span className={`avatar ${large ? "avatar-lg" : ""}`}>{initials}</span>;
}

export function Empty({ icon = "mood-empty", children }: { icon?: string; children: ReactNode }) {
  return <div className="empty"><Icon name={icon} />{children}</div>;
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" style={wide ? { width: "min(760px, 100%)" } : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label={t("close")}><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode; icon?: string }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button key={it.id} role="tab" aria-selected={value === it.id} className={`tab ${value === it.id ? "active" : ""}`} onClick={() => onChange(it.id)}>
          {it.icon && <Icon name={it.icon} />}{it.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[] }) {
  return (
    <div className="seg">
      {items.map((it) => (
        <button key={it.id} className={value === it.id ? "active" : ""} onClick={() => onChange(it.id)}>{it.label}</button>
      ))}
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return <div className="progress"><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

/** Minimal, safe Markdown renderer for AI output (no raw HTML is ever injected). */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,3})\s+(.*)/);
    const ul = line.match(/^\s*[-*•]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (h) { flush(); const L = `h${h[1].length}` as "h1" | "h2" | "h3"; blocks.push(<L key={blocks.length}>{inline(h[2])}</L>); }
    else if (ul) { if (!list || list.ordered) { flush(); list = { ordered: false, items: [] }; } list.items.push(ul[1]); }
    else if (ol) { if (!list || !list.ordered) { flush(); list = { ordered: true, items: [] }; } list.items.push(ol[1]); }
    else if (!line.trim()) flush();
    else { flush(); blocks.push(<p key={blocks.length}>{inline(line)}</p>); }
  }
  flush();
  return <div className="md">{blocks}</div>;
}

function inline(s: string): ReactNode[] {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
    return p;
  });
}
