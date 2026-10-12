import { createFileRoute } from "@tanstack/react-router";
import { cors, preflight } from "@/lib/cors.server";
import { z } from "zod";
import { botGuard, json } from "@/lib/bot-auth.server";

const Body = z.object({ reason: z.string().trim().min(1).max(500) });

export const Route = createFileRoute("/api/public/photo/sublots/$sublotId/items/$sequence/skip")({
  server: {
    handlers: {
      OPTIONS: preflight,
      POST: cors(async ({ request, params }) => {
        const g = await botGuard(request, "photo", params.sublotId);
        if (g instanceof Response) return g;
        const seq = Number(params.sequence);
        if (!Number.isInteger(seq) || seq < 1) return json({ error: "Bad sequence" }, 400);
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Body must be { reason }" }, 400);
        const { data: s } = await g.admin.from("sublots").select("status").eq("id", params.sublotId).maybeSingle();
        if (!s) return json({ error: "Sublot not found" }, 404);
        if (s.status !== "photography") return json({ error: `Sublot is ${s.status}; not open for photography` }, 409);
        const { data: item } = await g.admin.from("items").select("id,photo_url").eq("sublot_id", params.sublotId).eq("sequence", seq).is("deleted_at", null).maybeSingle();
        if (!item) return json({ error: "No item at that sequence" }, 404);
        if (item.photo_url) return json({ error: "This item already has a photo" }, 409);
        const now = new Date().toISOString();
        await g.admin.from("items").update({ photo_skipped_at: now, photo_skip_reason: parsed.data.reason }).eq("id", item.id);
        await g.admin.from("photo_skips").insert({ item_id: item.id, sublot_id: params.sublotId, sequence: seq, reason: parsed.data.reason, device_id: g.bot.id });
        return json({ ok: true, sequence: seq, skipped_at: now });
      }),
    },
  },
});
