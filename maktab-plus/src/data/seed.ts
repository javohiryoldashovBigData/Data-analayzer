import type {
  DB, Grade, GradeKind, Homework, Lesson, LessonMark, LessonTopic, GateEvent, Parent, SchoolClass,
  Student, Subject, Teacher, TestAttempt, WeeklyTest, AppNotification, AbsenceReport,
} from "./types";
import { QUESTION_BANK, allBankQuestions } from "./questions";
import { addDays, fmtTime, minutes, PERIOD_LEN, PERIOD_START, schoolYearStart, today, weekStart, weekday, daysBetween } from "../lib/date";

export const DB_VERSION = 4;

/** Small deterministic PRNG so every fresh demo looks the same. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SUBJECTS: Subject[] = [
  { id: "math", name: { uz: "Matematika", ru: "Математика", en: "Mathematics" }, color: "#2563eb", icon: "math-function" },
  { id: "uzlang", name: { uz: "Ona tili", ru: "Родной язык", en: "Uzbek language" }, color: "#0d9488", icon: "language" },
  { id: "lit", name: { uz: "Adabiyot", ru: "Литература", en: "Literature" }, color: "#9333ea", icon: "book" },
  { id: "eng", name: { uz: "Ingliz tili", ru: "Английский язык", en: "English" }, color: "#dc2626", icon: "abc" },
  { id: "rus", name: { uz: "Rus tili", ru: "Русский язык", en: "Russian" }, color: "#ea580c", icon: "letter-r" },
  { id: "phys", name: { uz: "Fizika", ru: "Физика", en: "Physics" }, color: "#0891b2", icon: "atom" },
  { id: "chem", name: { uz: "Kimyo", ru: "Химия", en: "Chemistry" }, color: "#16a34a", icon: "flask" },
  { id: "bio", name: { uz: "Biologiya", ru: "Биология", en: "Biology" }, color: "#65a30d", icon: "plant" },
  { id: "hist", name: { uz: "Tarix", ru: "История", en: "History" }, color: "#a16207", icon: "building-castle" },
  { id: "geo", name: { uz: "Geografiya", ru: "География", en: "Geography" }, color: "#0369a1", icon: "world" },
  { id: "it", name: { uz: "Informatika", ru: "Информатика", en: "Computer science" }, color: "#4f46e5", icon: "device-laptop" },
  { id: "pe", name: { uz: "Jismoniy tarbiya", ru: "Физкультура", en: "Physical education" }, color: "#db2777", icon: "ball-football" },
];

const TEACHERS: Teacher[] = [
  { id: "t1", name: "Aziza Karimova", subjectIds: ["math"], homeroomClassId: "c8a" },
  { id: "t2", name: "Rustam Holiqov", subjectIds: ["chem", "bio"], homeroomClassId: "c9b" },
  { id: "t3", name: "Dilfuza Ahmedova", subjectIds: ["uzlang", "lit"], homeroomClassId: "c7a" },
  { id: "t4", name: "Kamola Rasulova", subjectIds: ["eng"] },
  { id: "t5", name: "Elena Petrova", subjectIds: ["rus"] },
  { id: "t6", name: "Bahodir Usmonov", subjectIds: ["phys", "it"] },
  { id: "t7", name: "Nodira Saidova", subjectIds: ["hist", "geo"] },
  { id: "t8", name: "Sherzod Qosimov", subjectIds: ["pe"] },
];

const CLASSES: SchoolClass[] = [
  { id: "c7a", name: "7-A", homeroomTeacherId: "t3" },
  { id: "c8a", name: "8-A", homeroomTeacherId: "t1" },
  { id: "c9b", name: "9-B", homeroomTeacherId: "t2" },
];

const WEEKLY_HOURS: Record<string, number> = {
  math: 5, uzlang: 3, lit: 2, eng: 3, rus: 2, phys: 2, chem: 2, bio: 2, hist: 2, geo: 2, it: 1, pe: 2,
};
const PERIODS_PER_DAY = [5, 5, 5, 5, 4, 4];

const ROOMS: Record<string, string> = {
  chem: "204", bio: "205", phys: "301", it: "302", pe: "Sport zal", eng: "112", rus: "113",
};

/** [name, ability, homework habit] — ability is the student's typical grade level. */
const ROSTER: Record<string, [string, number, number][]> = {
  c8a: [
    ["Sardor Rahimov", 4.0, 0.9],
    ["Madina Yusupova", 4.75, 0.98],
    ["Bekzod Tursunov", 3.0, 0.45],
    ["Jasur Aliyev", 3.3, 0.7],
    ["Otabek Karimov", 2.9, 0.55],
    ["Nilufar Rashidova", 3.9, 0.85],
    ["Dilnoza Abdullayeva", 4.4, 0.95],
    ["Shohruh Ergashev", 3.6, 0.75],
    ["Zarina Usmonova", 4.2, 0.9],
    ["Akmal Nazarov", 3.5, 0.7],
  ],
  c7a: [
    ["Ulug'bek Qodirov", 4.1, 0.85], ["Sevara Ismoilova", 4.6, 0.95], ["Islom Sobirov", 3.2, 0.6],
    ["Malika Hasanova", 4.3, 0.9], ["Doniyor Xolmatov", 3.4, 0.65], ["Gulnoza Saidova", 3.9, 0.85],
    ["Bobur Mirzayev", 3.0, 0.5], ["Kamola Tojiyeva", 4.5, 0.95], ["Temur Jo'rayev", 3.7, 0.75],
    ["Feruza Normatova", 4.0, 0.85],
  ],
  c9b: [
    ["Asadbek Raximov", 4.2, 0.85], ["Shahzoda Mirzayeva", 4.7, 0.95], ["Sanjar Olimov", 3.1, 0.55],
    ["Munisa Qurbonova", 4.0, 0.9], ["Javlon Ibragimov", 3.5, 0.7], ["Lola Xasanova", 3.8, 0.8],
    ["Firdavs Sultonov", 2.9, 0.45], ["Mohinur Azimova", 4.4, 0.9], ["Behruz Yo'ldoshev", 3.6, 0.7],
    ["Sabina Karimova", 4.1, 0.85],
  ],
};

