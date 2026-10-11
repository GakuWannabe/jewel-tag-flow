/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "item-photos";
const UUID = /^[0-9a-f-]{36}$/i;

async function purge(prefixes: string[]) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let n = 0;
  for (const p of prefixes) {
    const { data } = await supabaseAdmin.storage.from(BUCKET).list(p, { limit: 1000 });
    const paths = (data ?? []).map((o: any) => `${p}/${o.name}`);
    if (paths.length) { await supabaseAdmin.storage.from(BUCKET).remove(paths); n += paths.length; }
  }
  return n;
}

/** Manager unseal: database rules + audit run as the user; then stored photos are removed. */
export const unsealSublot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sublotId: string; reason: string }) => {
    if (!UUID.test(d?.sublotId ?? "")) throw new Error("Bad sublot");
    if (!d.reason?.trim()) throw new Error("Reason required");
    return { sublotId: d.sublotId, reason: d.reason.trim().slice(0, 1000) };
  })
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("unseal_sublot", { p_sublot: data.sublotId, p_reason: data.reason });
    if (error) throw new Error(error.message);
    return { deleted: await purge([data.sublotId]) };
  });

/** Manager permanent lot delete, including its photos. */
export const deleteLot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { lotId: string; confirm: string }) => {
    if (!UUID.test(d?.lotId ?? "")) throw new Error("Bad lot");
    return { lotId: d.lotId, confirm: String(d.confirm ?? "") };
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: subs } = await sb.from("sublots").select("id").eq("lot_id", data.lotId);
    const { error } = await sb.rpc("delete_lot", { p_lot: data.lotId, p_confirm: data.confirm });
    if (error) throw new Error(error.message);
    return { deleted: await purge((subs ?? []).map((s: any) => s.id)) };
  });

/** Short-lived download links for the manager's manual export. */
export const photoLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sublotId: string }) => { if (!UUID.test(d?.sublotId ?? "")) throw new Error("Bad sublot"); return d; })
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: ok } = await sb.rpc("is_mgr_or_aud");
    if (!ok) throw new Error("Manager or auditor only");
    const { data: items } = await sb.from("items").select("photo_url,photo_filename").eq("sublot_id", data.sublotId).is("deleted_at", null).not("photo_url", "is", null);
    if (!items?.length) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrls(items.map((i: any) => i.photo_url), 600);
    return items.map((i: any, k: number) => ({ filename: i.photo_filename as string, url: signed?.[k]?.signedUrl ?? null }));
  });
