// ============================================================================
// Fake Message Batches API for tests (no real key, no cost, no network).
// Implements just what server/ai-worker.mjs uses:
//   POST /v1/messages/batches          create
//   GET  /v1/messages/batches/:id      retrieve (ended on the 2nd look)
//   GET  /v1/messages/batches/:id/results   JSONL results
// Answers follow the requested JSON schema (prep card / topic review).
// Usage: PORT=8799 node server/fake-anthropic.mjs
// ============================================================================
import http from "node:http";

const PORT = Number(process.env.PORT || 8799);
const BASE = `http://localhost:${PORT}`;
const batches = new Map();
let seq = 0;

function batchObject(b) {
  const ended = b.looks >= 1;
  return {
    id: b.id, type: "message_batch", processing_status: ended ? "ended" : "in_progress",
    request_counts: { processing: ended ? 0 : b.requests.length, succeeded: ended ? b.requests.length : 0, errored: 0, canceled: 0, expired: 0 },
    created_at: b.created, expires_at: new Date(Date.now() + 864e5).toISOString(),
    ended_at: ended ? new Date().toISOString() : null, cancel_initiated_at: null, archived_at: null,
    results_url: ended ? `${BASE}/v1/messages/batches/${b.id}/results` : null,
  };
}
function answer(req) {
  const text = req.params.messages[0].content;
  const topic = (/Mavzu: (.+)/.exec(text) ?? [])[1] ?? "Mavzu";
  const body = req.custom_id.startsWith("p-")
    ? { plan: `1) Takrorlash — 5 daq\n2) Yangi mavzu: ${topic} — 20 daq\n3) Juftlikda mashq — 15 daq\n4) Chiqish savollari — 5 daq`,
        homework: "Darslik, 3 ta misol", exit_questions: [`${topic}: 1-savol`, `${topic}: 2-savol`, `${topic}: 3-savol`] }
    : { title: `${topic} — takrorlash`, steps: ["Qoidani eslang.", "Oddiy misolni ko'ring.", "Har qadamni yozing.", "Javobni tekshiring.", "O'zingiz urinib ko'ring."],
        ...(/ildiz/i.test(topic) ? { example: "√49 = 7, chunki 7 × 7 = 49", try_it: "√81 = ?" }
                                  : { example: "1/2 + 1/4 = 2/4 + 1/4 = 3/4", try_it: "1/3 + 1/6 = ?" }) };
  if (req.params.messages[0].content.includes("REFUSE")) return { stop_reason: "refusal", content: [] };
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(body) }] };
}

http.createServer(async (req, res) => {
  let raw = ""; for await (const ch of req) raw += ch;
  const url = new URL(req.url, BASE);
  const json = (code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (req.method === "POST" && url.pathname === "/v1/messages/batches") {
    const { requests } = JSON.parse(raw);
    const b = { id: `msgbatch_fake${++seq}`, requests, looks: 0, created: new Date().toISOString() };
    batches.set(b.id, b);
    return json(200, batchObject(b));
  }
  let m = url.pathname.match(/^\/v1\/messages\/batches\/([\w]+)\/results$/);
  if (m && batches.has(m[1])) {
    const b = batches.get(m[1]);
    res.writeHead(200, { "content-type": "application/binary" });
    for (const r of b.requests) {
      const a = answer(r);
      res.write(JSON.stringify({ custom_id: r.custom_id, result: { type: "succeeded", message: {
        id: `msg_${r.custom_id}`, type: "message", role: "assistant", model: r.params.model, content: a.content,
        stop_reason: a.stop_reason, stop_sequence: null, stop_details: null,
        usage: { input_tokens: 1200, output_tokens: 450, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } }) + "\n");
    }
    return res.end();
  }
  m = url.pathname.match(/^\/v1\/messages\/batches\/([\w]+)$/);
  if (req.method === "GET" && m && batches.has(m[1])) {
    const b = batches.get(m[1]); const o = batchObject(b); b.looks++;
    return json(200, o);
  }
  json(404, { type: "error", error: { type: "not_found_error", message: "not found" } });
}).listen(PORT, () => console.log(`fake Anthropic batches on :${PORT}`));
