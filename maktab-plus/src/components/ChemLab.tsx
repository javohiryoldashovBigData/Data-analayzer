import { useEffect, useRef, useState } from "react";
import type { L10n } from "../data/types";
import { useI18n } from "../lib/i18n";
import { Badge, Icon, Segmented } from "./ui";

export type ExperimentId = "sodium" | "titration" | "zinc" | "copper";

interface Experiment {
  id: ExperimentId;
  name: L10n;
  equation: string;
  grade: string;
  seconds: number;
  observe: L10n[];
  safety: L10n;
}

export const EXPERIMENTS: Experiment[] = [
  {
    id: "sodium", grade: "8", seconds: 9,
    name: { uz: "Natriy + suv", ru: "Натрий + вода", en: "Sodium + water" },
    equation: "2Na + 2H₂O → 2NaOH + H₂↑",
    observe: [
      { uz: "Natriy suv yuzasida tez yuguradi va eriydi", ru: "Натрий быстро бегает по поверхности воды и плавится", en: "Sodium darts across the surface and melts into a ball" },
      { uz: "Vodorod pufakchalari ajraladi, vodorod yonishi mumkin", ru: "Выделяются пузырьки водорода, водород может загореться", en: "Hydrogen bubbles form and can ignite" },
      { uz: "Fenolftalein pushti rangga kiradi — ishqor (NaOH) hosil bo'ldi", ru: "Фенолфталеин становится малиновым — образовалась щёлочь (NaOH)", en: "Phenolphthalein turns pink — an alkali (NaOH) has formed" },
    ],
    safety: { uz: "Faqat o'qituvchi namoyish qiladi: guruch donasidek natriy, himoya oynasi va ekran bilan. Natriyni qo'l bilan ushlamang.", ru: "Только демонстрация учителем: кусочек натрия размером с рисинку, защитный экран и очки. Не трогать руками.", en: "Teacher demo only: a rice-grain-sized piece, safety screen and goggles. Never touch sodium with bare hands." },
  },
  {
    id: "titration", grade: "8–9", seconds: 0,
    name: { uz: "Neytrallanish (titrlash)", ru: "Нейтрализация (титрование)", en: "Neutralisation (titration)" },
    equation: "HCl + NaOH → NaCl + H₂O",
    observe: [
      { uz: "Boshida NaOH + fenolftalein eritmasi pushti", ru: "Сначала раствор NaOH с фенолфталеином малиновый", en: "At first the NaOH + phenolphthalein solution is pink" },
      { uz: "Kislota qo'shilgan sari pH pasayadi", ru: "По мере добавления кислоты pH снижается", en: "As acid is added the pH falls" },
      { uz: "Ekvivalent nuqtada (10 ml) eritma rangsizlanadi", ru: "В точке эквивалентности (10 мл) раствор обесцвечивается", en: "At the equivalence point (10 mL) the solution turns colourless" },
    ],
    safety: { uz: "Suyultirilgan (0,1 M) eritmalar, himoya ko'zoynagi. Kislotani og'iz bilan so'rmang — pipetka nasosidan foydalaning.", ru: "Разбавленные (0,1 М) растворы, защитные очки. Не набирать кислоту ртом — только грушей.", en: "Use dilute (0.1 M) solutions and goggles. Never pipette by mouth — use a pipette filler." },
  },
  {
    id: "zinc", grade: "8", seconds: 10,
    name: { uz: "Rux + xlorid kislota", ru: "Цинк + соляная кислота", en: "Zinc + hydrochloric acid" },
    equation: "Zn + 2HCl → ZnCl₂ + H₂↑",
    observe: [
      { uz: "Rux yuzasida gaz pufakchalari hosil bo'ladi", ru: "На поверхности цинка образуются пузырьки газа", en: "Gas bubbles form on the zinc" },
      { uz: "Gaz sharni to'ldiradi", ru: "Газ наполняет шарик", en: "The gas fills the balloon" },
      { uz: "Yonayotgan cho'p yaqinlashtirilsa “chiyillagan portlash” — bu vodorod", ru: "Горящая лучинка даёт «хлопок» — это водород", en: "A lit splint gives a squeaky pop — the test for hydrogen" },
    ],
    safety: { uz: "Suyultirilgan kislota, ochiq olovdan uzoqda. Vodorod havo bilan portlovchi aralashma hosil qiladi.", ru: "Разбавленная кислота, вдали от открытого огня. Водород с воздухом образует гремучую смесь.", en: "Use dilute acid away from open flames — hydrogen and air form an explosive mixture." },
  },
  {
    id: "copper", grade: "8", seconds: 12,
    name: { uz: "Temir + mis(II) sulfat", ru: "Железо + сульфат меди(II)", en: "Iron + copper(II) sulfate" },
    equation: "Fe + CuSO₄ → FeSO₄ + Cu",
    observe: [
      { uz: "Mix yuzasi qizil-jigarrang mis bilan qoplanadi", ru: "Гвоздь покрывается красно-бурой медью", en: "The nail becomes coated with red-brown copper" },
      { uz: "Ko'k eritma asta-sekin och yashil rangga o'tadi", ru: "Синий раствор постепенно становится бледно-зелёным", en: "The blue solution slowly fades to pale green" },
      { uz: "Temir misdan faolroq, shuning uchun uni siqib chiqaradi", ru: "Железо активнее меди и вытесняет её", en: "Iron is more reactive than copper, so it displaces it" },
    ],
    safety: { uz: "Mis sulfat zaharli — qo'lqop kiying, ishdan keyin qo'lni yuving.", ru: "Сульфат меди ядовит — работайте в перчатках, мойте руки после опыта.", en: "Copper sulfate is harmful — wear gloves and wash hands afterwards." },
  },
];