const FATHER_NAMES = ["Dilshod", "Bahrom", "Anvar", "Rustam", "Farhod", "Alisher", "Ravshan", "Shuhrat", "Ulug'bek", "Sherzod", "Jamshid", "Kamol", "Murod", "Nodir", "Olim"];
const MOTHER_NAMES = ["Gulnora", "Dilorom", "Mavluda", "Nargiza", "Feruza", "Shahnoza", "Zulfiya", "Barno", "Muqaddas", "Yulduz"];

const TOPICS: Record<string, string[]> = {
  math: ["Natural sonlar ustida amallar", "Darajalar va ularning xossalari", "Birhadlar", "Ko'phadlar", "Qisqa ko'paytirish formulalari", "Chiziqli tenglamalar", "Tenglamalar sistemasi", "Chiziqli funksiya va grafigi", "Kvadrat tenglamalar", "Masalalar yechish", "Nazorat ishi tahlili", "Tengsizliklar"],
  chem: ["Kimyoviy elementlar va belgilari", "Atom tuzilishi", "Ishqoriy metallar", "Natriyning suv bilan reaksiyasi", "Kislotalar va asoslar", "Indikatorlar", "Neytrallanish reaksiyasi", "Metallarning faollik qatori", "Tuzlar", "Laboratoriya ishi: titrlash"],
  phys: ["Mexanik harakat", "Tezlik va yo'l", "Massa va zichlik", "Kuch. Nyuton qonunlari", "Bosim", "Ish va energiya", "Elektr toki", "Om qonuni"],
  bio: ["Hujayra tuzilishi", "Fotosintez", "O'simliklar nafas olishi", "Hayvonlar tasnifi", "Odam skeleti", "Qon aylanish tizimi"],
  uzlang: ["So'z turkumlari", "Ot va uning grammatik belgilari", "Sifat", "Fe'l zamonlari", "Gap bo'laklari", "Qo'shma gaplar", "Imlo qoidalari"],
  lit: ["Alisher Navoiy hayoti", "\"Farhod va Shirin\" dostoni", "Abdulla Qodiriy ijodi", "\"O'tkan kunlar\" romani", "She'r tahlili", "Erkin Vohidov she'riyati"],
  eng: ["Present Simple", "Present Continuous", "Past Simple", "Vocabulary: Family", "Reading: My school", "Future forms", "Comparatives", "Writing a letter"],
  rus: ["Имя существительное", "Падежи", "Глагол", "Прилагательное", "Чтение текста", "Диктант"],
  hist: ["Qadimgi Turon", "Amir Temur davlati", "Temuriylar davri madaniyati", "Buxoro amirligi", "Mustaqillik davri"],
  geo: ["Xarita va masshtab", "Litosfera", "Atmosfera", "O'zbekiston relyefi", "Iqlim mintaqalari"],
  it: ["Algoritm tushunchasi", "Blok-sxemalar", "Python: o'zgaruvchilar", "Python: shartlar", "Python: sikllar"],
  pe: ["Yugurish texnikasi", "Voleybol", "Basketbol", "Gimnastika", "Futbol"],
};

