import { useCallback, useState } from "react";

export type Lang = "uz" | "ru" | "en";
const KEY = "maktab.live.lang";

// Uzbek (Latin) is the source text; ru/en follow the same keys.
const D: Record<string, Record<Lang, string>> = {
  demo_title: { uz: "Namuna maktabga bir bosishda kiring", ru: "Войдите в демо-школу одним нажатием", en: "Try the demo school in one tap" },
  demo_sub: { uz: "Bu yerdagi barcha odamlar va ma'lumotlar o'ylab topilgan. Ro'yxatdan o'tish yoki qo'ng'iroq shart emas.", ru: "Все люди и данные здесь вымышлены. Без регистрации и звонков.", en: "All people and data here are invented. No sign-up, no phone call." },
  enter_as: { uz: "Kirish", ru: "Войти", en: "Enter" },
  role_director: { uz: "Direktor", ru: "Директор", en: "Director" },
  role_zavuch: { uz: "Zavuch", ru: "Завуч", en: "Deputy head" },
  role_teacher: { uz: "O'qituvchi", ru: "Учитель", en: "Teacher" },
  role_parent: { uz: "Ota-ona", ru: "Родитель", en: "Parent" },
  role_student: { uz: "O'quvchi", ru: "Ученик", en: "Student" },
  role_director_d: { uz: "Asosiy ko'rsatkichlar va muammolar", ru: "Ключевые показатели и проблемы", en: "Key numbers and problems" },
  role_zavuch_d: { uz: "O'qituvchilar ishi, muammolar qutisi", ru: "Работа учителей, проблемы", en: "Teachers' work, problem inbox" },
  role_teacher_d: { uz: "Mening kunim, kimdan so'rash", ru: "Мой день, кого спросить", en: "My day, who to ask first" },
  role_parent_d: { uz: "Maktabga keldimi, baholar, vazifalar", ru: "Пришёл ли в школу, оценки, задания", en: "Arrived at school?, grades, homework" },
  role_student_d: { uz: "Kundalik, baholar, uy vazifalari", ru: "Дневник, оценки, задания", en: "Diary, grades, homework" },
  hosted_uz: { uz: "Ma'lumotlar O'zbekistondagi serverda saqlanadi (rejalashtirilgan)", ru: "Данные хранятся на сервере в Узбекистане (планируется)", en: "Data stored on servers in Uzbekistan (planned)" },
  hello: { uz: "Salom, {n}!", ru: "Здравствуйте, {n}!", en: "Hello, {n}!" },
  logout: { uz: "Chiqish", ru: "Выйти", en: "Log out" },
  loading: { uz: "Yuklanmoqda…", ru: "Загрузка…", en: "Loading…" },
  error: { uz: "Xatolik. Qayta urinib ko'ring.", ru: "Ошибка. Попробуйте ещё раз.", en: "Something went wrong. Please try again." },
  not_found: { uz: "Bunday maktab topilmadi", ru: "Школа не найдена", en: "School not found" },
  // teacher
  lessons_today: { uz: "Bugungi darslar", ru: "Уроки сегодня", en: "Today's lessons" },
  lessons_done: { uz: "Tugallangan", ru: "Завершено", en: "Finished" },
  absence_pending: { uz: "Sababli kelmaslik so'rovlari", ru: "Заявки об отсутствии", en: "Absence reports" },
  no_lessons: { uz: "Bugun darslaringiz yo'q", ru: "Сегодня уроков нет", en: "No lessons today" },
  ask_first: { uz: "Birinchi so'rang", ru: "Спросить первыми", en: "Ask first" },
  ask_first_hint: { uz: "Faqat siz ko'rasiz. Jazolash uchun emas, yordam uchun.", ru: "Видите только вы. Чтобы помочь, а не наказать.", en: "Only you see this. It's for support, not punishment." },
  card_none: { uz: "Dars kartasi yo'q", ru: "Нет карточки урока", en: "No lesson card" },
  card_draft: { uz: "Qoralama", ru: "Черновик", en: "Draft" },
  card_ai_draft: { uz: "AI qoralama", ru: "Черновик AI", en: "AI draft" },
  card_approved: { uz: "Tasdiqlangan", ru: "Утверждено", en: "Approved" },
  att_done: { uz: "Davomat ✓", ru: "Посещаемость ✓", en: "Attendance ✓" },
  lesson_done: { uz: "Dars yakunlandi", ru: "Урок завершён", en: "Lesson finished" },
  substitution: { uz: "O'rinbosar", ru: "Замена", en: "Substitution" },
  next_step: { uz: "Keyingi bosqich: dars kartasi va «dars tugadi» ekrani shu yerdan ochiladi.", ru: "Следующий шаг: отсюда откроются карточка урока и экран «урок окончен».", en: "Next step: the lesson card and the \"after lesson\" screen will open from here." },
  // family
  at_school_today: { uz: "Bugun maktabda", ru: "Сегодня в школе", en: "At school today" },
  arrived: { uz: "Maktabga keldi — {t}", ru: "Пришёл в школу — {t}", en: "Arrived at school — {t}" },
  left: { uz: "Maktabdan chiqdi — {t}", ru: "Ушёл из школы — {t}", en: "Left school — {t}" },
  not_arrived: { uz: "Hali maktabga kelmagan", ru: "Ещё не пришёл в школу", en: "Not at school yet" },
  gate_note: { uz: "Faqat maktab darvozasidagi kirish/chiqish. GPS kuzatuvi yo'q.", ru: "Только вход/выход через школьные ворота. Без GPS.", en: "School gate entry/exit only. No GPS tracking." },
  avg_grade: { uz: "O'rtacha baho (oxirgi)", ru: "Средний балл (последние)", en: "Average grade (recent)" },
  attendance30: { uz: "Davomat (30 kun)", ru: "Посещаемость (30 дней)", en: "Attendance (30 days)" },
  late_absent: { uz: "{l} marta kechikkan · {a} dars qoldirilgan", ru: "Опозданий: {l} · пропусков: {a}", en: "{l} late · {a} lessons missed" },
  homework: { uz: "Uy vazifalari", ru: "Домашние задания", en: "Homework" },
  due: { uz: "muddat {d}", ru: "срок {d}", en: "due {d}" },
  recent_grades: { uz: "Oxirgi baholar", ru: "Последние оценки", en: "Recent grades" },
  teachers: { uz: "O'qituvchilar", ru: "Учителя", en: "Teachers" },
  class_teacher: { uz: "Sinf rahbari", ru: "Классный руководитель", en: "Class teacher" },
  contact_office: { uz: "O'qituvchi bilan bog'lanish maktab ma'muriyati orqali amalga oshiriladi.", ru: "Связь с учителем — через администрацию школы.", en: "To contact a teacher, write to the school office." },
  absence_reports: { uz: "Kelmaslik haqida xabarlar", ru: "Сообщения об отсутствии", en: "Absence reports" },
  st_pending: { uz: "Ko'rib chiqilmoqda", ru: "На рассмотрении", en: "Pending" },
  st_accepted: { uz: "Qabul qilindi", ru: "Принято", en: "Accepted" },
  st_rejected: { uz: "Rad etildi", ru: "Отклонено", en: "Rejected" },
  nothing: { uz: "Hozircha yo'q", ru: "Пока нет", en: "Nothing yet" },
  // leaders
  students: { uz: "O'quvchilar", ru: "Ученики", en: "Students" },
  arrived_today: { uz: "Bugun keldi", ru: "Пришли сегодня", en: "Arrived today" },
  attendance_rate: { uz: "Davomat (30 kun)", ru: "Посещаемость (30 дн.)", en: "Attendance (30 days)" },
  avg_school: { uz: "O'rtacha baho (30 kun)", ru: "Средний балл (30 дн.)", en: "Average grade (30 days)" },
  by_class: { uz: "Sinflar bo'yicha davomat", ru: "Посещаемость по классам", en: "Attendance by class" },
  problems: { uz: "Muammolar qutisi", ru: "Проблемы", en: "Problem inbox" },
  serious: { uz: "Jiddiy", ru: "Серьёзно", en: "Serious" },
  small: { uz: "Kichik", ru: "Мелкое", en: "Small" },
  teachers_classes: { uz: "{t} o'qituvchi · {c} sinf", ru: "{t} учителей · {c} класса", en: "{t} teachers · {c} classes" },
  no_ranking: { uz: "Reyting yo'q: ko'rsatkichlar sinf va maktab bo'yicha, bolalar solishtirilmaydi.", ru: "Без рейтингов: показатели по классам и школе, детей не сравниваем.", en: "No rankings: numbers are per class and school, children are never compared." },
};