const mix = (a: [number, number, number], b: [number, number, number], k: number) =>
  `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, k)))).join(",")})`;

function Bubbles({ n, x, y, w, rate, seed = 1 }: { n: number; x: number; y: number; w: number; rate: number; seed?: number }) {
  if (rate <= 0) return null;
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const r = ((i * 9301 + seed * 49297) % 233280) / 233280;
        const dur = (1.2 + r * 1.6) / Math.max(0.3, rate);
        return <circle key={i} className="bubble" cx={x + r * w} cy={y} r={2 + r * 3} fill="rgba(255,255,255,0.75)"
          style={{ animationDuration: `${dur}s`, animationDelay: `${-r * dur}s` }} />;
      })}
    </g>
  );
}

function Beaker({ x, y, w, h, fill, level = 0.7 }: { x: number; y: number; w: number; h: number; fill: string; level?: number }) {
  const ly = y + h * (1 - level);
  return (
    <g>
      <rect x={x} y={ly} width={w} height={y + h - ly} fill={fill} opacity="0.85" />
      <path d={`M${x - 6},${y} L${x},${y} L${x},${y + h} L${x + w},${y + h} L${x + w},${y} L${x + w + 6},${y}`} fill="none" stroke="rgba(220,235,245,0.9)" strokeWidth="3" strokeLinejoin="round" />
      {[0.25, 0.5, 0.75].map((k) => <line key={k} x1={x + 4} x2={x + 16} y1={y + h * k} y2={y + h * k} stroke="rgba(220,235,245,0.5)" />)}
    </g>
  );
}

