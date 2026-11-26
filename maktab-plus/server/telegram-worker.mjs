// ============================================================================
// MAKTAB+ Telegram worker (step 8a) — the only process that holds the bot token.
//  1. reads bot updates (long polling; no public URL needed for a pilot):
//       /start <token>  → connect the person who made the link in the web app
//       /start          → welcome + "share my phone" button
//       contact         → connect if it is the sender's OWN phone and exactly
//                         one Maktab+ person has it
//       /stop           → disconnect
//  2. delivers the notification outbox (quiet hours are already decided by the
//     database: the worker only takes rows whose deliver_after has passed).
// Plain text only (no HTML/Markdown parsing → nothing can be injected).
// Env: DATABASE_SERVICE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_API_BASE (tests),
//      APP_URL (optional link under each message)
// Usage: node server/telegram-worker.mjs once | loop
// ============================================================================
import pg from "pg";

const API = process.env.TELEGRAM_API_BASE || "https://api.telegram.org";
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const APP_URL = process.env.APP_URL || "";
if (!TOKEN) { console.error("TELEGRAM_BOT_TOKEN is not set"); process.exit(2); }
const db = new pg.Pool({ connectionString: process.env.DATABASE_SERVICE_URL, max: 3 });
const q = async (sql, params) => (await db.query(sql, params)).rows;

