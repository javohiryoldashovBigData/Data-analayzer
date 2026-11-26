// ============================================================================
// Fake Telegram Bot API for tests (no token, no network, no real messages).
// Implements what server/telegram-worker.mjs uses: getUpdates, sendMessage.
// Test controls:  POST /test/update {message…}  queue an incoming update
//                 GET  /test/sent               messages the bot sent
//                 POST /test/reset
// chat_id 403 → "bot was blocked by the user"; chat_id 429 → rate limit.
// Usage: PORT=8798 node server/fake-telegram.mjs
// ============================================================================
import http from "node:http";

const PORT = Number(process.env.PORT || 8798);
let updates = [], sent = [], seq = 1000;

http.createServer(async (req, res) => {
  let raw = ""; for await (const ch of req) raw += ch;
  const body = raw ? JSON.parse(raw) : {};
  const json = (code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/test/update") { updates.push({ update_id: ++seq, message: body }); return json(200, { ok: true, update_id: seq }); }
  if (url.pathname === "/test/sent") return json(200, sent);
  if (url.pathname === "/test/reset") { updates = []; sent = []; return json(200, { ok: true }); }
  const m = url.pathname.match(/^\/bot([^/]+)\/(\w+)$/);
  if (!m) return json(404, { ok: false, error_code: 404, description: "Not Found" });
  if (m[2] === "getUpdates") {
    const offset = Number(body.offset || 0);
    updates = updates.filter((u) => u.update_id >= offset);                   // confirmed ones are forgotten
    return json(200, { ok: true, result: updates });
  }
  if (m[2] === "sendMessage") {
    if (String(body.chat_id) === "403") return json(403, { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" });
    if (String(body.chat_id) === "429") return json(429, { ok: false, error_code: 429, description: "Too Many Requests: retry after 7", parameters: { retry_after: 7 } });
    sent.push({ chat_id: body.chat_id, text: body.text, reply_markup: body.reply_markup ?? null });
    return json(200, { ok: true, result: { message_id: sent.length, chat: { id: body.chat_id }, text: body.text } });
  }
  json(404, { ok: false, error_code: 404, description: "Not Found: method" });
}).listen(PORT, () => console.log(`fake Telegram on :${PORT}`));