export default function ChemLab({ initial = "sodium", compact = false }: { initial?: ExperimentId; compact?: boolean }) {
  const { t, tl } = useI18n();
  const [id, setId] = useState<ExperimentId>(initial);
  const exp = EXPERIMENTS.find((e) => e.id === id)!;
  const [p, setP] = useState(0); // progress 0..1
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [acid, setAcid] = useState(0); // mL HCl for titration
  const [pop, setPop] = useState(false);
  const raf = useRef(0);

  useEffect(() => { setP(0); setRunning(false); setAcid(0); setPop(false); }, [id]);
  useEffect(() => setId(initial), [initial]);

  useEffect(() => {
    if (!running || exp.seconds === 0) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setP((v) => {
        const nv = Math.min(1, v + (dt * speed) / exp.seconds);
        if (nv >= 1) setRunning(false);
        return nv;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [running, speed, exp.seconds]);

  // titration: 10 mL of 0.1 M NaOH, adding 0.1 M HCl
  const pH = (() => {
    const base = 1.0 - acid * 0.1, acidExcess = acid * 0.1 - 1.0, vol = (10 + acid) / 1000;
    if (Math.abs(base) < 1e-6) return 7;
    if (base > 0) return 14 + Math.log10((base / 1000) / vol);
    return -Math.log10((acidExcess / 1000) / vol);
  })();
  const pinkness = id === "titration" ? Math.max(0, Math.min(1, (pH - 8.2) / 2)) : 0;

  const stage = () => {
    switch (id) {
      case "sodium": {
        const water = mix([200, 225, 245], [236, 72, 153], p < 0.15 ? 0 : (p - 0.15) * 1.4);
        const size = 14 * (1 - p * 0.85);
        return (
          <g>
            <Beaker x={200} y={90} w={200} h={200} fill={water} />
            {p > 0 && p < 0.97 && (
              <g transform={`translate(300, ${150})`}>
                <g className="zip">
                  <circle r={size} fill="#d4d4d8" stroke="#fafafa" />
                  {p > 0.35 && p < 0.8 && <path className="flame" d={`M-6,${-size} Q0,${-size - 26} 6,${-size} Z`} fill="#fbbf24" opacity="0.85" />}
                </g>
              </g>
            )}
            {p === 0 && <g><rect x={286} y={40} width={28} height={18} rx={4} fill="#d4d4d8" /><text x={300} y={30} fill="#cbd5e1" fontSize="13" textAnchor="middle">Na</text></g>}
            <Bubbles n={14} x={225} y={160} w={150} rate={p > 0 && p < 0.97 ? 1.6 : 0} />
            <text x={300} y={318} fill="#94a3b8" fontSize="12" textAnchor="middle">H₂O + {t("phenolphthalein")}</text>
          </g>
        );
      }
      case "titration": {
        const fill = mix([226, 232, 240], [236, 72, 153], pinkness);
        return (
          <g>
            {/* burette */}
            <rect x={290} y={10} width={20} height={150} fill="rgba(220,235,245,0.15)" stroke="rgba(220,235,245,0.9)" strokeWidth="2" />
            <rect x={292} y={12 + (acid / 20) * 140} width={16} height={146 - (acid / 20) * 140} fill="rgba(186,230,253,0.6)" />
            <path d="M296,160 L304,160 L301,180 L299,180 Z" fill="rgba(220,235,245,0.9)" />
            <text x={320} y={24} fill="#cbd5e1" fontSize="12">HCl 0,1 M</text>
            {/* flask */}
            <path d="M285,200 L285,230 L235,300 L365,300 L315,230 L315,200 Z" fill="none" stroke="rgba(220,235,245,0.9)" strokeWidth="3" strokeLinejoin="round" />
            <path d="M262,262 L338,262 L365,300 L235,300 Z" fill={fill} opacity="0.9" />
            <text x={300} y={322} fill="#94a3b8" fontSize="12" textAnchor="middle">NaOH 0,1 M, 10 ml + {t("phenolphthalein")}</text>
            {/* pH meter */}
            <g transform="translate(430,190)">
              <rect width={120} height={70} rx={10} fill="#0b1220" stroke="#334155" />
              <text x={60} y={26} fill="#94a3b8" fontSize="12" textAnchor="middle">pH</text>
              <text x={60} y={56} fill={pH > 8.2 ? "#f472b6" : pH < 6 ? "#fbbf24" : "#4ade80"} fontSize="26" fontWeight="700" textAnchor="middle">{pH.toFixed(2)}</text>
            </g>
          </g>
        );
      }
      case "zinc": {
        const balloon = 8 + p * 46;
        return (
          <g>
            <path d="M270,120 L270,280 Q300,310 330,280 L330,120" fill="none" stroke="rgba(220,235,245,0.9)" strokeWidth="3" />
            <path d="M271,190 L271,280 Q300,308 329,280 L329,190 Z" fill="rgba(254,249,195,0.35)" />
            {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={278 + i * 9} y={268 - (i % 2) * 6} width={10} height={9} rx={3} fill="#a1a1aa" />)}
            <Bubbles n={16} x={276} y={262} w={48} rate={p > 0 && p < 1 ? 0.7 + p : 0} seed={3} />
            <path d={`M270,120 Q300,${110 - balloon * 0.3} 330,120`} fill="none" stroke="#f87171" strokeWidth="3" />
            <ellipse cx={300} cy={112 - balloon} rx={balloon * 0.8} ry={balloon} fill="#ef4444" opacity={pop ? 0 : 0.85} />
            {pop && <g><text x={300} y={70} fill="#fde047" fontSize="30" fontWeight="800" textAnchor="middle">POP!</text><path className="flame" d="M292,100 Q300,70 308,100 Z" fill="#60a5fa" /></g>}
            <text x={300} y={322} fill="#94a3b8" fontSize="12" textAnchor="middle">Zn + HCl</text>
          </g>
        );
      }
      case "copper": {
        const sol = mix([37, 99, 235], [190, 225, 200], p * 0.9);
        const nail = mix([148, 163, 184], [180, 83, 9], p);
        return (
          <g>
            <Beaker x={210} y={110} w={180} h={180} fill={sol} />
            <rect x={292} y={60} width={16} height={210} rx={3} fill="#94a3b8" />
            <rect x={292} y={160} width={16} height={110} rx={3} fill={nail} />
            <rect x={284} y={56} width={32} height={8} rx={3} fill="#64748b" />
            <text x={300} y={318} fill="#94a3b8" fontSize="12" textAnchor="middle">CuSO₄ + Fe</text>
          </g>
        );
      }
    }
  };

  const done = exp.seconds > 0 ? p >= 1 : Math.abs(pH - 7) < 1.5 || acid >= 10;

  return (
    <div className="stack" style={{ gap: 14 }}>
      {!compact && (
        <Segmented value={id} onChange={setId} items={EXPERIMENTS.map((e) => ({ id: e.id, label: tl(e.name) }))} />
      )}
      <div className="grid grid-2" style={{ gridTemplateColumns: compact ? "1fr" : undefined }}>
        <div className="lab-stage">
          <svg viewBox="0 0 600 340" role="img" aria-label={tl(exp.name)}>{stage()}</svg>
          <div className="row" style={{ position: "absolute", left: 12, right: 12, top: 10, justifyContent: "space-between" }}>
            <span className="badge" style={{ background: "rgba(0,0,0,0.45)", color: "#e2e8f0", fontFamily: "ui-monospace, monospace" }}>{exp.equation}</span>
            {done && <Badge tone="good" icon="check">{t("reaction_done")}</Badge>}
          </div>
        </div>
        <div className="stack">
          <div className="row" style={{ gap: 8 }}>
            <h2>{tl(exp.name)}</h2><Badge>{t("grade_level", { g: exp.grade })}</Badge>
          </div>
          {exp.seconds > 0 ? (
            <div className="row">
              <button className="btn btn-primary" onClick={() => { if (p >= 1) setP(0); setPop(false); setRunning((r) => !r); }}>
                <Icon name={running ? "player-pause" : "player-play"} />{running ? t("pause") : p >= 1 ? t("replay") : p > 0 ? t("continue") : t("start_experiment")}
              </button>
              <button className="btn" onClick={() => { setP(0); setRunning(false); setPop(false); }}><Icon name="refresh" />{t("reset")}</button>
              <Segmented value={String(speed)} onChange={(v) => setSpeed(Number(v))} items={[{ id: "0.5", label: "0.5×" }, { id: "1", label: "1×" }, { id: "2", label: "2×" }]} />
              {id === "zinc" && p > 0.6 && !pop && <button className="btn" onClick={() => setPop(true)}><Icon name="flame" />{t("splint_test")}</button>}
            </div>
          ) : (
            <div className="stack">
              <label className="label" htmlFor="acid">{t("acid_added", { ml: acid.toFixed(1) })}</label>
              <input id="acid" type="range" min={0} max={20} step={0.1} value={acid} onChange={(e) => setAcid(Number(e.target.value))} />
              <div className="row">
                <button className="btn btn-sm" onClick={() => setAcid((a) => Math.min(20, +(a + 0.1).toFixed(1)))}><Icon name="droplet" />{t("add_drop")}</button>
                <button className="btn btn-sm" onClick={() => setAcid((a) => Math.min(20, +(a + 1).toFixed(1)))}>+1 ml</button>
                <button className="btn btn-sm" onClick={() => setAcid(0)}><Icon name="refresh" />{t("reset")}</button>
              </div>
            </div>
          )}
          {exp.seconds > 0 && <div className="progress"><span style={{ width: `${p * 100}%` }} /></div>}
          <div>
            <h3 style={{ marginBottom: 6 }}>{t("observations")}</h3>
            <ol style={{ margin: 0, paddingLeft: 20 }} className="small">
              {exp.observe.map((o, i) => {
                const shown = exp.seconds === 0 ? (i === 0 || (i === 1 && acid > 0) || (i === 2 && acid >= 10)) : p >= (i + 1) / (exp.observe.length + 1);
                return <li key={i} style={{ opacity: shown ? 1 : 0.35, marginBottom: 4 }}>{tl(o)}</li>;
              })}
            </ol>
          </div>
          <div className="callout callout-warn small"><Icon name="alert-triangle" /><div><b>{t("safety")}:</b> {tl(exp.safety)}</div></div>
        </div>
      </div>
    </div>
  );
}