async function tg(method, body) {
  try {
    const r = await fetch(`${API}/bot${TOKEN}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return await r.json();
  } catch (e) {
    return { ok: false, error_code: 0, description: `network: ${e.message}` };
  }
}

// ---------------------------------------------------------------- texts
const L = (lang) => (lang === "ru" || lang === "en" ? lang : "uz");
const BOT = {
  welcome: { uz: "Assalomu alaykum! Bu Maktab+ boti.\nMaktab xabarlarini shu yerda olish uchun telefon raqamingizni yuboring (pastdagi tugma).",
             ru: "Здравствуйте! Это бот Maktab+.\nЧтобы получать сообщения школы здесь, отправьте свой номер телефона (кнопка ниже).",
             en: "Hello! This is the Maktab+ bot.\nTo get school messages here, share your phone number (button below)." },
  share:   { uz: "📱 Telefon raqamni yuborish", ru: "📱 Отправить номер", en: "📱 Share my phone number" },
  linked:  { uz: "Rahmat, {n}! Endi maktab xabarlari shu yerga keladi. To'xtatish: /stop",
             ru: "Спасибо, {n}! Теперь сообщения школы будут приходить сюда. Остановить: /stop",
             en: "Thank you, {n}! School messages will now come here. To stop: /stop" },
  bad_token: { uz: "Bu havola eskirgan yoki ishlatilgan. Ilovada \"Telegram'ni ulash\" tugmasini qayta bosing.",
               ru: "Ссылка устарела или уже использована. Нажмите «Подключить Telegram» в приложении ещё раз.",
               en: "This link has expired or was already used. Tap \"Connect Telegram\" in the app again." },
  not_own: { uz: "Iltimos, faqat o'zingizning raqamingizni yuboring (pastdagi tugma orqali).",
             ru: "Пожалуйста, отправьте только свой номер (кнопкой ниже).",
             en: "Please share only your own number (with the button below)." },
  unknown_phone: { uz: "Bu raqam maktab ro'yxatida topilmadi. Maktab ma'muriyatiga murojaat qiling yoki ilova orqali ulang.",
                   ru: "Этот номер не найден в списке школы. Обратитесь в администрацию школы или подключитесь через приложение.",
                   en: "This number was not found in the school's list. Ask the school office, or connect from the app." },
  stopped: { uz: "Xabarlar to'xtatildi. Qayta ulash: /start", ru: "Сообщения остановлены. Снова подключить: /start", en: "Messages stopped. Connect again: /start" },
};
const fill = (s, v = {}) => Object.entries(v).reduce((a, [k, x]) => a.replaceAll(`{${k}}`, String(x ?? "")), s);
const time = (ts) => new Date(ts).toLocaleTimeString("en-GB", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" });
const day = (d) => String(d).slice(0, 10).split("-").reverse().join(".");

// One message per outbox row. `f` = app.tg_message_facts(). Names only from our DB.
export function render(f) {
  const lang = L(f.lang), p = f.payload ?? {}, d = f.details !== false;
  const child = d && f.child ? f.child : { uz: "Farzandingiz", ru: "Ваш ребёнок", en: "Your child" }[lang];
  const T = {
    gate_in:  { uz: `✅ ${child} maktabga keldi — ${time(p.scanned_at)}`, ru: `✅ ${child} пришёл(а) в школу — ${time(p.scanned_at)}`, en: `✅ ${child} arrived at school — ${time(p.scanned_at)}` },
    gate_out: { uz: `🏠 ${child} maktabdan chiqdi — ${time(p.scanned_at)}`, ru: `🏠 ${child} вышел(а) из школы — ${time(p.scanned_at)}`, en: `🏠 ${child} left school — ${time(p.scanned_at)}` },
    absence: p.status === "late"
      ? { uz: `⏰ ${child} ${day(p.date)} kuni ${p.period}-darsga kechikdi.`, ru: `⏰ ${child} опоздал(а) на ${p.period}-й урок (${day(p.date)}).`, en: `⏰ ${child} was late for lesson ${p.period} on ${day(p.date)}.` }
      : p.status === "excused"
      ? { uz: `📝 ${child} ${day(p.date)} kuni ${p.period}-darsda sababli yo'q deb belgilandi.`, ru: `📝 ${child}: отсутствие по уважительной причине, урок ${p.period} (${day(p.date)}).`, en: `📝 ${child}: excused absence, lesson ${p.period} on ${day(p.date)}.` }
      : { uz: `⚠️ ${child} ${day(p.date)} kuni ${p.period}-darsda yo'q. Agar bilmasangiz, maktabga yozing.`, ru: `⚠️ ${child} отсутствует на ${p.period}-м уроке (${day(p.date)}). Если вы не знали — напишите в школу.`, en: `⚠️ ${child} is absent from lesson ${p.period} on ${day(p.date)}. If you did not know, write to the school.` },
    skipped_lesson: { uz: `⚠️ ${child} maktabda, lekin ${p.period}-darsda yo'q (${day(p.date)}).`, ru: `⚠️ ${child} в школе, но отсутствует на ${p.period}-м уроке (${day(p.date)}).`, en: `⚠️ ${child} is at school but missed lesson ${p.period} (${day(p.date)}).` },
    grade_posted: d
      ? { uz: `⭐ ${child}: ${f.subject} — yangi baho ${p.value}`, ru: `⭐ ${child}: ${f.subject} — новая оценка ${p.value}`, en: `⭐ ${child}: ${f.subject} — new grade ${p.value}` }
      : { uz: "⭐ Yangi baho qo'yildi. Ilovada ko'ring.", ru: "⭐ Выставлена новая оценка. Смотрите в приложении.", en: "⭐ A new grade was posted. See it in the app." },
    fee_due: { uz: "💳 Eslatma: maktab to'lovi muddati o'tdi. Batafsil ilovada (To'lovlar). Savol bo'lsa, buxgalteriyaga yozing.",
               ru: "💳 Напоминание: срок оплаты школы прошёл. Подробнее в приложении («Оплаты»). Вопросы — в бухгалтерию.",
               en: "💳 Reminder: the school fee is past due. Details in the app (Payments). Questions? Write to the accounts office." },
    parent_message: { uz: `✉️ Ota-onadan yangi xabar: ${p.topic ?? ""}`, ru: `✉️ Новое сообщение от родителя: ${p.topic ?? ""}`, en: `✉️ New message from a parent: ${p.topic ?? ""}` },
  };
  const S = {
    topic_review_ready: { uz: `💡 Mavzuni takrorlash tayyor: ${p.topic ?? ""}. 5 daqiqa yetadi — ilovada.`, ru: `💡 Повторение темы готово: ${p.topic ?? ""}. Хватит 5 минут — в приложении.`, en: `💡 Topic review ready: ${p.topic ?? ""}. 5 minutes is enough — in the app.` },
    final_grades_confirmed: { uz: `📜 Yillik baholar tasdiqlandi${f.subject ? ` (${f.subject})` : ""}. Tabelni ilovada ko'ring.`, ru: `📜 Годовые оценки утверждены${f.subject ? ` (${f.subject})` : ""}. Табель в приложении.`, en: `📜 Yearly grades confirmed${f.subject ? ` (${f.subject})` : ""}. See the report card in the app.` },
    leader_role_changed: { uz: `🔐 Maktabda rahbar yoki buxgalter roli o'zgardi (${p.role}). Siz qilmagan bo'lsangiz, tekshiring.`, ru: `🔐 В школе изменилась роль руководителя или бухгалтера (${p.role}). Если это не вы — проверьте.`, en: `🔐 A leader or accountant role changed at the school (${p.role}). If this was not you, check it.` },
  };
  const t = f.kind === "system" ? S[f.event] : T[f.kind];
  const text = (t ? t[lang] : { uz: "🔔 Maktabdan yangi xabar. Ilovani oching.", ru: "🔔 Новое сообщение из школы. Откройте приложение.", en: "🔔 New message from the school. Open the app." }[lang]);
  return [f.school ? `${f.school}\n` : "", text, APP_URL ? `\n${APP_URL}` : ""].join("");
}

// ---------------------------------------------------------------- 1. bot updates
async function handle(u) {
  const m = u.message;
  if (!m || m.chat?.type !== "private" || !m.from) return;          // never in groups
  const chat = m.chat.id, lang = L((m.from.language_code || "uz").slice(0, 2)), say = (k, v) => fill(BOT[k][lang], v);
  const text = (m.text || "").trim();
  if (m.contact) {
    if (m.contact.user_id !== m.from.id) return tg("sendMessage", { chat_id: chat, text: say("not_own") });
    const name = (await q("select app.tg_link_by_phone($1, $2, $3, $4) as n", [m.contact.phone_number, chat, m.from.id, lang]))[0].n;
    return tg("sendMessage", { chat_id: chat, text: name ? say("linked", { n: name }) : say("unknown_phone"), reply_markup: { remove_keyboard: true } });
  }
  if (/^\/start(\s|$)/.test(text)) {
    const token = text.split(/\s+/)[1];
    if (token) {
      const name = /^[a-f0-9]{64}$/.test(token) ? (await q("select app.tg_link_by_token($1, $2, $3, $4) as n", [token, chat, m.from.id, lang]))[0].n : null;
      if (name) return tg("sendMessage", { chat_id: chat, text: say("linked", { n: name }) });
      await tg("sendMessage", { chat_id: chat, text: say("bad_token") });
    }
    return tg("sendMessage", { chat_id: chat, text: say("welcome"),
      reply_markup: { keyboard: [[{ text: say("share"), request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
  }
  if (/^\/stop(\s|$)/.test(text)) {
    await q("select app.tg_unlink_chat($1)", [chat]);
    return tg("sendMessage", { chat_id: chat, text: say("stopped"), reply_markup: { remove_keyboard: true } });
  }
}
export async function pollUpdates() {
  const offset = Number((await q("select value from telegram_state where key = 'offset'"))[0]?.value ?? 0);
  const r = await tg("getUpdates", { offset, timeout: 0, allowed_updates: ["message"] });
  if (!r.ok) return 0;
  for (const u of r.result) {
    try { await handle(u); } catch (e) { console.error("update", u.update_id, e.message); }
    await q("insert into telegram_state (key, value) values ('offset', $1) on conflict (key) do update set value = excluded.value", [String(u.update_id + 1)]);
  }
  return r.result.length;
}

// ---------------------------------------------------------------- 2. deliver the outbox
export async function deliver() {
  const rows = await q("select id, attempts from app.outbox_claim(200)");
  const out = { sent: 0, no_channel: 0, retry: 0, failed: 0 };
  for (const row of rows) {
    const f = (await q("select app.tg_message_facts($1) as f", [row.id]))[0].f;
    if (!f?.chat_id) {
      await q("update notification_outbox set status = 'no_channel', processed_at = now() where id = $1", [row.id]); out.no_channel++; continue;
    }
    const r = await tg("sendMessage", { chat_id: f.chat_id, text: render(f), disable_web_page_preview: true });
    if (r.ok) {
      await q("update notification_outbox set status = 'sent', processed_at = now() where id = $1", [row.id]); out.sent++;
    } else if (r.error_code === 403 || r.error_code === 400 && /chat not found/i.test(r.description)) {
      await q("select app.tg_unlink_chat($1)", [f.chat_id]);                 // blocked the bot / chat gone
      await q("update notification_outbox set status = 'no_channel', processed_at = now() where id = $1", [row.id]); out.no_channel++;
    } else if (row.attempts < 5) {
      const wait = r.error_code === 429 ? Number(r.parameters?.retry_after ?? 30) : 60 * 2 ** row.attempts;   // seconds
      await q("update notification_outbox set status = 'pending', held_reason = 'retry', deliver_after = now() + make_interval(secs => $2) where id = $1", [row.id, wait]);
      out.retry++;
    } else {
      await q("update notification_outbox set status = 'failed', processed_at = now(), held_reason = $2 where id = $1", [row.id, String(r.description ?? "error").slice(0, 200)]);
      out.failed++;
    }
    await new Promise((res) => setTimeout(res, 40));                           // ≤ 25 messages/second (Telegram limit 30)
  }
  return out;
}

export async function runOnce() {
  const updates = await pollUpdates();
  const d = await deliver();
  return { updates, ...d };
}

if (process.argv[1]?.endsWith("telegram-worker.mjs")) {
  const mode = process.argv[2] || "once";
  if (mode === "once") { console.log(JSON.stringify(await runOnce())); await db.end(); }
  else for (;;) { try { await runOnce(); } catch (e) { console.error(e.message); } await new Promise((r) => setTimeout(r, 5000)); }
}