const HOMEWORK: Record<string, string[]> = {
  math: ["§{n}, 1–6-misollar", "Darslikdagi {n}-mashq", "{n}-mavzu bo'yicha 5 ta masala", "Nazorat savollariga javob"],
  chem: ["§{n}ni o'qish, reaksiya tenglamalarini yozish", "{n}-mashq, 3 ta masala", "Laboratoriya hisobotini tugatish"],
  phys: ["§{n}, savollarga javob", "{n}-mashq (2–4 masalalar)", "Formulalar jadvalini tuzish"],
  bio: ["§{n}ni o'qish va rasm chizish", "Atamalar lug'atini to'ldirish"],
  uzlang: ["{n}-mashq", "Matn bo'yicha 10 ta gap tuzish", "Imlo lug'atidan 20 so'z"],
  lit: ["Asardan parcha yodlash", "Qahramon tavsifini yozish", "{n}-betgacha o'qish"],
  eng: ["Workbook p.{n}", "Learn 15 new words", "Write 8 sentences in {n}-unit tense"],
  rus: ["Упр. {n}", "Выучить правило на стр. {n}"],
  hist: ["§{n}, xronologik jadval", "Xaritani to'ldirish"],
  geo: ["§{n}, kontur xarita", "Savollarga javob"],
  it: ["Blok-sxema chizish", "Python dasturini yozish ({n}-topshiriq)"],
  pe: ["Ertalabki badantarbiya"],
};

/** Sample short answers are assembled from parts so that every student's wording differs, as in a real class. */
const SHORT_PARTS: Record<string, { good: [string[], string[], string[]]; extra: string; bad: string[] }> = {
  "chem-5": {
    good: [
      ["Natriy juda faol metall,", "Chunki natriy aktiv,", "Sababi natriy tez oksidlanadi va", "Natriy havoda turolmaydi,"],
      ["havodagi kislorod bilan", "havo namligi bilan", "suv bug'i va kislorod bilan"],
      ["reaksiyaga kirishadi, kerosin uni havodan ajratadi.", "tez reaksiyaga kirishib ketadi, shuning uchun kerosinda turadi.", "reaksiya beradi; kerosin havoni o'tkazmaydi."],
    ],
    extra: "Kerosin ichida u suv va havoga tegmaydi, aks holda darhol oksidlanib, ishqor hosil qilardi.",
    bad: ["Yonib ketmasligi uchun", "Bilmayman", "Chunki og'ir", "Sovuq turishi kerak"],
  },
  "chem-6": {
    good: [
      ["Kislota ishqorni neytrallaydi,", "Ishqor kislota bilan tugaydi,", "Neytrallanish bo'ladi:"],
      ["muhit neytral bo'lib pH pasayadi,", "pH 8 dan pastga tushadi,", "eritmada ishqor qolmaydi,"],
      ["shuning uchun fenolftalein rangsiz bo'ladi.", "fenolftalein esa faqat ishqorda pushti.", "indikator rangini yo'qotadi."],
    ],
    extra: "Oxirgi tomchidan keyin OH⁻ ionlari qolmaydi, indikator faqat ishqoriy muhitda bo'yalgani uchun rang yo'qoladi.",
    bad: ["Rangi o'chadi", "Kislota rangni yo'qotadi", "Bilmadim", "Suv qo'shilgani uchun"],
  },
};

