/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { botGuard, json, photoStatus } from "@/lib/bot-auth.server";

export const Route = createFileRoute("/api/public/photo/sublots/$sublotId/complete")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const g = await botGuard(request, "photo", params.sublotId);
        if (g instanceof Response) return g;
        const { data: s } = await g.admin.from("sublots").select("status").eq("id", params.sublotId).maybeSingle();
        if (!s) return json({ error: "Sublot not found" }, 404);
        if (s.status !== "photography") return json({ error: `Sublot is ${s.status}; not open for photography` }, 409);
        const { data: items } = await g.admin.from("items").select("sequence,photo_url,photo_skipped_at").eq("sublot_id", params.sublotId).is("deleted_at", null);
        const pending = (items ?? []).filter((i: any) => photoStatus(i) === "pending").map((i: any) => i.sequence);
        if (pending.length) return json({ error: "Items still pending", pending }, 409);
        await g.admin.from("sublots").update({ status: "ready_to_export", updated_at: new Date().toISOString() }).eq("id", params.sublotId).eq("status", "photography");
        return json({
          ok: true, status: "ready_to_export",
          done_count: (items ?? []).filter((i: any) => photoStatus(i) === "done").length,
          skipped_count: (items ?? []).filter((i: any) => photoStatus(i) === "skipped").length,
        });
      },
    },
  },
});
