export const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Map Postgres errors raised by our RPCs to HTTP codes the app understands. */
export function pgError(e: { code?: string; message?: string; hint?: string }) {
  const msg = e.message ?? "error";
  if (e.code === "42501") return json(403, { code: msg });
  if (msg === "limit_reached" || msg === "plan_not_allowed") {
    return json(402, { code: msg, hint: e.hint ?? "try_library" });
  }
  if (e.code === "22023" || e.code === "P0001") return json(400, { code: msg, hint: e.hint });
  return json(500, { code: "db_error" });     // never echo internals to the client
}
