/* eslint-disable @typescript-eslint/no-explicit-any */
async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Verifies the per-bot API key (x-api-key header). Returns admin client + bot, or an error Response. */
export async function botGuard(request: Request, sublotId: string): Promise<{ admin: any; bot: any } | Response> {
  const key = request.headers.get("x-api-key");
  if (!key) return json({ error: "Missing x-api-key" }, 401);
  if (!UUID.test(sublotId)) return json({ error: "Bad sublot id" }, 400);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: bot } = await supabaseAdmin.from("bot_clients").select("id,name,active").eq("key_hash", await sha256Hex(key)).maybeSingle();
  if (!bot || !bot.active) return json({ error: "Invalid API key" }, 401);
  return { admin: supabaseAdmin, bot };
}
