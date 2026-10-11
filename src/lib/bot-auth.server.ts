/* eslint-disable @typescript-eslint/no-explicit-any */
async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const json = (body: unknown, status = 200) => Response.json(body, { status });

export type ClientKind = "bot" | "photo";

/**
 * Verifies the per-client API key (x-api-key header) and that the key's kind matches.
 * Returns admin client + client row, or an error Response.
 */
export async function botGuard(request: Request, kind: ClientKind, sublotId?: string): Promise<{ admin: any; bot: any } | Response> {
  const key = request.headers.get("x-api-key");
  if (!key) return json({ error: "Missing x-api-key" }, 401);
  if (sublotId !== undefined && !UUID.test(sublotId)) return json({ error: "Bad sublot id" }, 400);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: bot } = await supabaseAdmin.from("bot_clients").select("id,name,active,kind").eq("key_hash", await sha256Hex(key)).maybeSingle();
  if (!bot || !bot.active) return json({ error: "Invalid API key" }, 401);
  if (bot.kind !== kind) return json({ error: `This key is not allowed here (key type ${bot.kind})` }, 403);
  return { admin: supabaseAdmin, bot };
}

export const PHOTO_BUCKET = "item-photos";

/** Per-item photo status shared by the photo device API and the manager screen. */
export const photoStatus = (i: { photo_url: string | null; photo_skipped_at: string | null }) =>
  i.photo_url ? "done" : i.photo_skipped_at ? "skipped" : "pending";
