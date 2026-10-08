import type { Question } from "./types";

/**
 * Question bank used by the weekly tests when no AI key is connected.
 * Keyed by subject id. With Claude connected, teachers can generate new questions instead.
 */
export const QUESTION_BANK: Record<string, Question[]> = {
  chem: [
    {
      id: "chem-1", type: "mcq", difficulty: 1,
      topic: { uz: "Ishqoriy metallar", ru: "Щелочные металлы", en: "Alkali metals" },
      text: { uz: "Natriy suv bilan reaksiyaga kirishganda qaysi gaz ajralib chiqadi?", ru: "Какой газ выделяется при реакции натрия с водой?", en: "Which gas is released when sodium reacts with water?" },
      options: [
        { uz: "Kislorod", ru: "Кислород", en: "Oxygen" },
        { uz: "Vodorod", ru: "Водород", en: "Hydrogen" },
        { uz: "Karbonat angidrid", ru: "Углекислый газ", en: "Carbon dioxide" },
        { uz: "Azot", ru: "Азот", en: "Nitrogen" },
      ],
      answer: 1,
      explain: { uz: "2Na + 2H₂O → 2NaOH + H₂↑ — vodorod ajraladi.", ru: "2Na + 2H₂O → 2NaOH + H₂↑ — выделяется водород.", en: "2Na + 2H₂O → 2NaOH + H₂↑ — hydrogen is released." },
    },
    {
      id: "chem-2", type: "mcq", difficulty: 1,
      topic: { uz: "Indikatorlar", ru: "Индикаторы", en: "Indicators" },
      text: { uz: "Fenolftalein ishqoriy muhitda qanday rangga kiradi?", ru: "Какой цвет приобретает фенолфталеин в щелочной среде?", en: "What colour does phenolphthalein turn in an alkaline solution?" },
      options: [
        { uz: "Rangsiz", ru: "Бесцветный", en: "Colourless" },
        { uz: "Sariq", ru: "Жёлтый", en: "Yellow" },
        { uz: "Pushti (malina)", ru: "Малиновый", en: "Pink (crimson)" },
        { uz: "Ko'k", ru: "Синий", en: "Blue" },
      ],
      answer: 2,
      explain: { uz: "Fenolftalein ishqorda pushti, kislota va neytral muhitda rangsiz.", ru: "Фенолфталеин малиновый в щёлочи и бесцветный в кислой и нейтральной среде.", en: "Phenolphthalein is pink in alkali and colourless in acidic or neutral solutions." },
    },
    {
      id: "chem-3", type: "mcq", difficulty: 2,
      topic: { uz: "Neytrallanish", ru: "Нейтрализация", en: "Neutralisation" },
      text: { uz: "HCl + NaOH reaksiyasi mahsulotlari qaysilar?", ru: "Каковы продукты реакции HCl + NaOH?", en: "What are the products of HCl + NaOH?" },
      options: [
        { uz: "NaCl + H₂O", ru: "NaCl + H₂O", en: "NaCl + H₂O" },
        { uz: "NaH + HClO", ru: "NaH + HClO", en: "NaH + HClO" },
        { uz: "Na + Cl₂ + H₂", ru: "Na + Cl₂ + H₂", en: "Na + Cl₂ + H₂" },
        { uz: "NaClO + H₂", ru: "NaClO + H₂", en: "NaClO + H₂" },
      ],
      answer: 0,
      explain: { uz: "Kislota + ishqor → tuz + suv: HCl + NaOH → NaCl + H₂O.", ru: "Кислота + щёлочь → соль + вода: HCl + NaOH → NaCl + H₂O.", en: "Acid + base → salt + water: HCl + NaOH → NaCl + H₂O." },
    },
    {
      id: "chem-4", type: "mcq", difficulty: 2,
      topic: { uz: "Metallar faolligi", ru: "Активность металлов", en: "Reactivity of metals" },
      text: { uz: "Temir mis(II) sulfat eritmasiga solinsa nima kuzatiladi?", ru: "Что наблюдается, если железо опустить в раствор сульфата меди(II)?", en: "What happens when iron is placed in copper(II) sulfate solution?" },
      options: [
        { uz: "Hech narsa o'zgarmaydi", ru: "Ничего не меняется", en: "Nothing changes" },
        { uz: "Temirda qizil mis qatlami hosil bo'ladi, eritma rangi xiralashadi", ru: "На железе оседает красная медь, раствор светлеет", en: "Red copper coats the iron and the blue solution fades" },
        { uz: "Gaz ajralib chiqadi", ru: "Выделяется газ", en: "A gas is released" },
        { uz: "Eritma qizil rangga kiradi", ru: "Раствор становится красным", en: "The solution turns red" },
      ],
      answer: 1,
      explain: { uz: "Fe faolroq, shuning uchun Cu ni siqib chiqaradi: Fe + CuSO₄ → FeSO₄ + Cu.", ru: "Fe активнее и вытесняет Cu: Fe + CuSO₄ → FeSO₄ + Cu.", en: "Fe is more reactive and displaces Cu: Fe + CuSO₄ → FeSO₄ + Cu." },
    },
    {
      id: "chem-5", type: "short", difficulty: 2,
      topic: { uz: "Ishqoriy metallar", ru: "Щелочные металлы", en: "Alkali metals" },
      text: { uz: "Nima uchun natriy kerosin ostida saqlanadi? Qisqa tushuntiring.", ru: "Почему натрий хранят под керосином? Объясните кратко.", en: "Why is sodium stored under kerosene? Explain briefly." },
      answer: ["havo", "suv", "namlik", "kislorod", "воздух", "вод", "влаг", "кислород", "air", "water", "moisture", "oxygen", "reak", "react"],
      explain: { uz: "Natriy juda faol: havodagi kislorod va namlik bilan tez reaksiyaga kirishadi. Kerosin uni havodan ajratib turadi.", ru: "Натрий очень активен и быстро реагирует с кислородом и влагой воздуха. Керосин изолирует его от воздуха.", en: "Sodium is very reactive and quickly reacts with oxygen and moisture in air. Kerosene keeps air away from it." },
    },
    {
      id: "chem-6", type: "short", difficulty: 3,
      topic: { uz: "Neytrallanish", ru: "Нейтрализация", en: "Neutralisation" },
      text: { uz: "Titrlashda ishqorga kislota qo'shilganda fenolftalein nima uchun rangsizlanadi?", ru: "Почему при титровании щёлочи кислотой фенолфталеин обесцвечивается?", en: "During titration, why does phenolphthalein lose its colour when acid is added to the alkali?" },
      answer: ["neytral", "ishqor", "pH", "kislota", "нейтрал", "щёлоч", "щелоч", "кислот", "neutral", "alkali", "base", "acid"],
      explain: { uz: "Kislota ishqorni neytrallaydi, pH 8 dan pastga tushadi va fenolftalein rangsiz shaklga o'tadi.", ru: "Кислота нейтрализует щёлочь, pH падает ниже 8, и фенолфталеин переходит в бесцветную форму.", en: "The acid neutralises the alkali, pH drops below about 8 and phenolphthalein switches to its colourless form." },
    },
    {
      id: "chem-7", type: "mcq", difficulty: 3,
      topic: { uz: "Kislotalar", ru: "Кислоты", en: "Acids" },
      text: { uz: "Rux xlorid kislota bilan reaksiyaga kirishganda qaysi tuz hosil bo'ladi?", ru: "Какая соль образуется при реакции цинка с соляной кислотой?", en: "Which salt forms when zinc reacts with hydrochloric acid?" },
      options: [
        { uz: "ZnSO₄", ru: "ZnSO₄", en: "ZnSO₄" },
        { uz: "ZnCl₂", ru: "ZnCl₂", en: "ZnCl₂" },
        { uz: "ZnO", ru: "ZnO", en: "ZnO" },
        { uz: "Zn(OH)₂", ru: "Zn(OH)₂", en: "Zn(OH)₂" },
      ],
      answer: 1,
      explain: { uz: "Zn + 2HCl → ZnCl₂ + H₂↑", ru: "Zn + 2HCl → ZnCl₂ + H₂↑", en: "Zn + 2HCl → ZnCl₂ + H₂↑" },
    },
  ],
  math: [
    {
      id: "math-1", type: "mcq", difficulty: 1,
      topic: { uz: "Chiziqli tenglamalar", ru: "Линейные уравнения", en: "Linear equations" },
      text: { uz: "3x + 5 = 20 tenglamani yeching.", ru: "Решите уравнение 3x + 5 = 20.", en: "Solve 3x + 5 = 20." },
      options: [{ uz: "x = 3", ru: "x = 3", en: "x = 3" }, { uz: "x = 5", ru: "x = 5", en: "x = 5" }, { uz: "x = 15", ru: "x = 15", en: "x = 15" }, { uz: "x = 25/3", ru: "x = 25/3", en: "x = 25/3" }],
      answer: 1,
      explain: { uz: "3x = 15, x = 5.", ru: "3x = 15, x = 5.", en: "3x = 15, so x = 5." },
    },
    {
      id: "math-2", type: "mcq", difficulty: 1,
      topic: { uz: "Darajalar", ru: "Степени", en: "Powers" },
      text: { uz: "2⁵ nechaga teng?", ru: "Чему равно 2⁵?", en: "What is 2⁵?" },
      options: [{ uz: "10", ru: "10", en: "10" }, { uz: "25", ru: "25", en: "25" }, { uz: "32", ru: "32", en: "32" }, { uz: "64", ru: "64", en: "64" }],
      answer: 2,
      explain: { uz: "2·2·2·2·2 = 32.", ru: "2·2·2·2·2 = 32.", en: "2·2·2·2·2 = 32." },
    },
    {
      id: "math-3", type: "mcq", difficulty: 2,
      topic: { uz: "Qisqa ko'paytirish", ru: "Формулы сокращённого умножения", en: "Algebraic identities" },
      text: { uz: "(a + b)² ni oching.", ru: "Раскройте (a + b)².", en: "Expand (a + b)²." },
      options: [{ uz: "a² + b²", ru: "a² + b²", en: "a² + b²" }, { uz: "a² + 2ab + b²", ru: "a² + 2ab + b²", en: "a² + 2ab + b²" }, { uz: "2a + 2b", ru: "2a + 2b", en: "2a + 2b" }, { uz: "a² − 2ab + b²", ru: "a² − 2ab + b²", en: "a² − 2ab + b²" }],
      answer: 1,
      explain: { uz: "(a + b)² = a² + 2ab + b².", ru: "(a + b)² = a² + 2ab + b².", en: "(a + b)² = a² + 2ab + b²." },
    },
    {
      id: "math-4", type: "mcq", difficulty: 2,
      topic: { uz: "Funksiyalar", ru: "Функции", en: "Functions" },
      text: { uz: "y = 2x − 4 funksiya grafigi Ox o'qini qaysi nuqtada kesadi?", ru: "В какой точке график y = 2x − 4 пересекает ось Ox?", en: "Where does y = 2x − 4 cross the x-axis?" },
      options: [{ uz: "(0; −4)", ru: "(0; −4)", en: "(0, −4)" }, { uz: "(2; 0)", ru: "(2; 0)", en: "(2, 0)" }, { uz: "(−2; 0)", ru: "(−2; 0)", en: "(−2, 0)" }, { uz: "(4; 0)", ru: "(4; 0)", en: "(4, 0)" }],
      answer: 1,
      explain: { uz: "y = 0 bo'lganda 2x = 4, x = 2.", ru: "При y = 0: 2x = 4, x = 2.", en: "At y = 0: 2x = 4, so x = 2." },
    },
    {
      id: "math-5", type: "short", difficulty: 2,
      topic: { uz: "Chiziqli tenglamalar", ru: "Линейные уравнения", en: "Linear equations" },
      text: { uz: "Agar 2(x − 3) = 10 bo'lsa, x ni toping va yechim qadamlarini yozing.", ru: "Найдите x, если 2(x − 3) = 10, и запишите шаги решения.", en: "Find x if 2(x − 3) = 10 and write the steps." },
      answer: ["8", "x=8", "x = 8"],
      explain: { uz: "2x − 6 = 10 → 2x = 16 → x = 8.", ru: "2x − 6 = 10 → 2x = 16 → x = 8.", en: "2x − 6 = 10 → 2x = 16 → x = 8." },
    },
    {
      id: "math-6", type: "short", difficulty: 3,
      topic: { uz: "Kvadrat tenglamalar", ru: "Квадратные уравнения", en: "Quadratic equations" },
      text: { uz: "x² − 5x + 6 = 0 tenglamaning ildizlarini toping.", ru: "Найдите корни уравнения x² − 5x + 6 = 0.", en: "Find the roots of x² − 5x + 6 = 0." },
      answer: ["2", "3"],
      explain: { uz: "(x − 2)(x − 3) = 0, demak x = 2 yoki x = 3.", ru: "(x − 2)(x − 3) = 0, значит x = 2 или x = 3.", en: "(x − 2)(x − 3) = 0, so x = 2 or x = 3." },
    },
  ],
  phys: [
    {
      id: "phys-1", type: "mcq", difficulty: 1,
      topic: { uz: "Harakat", ru: "Движение", en: "Motion" },
      text: { uz: "Tezlik formulasi qaysi?", ru: "Какая формула скорости?", en: "Which is the formula for speed?" },
      options: [{ uz: "v = s / t", ru: "v = s / t", en: "v = s / t" }, { uz: "v = s · t", ru: "v = s · t", en: "v = s · t" }, { uz: "v = t / s", ru: "v = t / s", en: "v = t / s" }, { uz: "v = m · a", ru: "v = m · a", en: "v = m · a" }],
      answer: 0,
      explain: { uz: "Tezlik = yo'l / vaqt.", ru: "Скорость = путь / время.", en: "Speed = distance / time." },
    },
    {
      id: "phys-2", type: "mcq", difficulty: 2,
      topic: { uz: "Nyuton qonunlari", ru: "Законы Ньютона", en: "Newton's laws" },
      text: { uz: "Massasi 2 kg jismga 10 N kuch ta'sir qilsa, tezlanish qancha?", ru: "На тело массой 2 кг действует сила 10 Н. Каково ускорение?", en: "A 10 N force acts on a 2 kg body. What is its acceleration?" },
      options: [{ uz: "20 m/s²", ru: "20 м/с²", en: "20 m/s²" }, { uz: "5 m/s²", ru: "5 м/с²", en: "5 m/s²" }, { uz: "0,2 m/s²", ru: "0,2 м/с²", en: "0.2 m/s²" }, { uz: "12 m/s²", ru: "12 м/с²", en: "12 m/s²" }],
      answer: 1,
      explain: { uz: "a = F / m = 10 / 2 = 5 m/s².", ru: "a = F / m = 10 / 2 = 5 м/с².", en: "a = F / m = 10 / 2 = 5 m/s²." },
    },
    {
      id: "phys-3", type: "short", difficulty: 2,
      topic: { uz: "Bosim", ru: "Давление", en: "Pressure" },
      text: { uz: "Nima uchun o'tkir pichoq to'mtoq pichoqdan yaxshi kesadi?", ru: "Почему острый нож режет лучше тупого?", en: "Why does a sharp knife cut better than a blunt one?" },
      answer: ["bosim", "yuza", "maydon", "давлен", "площад", "pressure", "area"],
      explain: { uz: "Kuch kichik yuzaga tushadi, shuning uchun bosim katta bo'ladi (p = F / S).", ru: "Сила действует на малую площадь, поэтому давление больше (p = F / S).", en: "The force acts on a smaller area, so the pressure is higher (p = F / A)." },
    },
    {
      id: "phys-4", type: "mcq", difficulty: 1,
      topic: { uz: "Energiya", ru: "Энергия", en: "Energy" },
      text: { uz: "Energiyaning SI birligi qaysi?", ru: "Какая единица энергии в СИ?", en: "What is the SI unit of energy?" },
      options: [{ uz: "Vatt", ru: "Ватт", en: "Watt" }, { uz: "Nyuton", ru: "Ньютон", en: "Newton" }, { uz: "Joul", ru: "Джоуль", en: "Joule" }, { uz: "Paskal", ru: "Паскаль", en: "Pascal" }],
      answer: 2,
      explain: { uz: "Energiya joulda (J) o'lchanadi.", ru: "Энергия измеряется в джоулях (Дж).", en: "Energy is measured in joules (J)." },
    },
    {
      id: "phys-5", type: "mcq", difficulty: 3,
      topic: { uz: "Elektr", ru: "Электричество", en: "Electricity" },
      text: { uz: "Kuchlanish 12 V, qarshilik 4 Ω. Tok kuchi qancha?", ru: "Напряжение 12 В, сопротивление 4 Ом. Какова сила тока?", en: "Voltage is 12 V and resistance 4 Ω. What is the current?" },
      options: [{ uz: "48 A", ru: "48 А", en: "48 A" }, { uz: "3 A", ru: "3 А", en: "3 A" }, { uz: "0,33 A", ru: "0,33 А", en: "0.33 A" }, { uz: "16 A", ru: "16 А", en: "16 A" }],
      answer: 1,
      explain: { uz: "I = U / R = 12 / 4 = 3 A.", ru: "I = U / R = 12 / 4 = 3 А.", en: "I = U / R = 12 / 4 = 3 A." },
    },
  ],
};

export function allBankQuestions(): Question[] {
  return Object.values(QUESTION_BANK).flat();
}
