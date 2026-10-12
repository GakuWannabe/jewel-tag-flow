/* eslint-disable @typescript-eslint/no-explicit-any */
// CORS for /api/public/* — allowlist only, managed in Settings (key "cors_origins").
export const DEFAULT_CORS_ORIGINS = ["https://snap-jewel-stream.lovable.app", "http://localhost:5173"];

const TTL_MS = 30_000;
let cache: { at: number; list: string[] } | null = null;

async function allowedOrigins(): Promise<string[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.list;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("settings").select("value").eq("key", "cors_origins").maybeSingle();
    const list = Array.isArray(data?.value) ? (data!.value as unknown[]).map((o) => String(o).trim().replace(/\/+$/, "")).filter(Boolean) : DEFAULT_CORS_ORIGINS;
    cache = { at: Date.now(), list };
    return list;
  } catch {
    return cache?.list ?? DEFAULT_CORS_ORIGINS;
  }
}

/** CORS headers for this request, or {} when the Origin is not on the allowlist. */
async function corsHeaders(request: Request): Promise<Record<string, string>> {
  const origin = request.headers.get("origin");
  if (!origin || !(await allowedOrigins()).includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "x-api-key, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** OPTIONS preflight: 204, with CORS headers only for allowed origins. */
export async function preflight({ request }: { request: Request }) {
  return new Response(null, { status: 204, headers: await corsHeaders(request) });
}

/** Wraps a handler so EVERY response (success, error, crash) carries the CORS headers. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cors(handler: (ctx: any) => Promise<Response>) {
  return async (ctx: any): Promise<Response> => {
    let res: Response;
    try {
      res = await handler(ctx);
    } catch (e) {
      console.error(e);
      res = Response.json({ error: "Server error" }, { status: 500 });
    }
    const h = await corsHeaders(ctx.request);
    if (!Object.keys(h).length) return res;
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(h)) headers.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