function shortAnswer(qid: string, good: boolean, i: number): string {
  const p = SHORT_PARTS[qid];
  if (!good) return p.bad[i % p.bad.length];
  // Latin-square choice: any two of the first nine combinations share at most one part.
  if (i % 10 === 9) return p.extra;
  const k = (i % 10) % 9, a = k % 3, b = Math.floor(k / 3);
  return `${p.good[0][a]} ${p.good[1][b]} ${p.good[2][(a + b) % 3]}`;
}

export function createSeed(anchor = today()): DB {
  const rnd = mulberry32(20260902);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  let counter = 0;
  const id = (p: string) => `${p}${(++counter).toString(36)}`;

  // ---------- people ----------
  const students: Student[] = [];
  const parents: Parent[] = [];
  const ability: Record<string, number> = {};
  const habit: Record<string, number> = {};
  const affinity: Record<string, Record<string, number>> = {};
  let n = 0;
  // 8-A first, so the demo student (Sardor) and demo parent are s1 / p1.
  for (const cls of ["c8a", "c7a", "c9b"].map((cid) => CLASSES.find((c) => c.id === cid)!)) {
    for (const [name, ab, hw] of ROSTER[cls.id]) {
      n++;
      const sid = `s${n}`;
      const pid = `p${n}`;
      const surname = name.split(" ")[1];
      const parentFirst = rnd() < 0.6 ? pick(FATHER_NAMES) : pick(MOTHER_NAMES);
      const parentSurname = MOTHER_NAMES.includes(parentFirst) && /ov$|ev$/.test(surname) ? surname + "a" : surname;
      students.push({ id: sid, name, classId: cls.id, parentId: pid, cardCode: `MK-${String(1000 + n)}` });
      parents.push({
        id: pid,
        name: `${parentFirst} ${parentSurname}`,
        phone: `+998 9${Math.floor(rnd() * 10)} ${100 + Math.floor(rnd() * 899)}-${10 + Math.floor(rnd() * 89)}-${10 + Math.floor(rnd() * 89)}`,
        childIds: [sid],
        channels: { app: true, telegram: rnd() < 0.8, sms: rnd() < 0.3 },
      });
      ability[sid] = ab;
      habit[sid] = hw;
      affinity[sid] = Object.fromEntries(SUBJECTS.map((s) => [s.id, (rnd() - 0.5) * 0.8]));
    }
  }
  // Demo parent has two children (8-A and 7-A) to show the multi-child view.
  const demoParent = parents[0];
  const sibling = students.find((s) => s.name.startsWith("Temur"))!;
  sibling.parentId = demoParent.id;
  sibling.name = "Temur Rahimov";
  demoParent.childIds.push(sibling.id);
  demoParent.name = "Dilshod Rahimov";
  demoParent.channels = { app: true, telegram: true, sms: false };
  parents.splice(parents.findIndex((p) => p.childIds[0] === sibling.id && p.id !== demoParent.id), 1);

  // ---------- timetable ----------
  const lessons: Lesson[] = [];
  const busy = new Set<string>(); // teacherId|day|period
  const teacherFor = (subjectId: string) => TEACHERS.find((t) => t.subjectIds.includes(subjectId))!;
  for (const cls of CLASSES) {
    const bag: string[] = [];
    for (const [sub, h] of Object.entries(WEEKLY_HOURS)) for (let i = 0; i < h; i++) bag.push(sub);
    for (let day = 1; day <= 6; day++) {
      const dayList: string[] = [];
      for (let period = 1; period <= PERIODS_PER_DAY[day - 1]; period++) {
        const candidates = bag
          .map((s, i) => ({ s, i, r: rnd() }))
          .filter(({ s }) => !busy.has(`${teacherFor(s).id}|${day}|${period}`))
          .filter(({ s }) => dayList.filter((x) => x === s).length < (s === "math" ? 2 : 1))
          .sort((a, b) => a.r - b.r);
        const choice = candidates[0] ?? { s: bag[0], i: 0 };
        bag.splice(choice.i, 1);
        dayList.push(choice.s);
        const teacher = teacherFor(choice.s);
        busy.add(`${teacher.id}|${day}|${period}`);
        lessons.push({
          id: `${cls.id}-${day}-${period}`,
          classId: cls.id, day, period,
          subjectId: choice.s, teacherId: teacher.id,
          room: ROOMS[choice.s] ?? String(100 + CLASSES.indexOf(cls) * 10 + 5),
        });
      }
    }
  }

  // ---------- daily life: grades, attendance, gate, homework, topics ----------
  const grades: Grade[] = [];
  const marks: LessonMark[] = [];
  const gate: GateEvent[] = [];
  const homework: Homework[] = [];
  const topics: LessonTopic[] = [];
  const absences: AbsenceReport[] = [];
  const notifications: AppNotification[] = [];

  const yearStart = schoolYearStart(anchor);
  const from = daysBetween(yearStart, anchor) > 49 ? addDays(anchor, -49) : yearStart;
  const topicIndex: Record<string, number> = {};
  const demoStudent = students[0];

  for (let date = from; date <= addDays(anchor, 7); date = addDays(date, 1)) {
    const wd = weekday(date);
    if (wd === 7) continue;
    const isPast = date < anchor;
    const isToday = date === anchor;
    const weeksIn = daysBetween(from, date) / 7;

    for (const cls of CLASSES) {
      const dayLessons = lessons.filter((l) => l.classId === cls.id && l.day === wd).sort((a, b) => a.period - b.period);
      const classStudents = students.filter((s) => s.classId === cls.id);

      // whole-day absence and gate check-in/out
      const absentToday = new Set<string>();
      if (isPast || isToday) {
        for (const s of classStudents) {
          const pAbsent = s.name.startsWith("Bekzod") ? 0.09 : 0.03;
          if (isPast && rnd() < pAbsent) {
            absentToday.add(s.id);
            const reported = rnd() < 0.5;
            if (reported) {
              absences.push({
                id: id("ab"), studentId: s.id, parentId: s.parentId, date,
                reason: rnd() < 0.7 ? "sick" : "family", note: "", status: "accepted", createdAt: `${date} 07:1${Math.floor(rnd() * 9)}`,
              });
            }
            for (const l of dayLessons) marks.push({ id: id("m"), studentId: s.id, date, lessonId: l.id, status: reported ? "excused" : "absent" });
            continue;
          }
          if (isToday && s.id === demoStudent.id) continue; // left for the live gate demo
          const late = rnd() < (s.name.startsWith("Bekzod") ? 0.18 : 0.05);
          const inMin = late ? minutes("08:01") + Math.floor(rnd() * 18) : minutes("07:28") + Math.floor(rnd() * 31);
          gate.push({ id: id("g"), studentId: s.id, date, time: fmtTime(inMin), type: "in" });
          if (late && dayLessons[0]) marks.push({ id: id("m"), studentId: s.id, date, lessonId: dayLessons[0].id, status: "late" });
          if (isPast) {
            const last = dayLessons[dayLessons.length - 1];
            const outMin = minutes(PERIOD_START[last.period - 1]) + PERIOD_LEN + Math.floor(rnd() * 12);
            gate.push({ id: id("g"), studentId: s.id, date, time: fmtTime(outMin), type: "out" });
          }
        }
      }

      for (const l of dayLessons) {
        const key = `${cls.id}|${l.subjectId}`;
        const ti = topicIndex[key] ?? 0;
        topicIndex[key] = ti + 1;
        const list = TOPICS[l.subjectId];
        const topic = list[Math.floor(ti / 2) % list.length];
        if (!topics.some((t) => t.classId === cls.id && t.subjectId === l.subjectId && t.date === date)) {
          topics.push({ classId: cls.id, subjectId: l.subjectId, date, topic });
        }

        // homework is set for this lesson date (due next lesson); keep last 3 weeks + next week
        if (daysBetween(date, anchor) <= 21 && l.subjectId !== "pe" && !homework.some((h) => h.classId === cls.id && h.subjectId === l.subjectId && h.date === date)) {
          const tpl = pick(HOMEWORK[l.subjectId]);
          const done: Record<string, boolean> = {};
          if (isPast) for (const s of classStudents) done[s.id] = rnd() < habit[s.id];
          homework.push({ id: id("hw"), classId: cls.id, subjectId: l.subjectId, date, text: tpl.replace(/\{n\}/g, String(10 + ti)), done });
        }

        if (!isPast) continue;
        // grades: 3–4 students per lesson
        const present = classStudents.filter((s) => !absentToday.has(s.id));
        const graded = present.map((s) => ({ s, r: rnd() })).sort((a, b) => a.r - b.r).slice(0, 3 + Math.floor(rnd() * 2));
        for (const { s } of graded) {
          let trend = 0;
          if (s.name.startsWith("Bekzod")) trend = -0.12;
          if (s.name.startsWith("Shohruh")) trend = 0.08;
          const raw = ability[s.id] + affinity[s.id][l.subjectId] + trend * weeksIn + (rnd() - 0.5) * 1.3;
          const value = Math.max(2, Math.min(5, Math.round(raw)));
          const kinds: GradeKind[] = ["oral", "oral", "written", "homework"];
          grades.push({ id: id("gr"), studentId: s.id, subjectId: l.subjectId, date, value, kind: pick(kinds), teacherId: l.teacherId });
        }
      }
    }
  }

  // A planted "skipped lesson": the demo's weak student was at school two days ago but missed one lesson.
  const bekzod = students.find((s) => s.name.startsWith("Bekzod"))!;
  for (let back = 1; back < 8; back++) {
    const d = addDays(anchor, -back);
    if (weekday(d) === 7) continue;
    if (!gate.some((g) => g.studentId === bekzod.id && g.date === d && g.type === "in")) continue;
    const l = lessons.find((x) => x.classId === bekzod.classId && x.day === weekday(d) && x.period === 3);
    if (!l) continue;
    if (!marks.some((m) => m.studentId === bekzod.id && m.date === d && m.lessonId === l.id)) {
      marks.push({ id: id("m"), studentId: bekzod.id, date: d, lessonId: l.id, status: "absent" });
      notifications.push({ id: id("n"), userId: bekzod.parentId, kind: "skipped", params: { student: bekzod.name, subject: l.subjectId, period: String(l.period), date: d }, createdAt: `${d} ${PERIOD_START[2]}`, read: false });
      notifications.push({ id: id("n"), userId: "t1", kind: "skipped", params: { student: bekzod.name, subject: l.subjectId, period: String(l.period), date: d }, createdAt: `${d} ${PERIOD_START[2]}`, read: false });
    }
    break;
  }

  // Recent gate notifications for the demo parent (last 3 school days)
  for (const childId of demoParent.childIds) {
    const child = students.find((s) => s.id === childId)!;
    for (const g of gate.filter((x) => x.studentId === childId && daysBetween(x.date, anchor) <= 3)) {
      const late = g.type === "in" && minutes(g.time) > minutes("08:00");
      notifications.push({ id: id("n"), userId: demoParent.id, kind: g.type === "out" ? "left" : late ? "late" : "arrived", params: { student: child.name, time: g.time, date: g.date }, createdAt: `${g.date} ${g.time}`, read: true });
    }
    for (const gr of grades.filter((x) => x.studentId === childId && daysBetween(x.date, anchor) <= 2)) {
      notifications.push({ id: id("n"), userId: demoParent.id, kind: "grade", params: { student: child.name, subject: gr.subjectId, value: String(gr.value), date: gr.date }, createdAt: `${gr.date} 14:00`, read: false });
    }
  }

  // ---------- weekly tests ----------
  const questions = allBankQuestions();
  const thisWeek = weekStart(anchor);
  const lastWeek = addDays(thisWeek, -7);
  const tests: WeeklyTest[] = [
    {
      id: "wt-chem-8a-prev", classId: "c8a", subjectId: "chem", weekStart: lastWeek,
      title: { uz: "Haftalik test: ishqoriy metallar va neytrallanish", ru: "Еженедельный тест: щелочные металлы и нейтрализация", en: "Weekly test: alkali metals and neutralisation" },
      questionIds: QUESTION_BANK.chem.slice(0, 6).map((q) => q.id), status: "closed", createdBy: "ai",
    },
    {
      id: "wt-math-8a", classId: "c8a", subjectId: "math", weekStart: thisWeek,
      title: { uz: "Haftalik test: tenglamalar", ru: "Еженедельный тест: уравнения", en: "Weekly test: equations" },
      questionIds: QUESTION_BANK.math.map((q) => q.id), status: "open", createdBy: "ai",
    },
    {
      id: "wt-phys-9b", classId: "c9b", subjectId: "phys", weekStart: thisWeek,
      title: { uz: "Haftalik test: kuch va bosim", ru: "Еженедельный тест: сила и давление", en: "Weekly test: force and pressure" },
      questionIds: QUESTION_BANK.phys.map((q) => q.id), status: "open", createdBy: "ai",
    },
  ];

  const attempts: TestAttempt[] = [];
  const chemTest = tests[0];
  const cls8a = students.filter((s) => s.classId === "c8a");
  const byName = (prefix: string) => cls8a.find((s) => s.name.startsWith(prefix))!;
  const madina = byName("Madina"), jasur = byName("Jasur"), otabek = byName("Otabek"), nilufar = byName("Nilufar");
  const shuffle = <T,>(a: T[]) => a.map((x) => ({ x, r: rnd() })).sort((p, q) => p.r - q.r).map((p) => p.x);
  const madinaAnswers: Record<string, number | string> = {};

  const orderedStudents = [madina, ...cls8a.filter((s) => s !== madina)];
  for (const s of orderedStudents) {
    const p = Math.max(0.15, Math.min(0.95, (ability[s.id] + affinity[s.id].chem - 2) / 3));
    const answers: Record<string, number | string> = {};
    const seconds: Record<string, number> = {};
    for (const qid of chemTest.questionIds) {
      const q = questions.find((x) => x.id === qid)!;
      const correct = s === otabek ? true : rnd() < p;
      if (q.type === "mcq") {
        const right = q.answer as number;
        answers[qid] = correct ? right : (right + 1 + Math.floor(rnd() * 3)) % 4;
        seconds[qid] = s === otabek ? 3 + Math.floor(rnd() * 3) : 18 + Math.floor(rnd() * 50);
      } else {
        answers[qid] = shortAnswer(qid, correct, orderedStudents.indexOf(s) + (qid === "chem-6" ? 4 : 0));
        seconds[qid] = s === otabek ? 4 + Math.floor(rnd() * 3) : 60 + Math.floor(rnd() * 120);
      }
    }
    if (s === otabek) {
      // A weak student with a perfect, textbook answer written in seconds.
      answers["chem-5"] = "Natriy ishqoriy metall bo'lib, havodagi kislorod va namlik bilan shiddatli reaksiyaga kirishadi, shu sababli u kerosin qatlami ostida saqlanadi.";
      answers["chem-6"] = "Titrlash jarayonida kislota ishqorni to'liq neytrallaydi, muhit pH qiymati 8,2 dan pastga tushadi va fenolftalein rangsiz shaklga o'tadi.";
    }
    if (s === madina) Object.assign(madinaAnswers, answers);
    if (s === jasur) {
      Object.assign(answers, madinaAnswers);
      // copy a wrong answer too, the strongest signal
      answers["chem-4"] = 0;
      madinaAnswers["chem-4"] = 0;
    }
    const order = s === jasur ? [...chemTest.questionIds] : shuffle(chemTest.questionIds);
    const optionOrder: Record<string, number[]> = {};
    for (const qid of chemTest.questionIds) optionOrder[qid] = shuffle([0, 1, 2, 3]);
    let score = 0, maxScore = 0;
    for (const qid of chemTest.questionIds) {
      const q = questions.find((x) => x.id === qid)!;
      const r = scoreAnswer(q.type, q.answer, answers[qid]);
      score += r.points; maxScore += r.max;
    }
    const weakFollowUp = s === otabek || s === jasur;
    attempts.push({
      id: id("at"), testId: chemTest.id, studentId: s.id, order, optionOrder, answers, seconds,
      pasteCount: s === nilufar ? 2 : 0, blurCount: s === nilufar ? 3 : rnd() < 0.15 ? 1 : 0,
      submittedAt: `${addDays(lastWeek, 4)} ${s === jasur || s === madina ? "11:42" : fmtTime(minutes("11:30") + Math.floor(rnd() * 25))}`,
      score, maxScore,
      followUp: {
        questionId: "chem-5",
        prompt: "",
        answer: weakFollowUp ? (s === otabek ? "Bilmayman, shunchaki yozdim" : "Madinadan so'radim") : "Natriy havodagi suv bilan reaksiyaga kirishadi, shuning uchun kerosin ichida saqlanadi.",
        verdict: weakFollowUp ? "weak" : "ok",
      },
    });
  }
  // Madina's answer with the copied wrong answer must stay identical, so rescore her.
  const madinaAttempt = attempts.find((a) => a.studentId === madina.id)!;
  madinaAttempt.answers = { ...madinaAnswers };
  {
    let score = 0;
    for (const qid of chemTest.questionIds) {
      const q = questions.find((x) => x.id === qid)!;
      score += scoreAnswer(q.type, q.answer, madinaAttempt.answers[qid]).points;
    }
    madinaAttempt.score = score;
  }

  return {
    version: DB_VERSION,
    seededOn: anchor,
    schoolName: "Toshkent shahar 110-maktab",
    subjects: SUBJECTS,
    teachers: TEACHERS,
    classes: CLASSES,
    students, parents, lessons, grades, marks, gate, absences, homework, topics, notifications,
    questions, tests, attempts,
    settings: { apiKey: "", schoolStart: "08:00", lateAfter: "08:00" },
  };
}

/** mcq = 1 point; short answer = up to 2 points by keyword coverage. */
export function scoreAnswer(type: "mcq" | "short", key: number | string[], given: number | string | undefined) {
  if (type === "mcq") return { points: given === key ? 1 : 0, max: 1 };
  const text = String(given ?? "").toLowerCase();
  const hits = (key as string[]).filter((k) => text.includes(k.toLowerCase())).length;
  return { points: hits >= 2 ? 2 : hits === 1 ? 1 : 0, max: 2 };
}