const MONTHS: Record<Lang, string[]> = {
  uz: ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"],
  ru: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};
const DAYS: Record<Lang, string[]> = {
  uz: ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"],
  ru: ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

export function useLang() {
  const [lang, setLangState] = useState<Lang>(() => {
    try { const v = localStorage.getItem(KEY); if (v === "uz" || v === "ru" || v === "en") return v; } catch { /* ignore */ }
    return "uz";
  });
  const setLang = (l: Lang) => { setLangState(l); try { localStorage.setItem(KEY, l); } catch { /* ignore */ } document.documentElement.lang = l; };
  const t = useCallback((k: string, vars: Record<string, string | number> = {}) => {
    let s = D[k]?.[lang] ?? D[k]?.uz ?? k;
    for (const [n, v] of Object.entries(vars)) s = s.replace(`{${n}}`, String(v));
    return s;
  }, [lang]);
  // "YYYY-MM-DD" → "18 noyabr" / with weekday
  const date = useCallback((iso: string, weekday = false) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    const wd = DAYS[lang][new Date(y, m - 1, d).getDay()];
    const md = lang === "en" ? `${MONTHS.en[m - 1]} ${d}` : `${d} ${MONTHS[lang][m - 1]}`;
    return weekday ? `${wd}, ${md}` : md;
  }, [lang]);
  const time = (ts: string) => new Date(ts).toLocaleTimeString("en-GB", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" });
  return { lang, setLang, t, date, time };
}
export type I18n = ReturnType<typeof useLang>;
