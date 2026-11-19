import { useCallback, useState } from "react";

export type Lang = "uz" | "ru" | "en";
const KEY = "maktab.live.lang";

// Uzbek (Latin) is the source text; ru/en follow the same keys.
const D: Record<string, Record<Lang, string>> = {
  demo_title: { uz: "Namuna maktabga bir bosishda kiring", ru: "Войдите в демо-школу одним нажатием", en: "Try the demo school in one tap" },
  demo_sub: { uz: "Bu yerdagi barcha odamlar va ma'lumotlar o'ylab topilgan.", ru: "Все люди и данные здесь вымышлены.", en: "All people and data here are invented." },
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
  sign_in: { uz: "Tizimga kirish", ru: "Вход", en: "Sign in" },
  login_label: { uz: "Telefon raqam yoki login", ru: "Номер телефона или логин", en: "Phone number or login" },
  password: { uz: "Parol", ru: "Пароль", en: "Password" },
  show_password: { uz: "Parolni ko'rsatish", ru: "Показать пароль", en: "Show password" },
  forgot: { uz: "Parolni unutdingizmi? Maktab ma'muriyatiga murojaat qiling.", ru: "Забыли пароль? Обратитесь в администрацию школы.", en: "Forgot your password? Ask the school office." },
  bad_credentials: { uz: "Login yoki parol noto'g'ri.", ru: "Неверный логин или пароль.", en: "Wrong login or password." },
  too_many: { uz: "Juda ko'p urinish. 1 daqiqadan keyin qayta urinib ko'ring.", ru: "Слишком много попыток. Попробуйте через минуту.", en: "Too many attempts. Try again in a minute." },
  demo_accounts: { uz: "Namuna maktab uchun test kirishlar", ru: "Тестовые входы для демо-школы", en: "Test logins for the demo school" },
  demo_teacher: { uz: "O'qituvchi", ru: "Учитель", en: "Teacher" },
  demo_teacher_parent: { uz: "O'qituvchi + ota-ona (2 rol)", ru: "Учитель + родитель (2 роли)", en: "Teacher + parent (2 roles)" },
  demo_parent: { uz: "Ota-ona (2 farzand)", ru: "Родитель (2 ребёнка)", en: "Parent (2 children)" },
  demo_student: { uz: "O'quvchi", ru: "Ученик", en: "Student" },
  demo_director: { uz: "Direktor", ru: "Директор", en: "Director" },
  demo_zavuch: { uz: "Zavuch", ru: "Завуч", en: "Deputy head" },
  who_today: { uz: "Bugun kim sifatida kirasiz?", ru: "Кем вы входите сегодня?", en: "Who are you today?" },
  who_today_sub: { uz: "Sizda bu maktabda bir nechta rol bor. Faqat o'z rollaringiz ko'rsatiladi.", ru: "У вас несколько ролей в этой школе. Показаны только ваши роли.", en: "You have more than one role in this school. Only your own roles are shown." },
  switch_role: { uz: "Rolni almashtirish", ru: "Сменить роль", en: "Switch role" },
  cancel: { uz: "Bekor qilish", ru: "Отмена", en: "Cancel" },
  role_school_admin: { uz: "Maktab ma'muri", ru: "Администратор", en: "School admin" },
  role_school_admin_d: { uz: "Sozlamalar va foydalanuvchilar", ru: "Настройки и пользователи", en: "Settings and users" },
  // step 2: teacher's day
  att_and_grades: { uz: "Davomat va baholar", ru: "Посещаемость и оценки", en: "Attendance and grades" },
  given_today: { uz: "Bugun qo'yilgan", ru: "Поставлено сегодня", en: "Given today" },
  open_card: { uz: "Dars kartasi", ru: "Карточка урока", en: "Lesson card" },
  after_lesson: { uz: "Dars tugadi", ru: "Урок окончен", en: "After lesson" },
  edit_after: { uz: "Tahrirlash", ru: "Изменить", en: "Edit" },
  back: { uz: "Orqaga", ru: "Назад", en: "Back" },
  save: { uz: "Saqlash", ru: "Сохранить", en: "Save" },
  saved: { uz: "Saqlandi", ru: "Сохранено", en: "Saved" },
  approve: { uz: "Tasdiqlash", ru: "Утвердить", en: "Approve" },
  topic: { uz: "Mavzu", ru: "Тема", en: "Topic" },
  plan: { uz: "Dars rejasi", ru: "План урока", en: "Lesson plan" },
  plan_ph: { uz: "1) Takrorlash — 5 daq\n2) Yangi mavzu — 20 daq\n3) Mashq — 15 daq\n4) Chiqish savollari — 5 daq", ru: "1) Повторение — 5 мин\n2) Новая тема — 20 мин\n3) Практика — 15 мин\n4) Вопросы на выходе — 5 мин", en: "1) Review — 5 min\n2) New topic — 20 min\n3) Practice — 15 min\n4) Exit check — 5 min" },
  exit_q: { uz: "Chiqish savollari (dars oxirida, qo'l ko'tarib)", ru: "Вопросы на выходе (в конце урока, поднятием руки)", en: "Exit check (end of lesson, by show of hands)" },
  exit_q_n: { uz: "{n}-savol", ru: "Вопрос {n}", en: "Question {n}" },
  ai_later: { uz: "AI qoralama tayyorlash keyingi bosqichda qo'shiladi (Kutubxona birinchi).", ru: "Черновик от AI появится на следующем шаге (сначала Библиотека).", en: "AI drafts come in a later step (Library first)." },
  card_private: { uz: "«Birinchi so'rang» ro'yxatini faqat siz ko'rasiz.", ru: "Список «спросить первыми» видите только вы.", en: "Only you see the \"ask first\" list." },
  attendance: { uz: "Davomat", ru: "Посещаемость", en: "Attendance" },
  present: { uz: "Bor", ru: "Есть", en: "Here" },
  late: { uz: "Kech", ru: "Опоздал", en: "Late" },
  absent: { uz: "Yo'q", ru: "Нет", en: "Absent" },
  no_gate: { uz: "darvozadan o'tmagan", ru: "не прошёл ворота", en: "no gate entry" },
  tally: { uz: "{p} bor · {l} kech · {a} yo'q", ru: "{p} есть · {l} опоздали · {a} нет", en: "{p} here · {l} late · {a} absent" },
  grades_opt: { uz: "Baholar (ixtiyoriy)", ru: "Оценки (необязательно)", en: "Grades (optional)" },
  didnt_get: { uz: "Tushunmadi", ru: "Не понял", en: "Didn't get it" },
  comment: { uz: "Izoh", ru: "Комментарий", en: "Comment" },
  no_comment: { uz: "Izohsiz", ru: "Без комментария", en: "No comment" },
  c1: { uz: "Keyingi qadam: javobni tekshirib chiqing", ru: "Следующий шаг: проверьте ответ", en: "Next step: check your answer" },
  c2: { uz: "Keyingi qadam: qoidani yana bir bor takrorlang", ru: "Следующий шаг: повторите правило", en: "Next step: review the rule once more" },
  c3: { uz: "Yaxshi: yechimni asoslab berdingiz", ru: "Хорошо: вы обосновали решение", en: "Good: you explained your solution" },
  c4: { uz: "Keyingi qadam: misolni bosqichma-bosqich yozing", ru: "Следующий шаг: пишите решение по шагам", en: "Next step: write the solution step by step" },
  feedback_rule: { uz: "Izoh ish haqida va bitta keyingi qadam — bola haqida emas.", ru: "Комментарий — о работе и один следующий шаг, не о ребёнке.", en: "Comments are about the work plus one next step — never about the child." },
  lesson_info: { uz: "Mavzu, uy vazifasi, chiqish savollari", ru: "Тема, домашнее задание, вопросы на выходе", en: "Topic, homework, exit check" },
  got_it: { uz: "Tushundi", ru: "Поняли", en: "Got it" },
  of_n: { uz: "/ {n}", ru: "/ {n}", en: "/ {n}" },
  private_note: { uz: "Shaxsiy eslatma (faqat siz)", ru: "Личная заметка (только вы)", en: "Private note (only you)" },
  finish_save: { uz: "Saqlash va yakunlash", ru: "Сохранить и завершить", en: "Save and finish" },
  saving: { uz: "Saqlanmoqda…", ru: "Сохранение…", en: "Saving…" },
  sent_ok: { uz: "Dars saqlandi. Ota-onalarga kerakli xabarlar yuborildi.", ru: "Урок сохранён. Нужные уведомления родителям отправлены.", en: "Lesson saved. The right alerts went to parents." },
  queued_ok: { uz: "Internet yo'q — dars shu qurilmada saqlandi va ulanish tiklanganda o'zi yuboriladi.", ru: "Нет интернета — урок сохранён на устройстве и отправится сам при подключении.", en: "No internet — the lesson is saved on this device and will send itself when you're back online." },
  queue_banner: { uz: "{n} ta dars internetni kutmoqda", ru: "{n} урок(ов) ждут интернета", en: "{n} lesson(s) waiting for internet" },
  retry: { uz: "Qayta yuborish", ru: "Отправить снова", en: "Send now" },
  finish_day: { uz: "Bugunni yakunlash", ru: "Завершить день", en: "Finish for today" },
  finish_day_sub: { uz: "Nima qilindi, nima qoldi — keyin ertalabgacha ish xabarlari kelmaydi.", ru: "Что сделано, что осталось — и до утра без рабочих сообщений.", en: "What's done, what's left — then no work messages until morning." },
  check_and_finish: { uz: "Tekshirish va yakunlash", ru: "Проверить и завершить", en: "Check and finish" },
  ck_attendance: { uz: "Davomat", ru: "Посещаемость", en: "Attendance" },
  ck_topic: { uz: "Mavzu yozilgan", ru: "Тема записана", en: "Topic written" },
  ck_after_lesson: { uz: "«Dars tugadi» bajarilgan", ru: "«Урок окончен» заполнен", en: "\"After lesson\" done" },
  ck_tomorrow_cards: { uz: "Ertangi darslar uchun kartalar tayyor", ru: "Карточки на завтра готовы", en: "Tomorrow's lesson cards ready" },
  open_items_ok: { uz: "Qolgan ishlar ertaga ertalab eslatiladi — hozir bloklanmaydi.", ru: "Оставшееся напомним завтра утром — сейчас ничего не блокируется.", en: "Anything left is shown tomorrow morning — nothing blocks you now." },
  day_closed: { uz: "Ish kuningiz tugadi. Oilangiz bilan dam oling — ertalabgacha ish xabarlari kelmaydi.", ru: "Рабочий день окончен. Отдыхайте с семьёй — до утра рабочих сообщений не будет.", en: "Your work day is over. Enjoy your family — no work messages until morning." },
  closed_badge: { uz: "Kun yakunlangan", ru: "День завершён", en: "Day finished" },
  absence_banner: { uz: "Sinfingiz uchun {n} ta kelmaslik so'rovi kutmoqda.", ru: "Для вашего класса ждут {n} заявок об отсутствии.", en: "{n} absence report(s) for your class are waiting." },
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
