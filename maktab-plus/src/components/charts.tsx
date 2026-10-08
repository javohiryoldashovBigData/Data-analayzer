import { useState } from "react";

/** Horizontal bars, one hue; value labels in text ink. */
export function BarList({ items, max = 5, format = (v: number) => v.toFixed(1) }: {
  items: { label: string; value: number | null; hint?: string }[];
  max?: number;
  format?: (v: number) => string;
}) {
  return (
    <div className="stack" style={{ gap: 9 }}>
      {items.map((it) => (
        <div key={it.label} title={it.hint} style={{ display: "grid", gridTemplateColumns: "minmax(90px, 140px) 1fr 40px", gap: 10, alignItems: "center" }}>
          <span className="small ellipsis" style={{ color: "var(--text-2)" }}>{it.label}</span>
          <div style={{ height: 10, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
            {it.value != null && (
              <div style={{ width: `${(it.value / max) * 100}%`, height: "100%", background: "var(--accent)", borderRadius: "0 4px 4px 0" }} />
            )}
          </div>
          <span className="small tnum" style={{ textAlign: "right", fontWeight: 600 }}>{it.value == null ? "—" : format(it.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Single-series line chart with a crosshair tooltip. */
export function LineChart({ points, min = 2, max = 5, height = 180, format = (v: number) => v.toFixed(2) }: {
  points: { label: string; value: number }[];
  min?: number;
  max?: number;
  height?: number;
  format?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = height, pl = 30, pr = 10, pt = 10, pb = 24;
  if (points.length < 2) return <div className="empty small">—</div>;
  const x = (i: number) => pl + (i / (points.length - 1)) * (W - pl - pr);
  const y = (v: number) => pt + (1 - (v - min) / (max - min)) * (H - pt - pb);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const ticks = [];
  for (let v = min; v <= max; v += max - min <= 5 ? 1 : (max - min) / 4) ticks.push(v);
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - pl) / (W - pl - pr)) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pl} x2={W - pr} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
            <text x={pl - 8} y={y(v) + 4} fontSize="11" textAnchor="end" fill="var(--muted)">{Number.isInteger(v) ? v : v.toFixed(0)}</text>
          </g>
        ))}
        {points.map((p, i) => (i % Math.ceil(points.length / 6) === 0 || i === points.length - 1) && (
          <text key={i} x={x(i)} y={H - 6} fontSize="11" textAnchor="middle" fill="var(--muted)">{p.label}</text>
        ))}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pt} y2={H - pb} stroke="var(--muted)" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(points[hover].value)} r="5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
          </>
        )}
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(points[hover].value) / H) * 100}%` }}>
          {points[hover].label}: <b>{format(points[hover].value)}</b>
        </div>
      )}
    </div>
  );
}

/** Distribution of grades 2–5 as a compact stacked bar with a legend. */
export function GradeDistribution({ counts }: { counts: Record<number, number> }) {
  const total = [5, 4, 3, 2].reduce((s, g) => s + (counts[g] ?? 0), 0) || 1;
  const color: Record<number, string> = { 5: "#0c8f0c", 4: "#2a78d6", 3: "#c98a00", 2: "#d03b3b" };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div style={{ display: "flex", height: 14, borderRadius: 4, overflow: "hidden", gap: 2 }}>
        {[5, 4, 3, 2].map((g) => (counts[g] ?? 0) > 0 && (
          <div key={g} title={`${g}: ${counts[g]}`} style={{ width: `${((counts[g] ?? 0) / total) * 100}%`, background: color[g] }} />
        ))}
      </div>
      <div className="row small" style={{ gap: 14 }}>
        {[5, 4, 3, 2].map((g) => (
          <span key={g} className="row" style={{ gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: color[g] }} />
            <b>{g}</b> <span className="muted tnum">{counts[g] ?? 0} ({Math.round(((counts[g] ?? 0) / total) * 100)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}
