import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;

/** Client that acts AS the caller: RLS and SECURITY INVOKER RPCs decide. */
export function userClient(authHeader: string): SupabaseClient {
  return createClient(URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

/** Service-role client: ONLY for app.ai_* service functions and ai_reservations bookkeeping. */
export function serviceClient(): SupabaseClient {
  return createClient(URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
    db: { schema: "public" },
  });
}

/** RPCs in schema "app" (expose "app" in PostgREST db-schemas, service role only). */
export function appSchema(db: SupabaseClient) {
  return db.schema("app");
}
