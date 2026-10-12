/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { cors, preflight } from "@/lib/cors.server";
import { z } from "zod";
import { botGuard, json, PHOTO_BUCKET } from "@/lib/bot-auth.server";

const Body = z.object({ filenames: z.array(z.string().min(1).max(200)).min(1).max(5000) });

export const Route = createFileRoute("/api/public/batches/$sublotId/photos/confirm")({
  server: {
    handlers: {
      OPTIONS: preflight,
      POST: cors(async ({ request, params }) => {
        const g = await botGuard(request, "bot", params.sublotId);
        if (g instanceof Response) return g;
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Body must be { filenames: [...] }" }, 400);
        const now = new Date().toISOString();
        const { data: hit } = await g.admin.from("items").update({ photo_delivered_at: now })
          .eq("sublot_id", params.sublotId).is("deleted_at", null).not("photo_url", "is", null).is("photo_delivered_at", null)
          .in("photo_filename", parsed.data.filenames).select("id");
        const { data: all } = await g.admin.from("items").select("photo_url,photo_delivered_at").eq("sublot_id", params.sublotId).is("deleted_at", null).not("photo_url", "is", null);
        const remaining = (all ?? []).filter((i: any) => !i.photo_delivered_at).length;
        let deleted = 0;
        if (remaining === 0 && (all ?? []).length) {
          // every photo is in the ERP — remove the stored copies so storage stays near zero
          const { data: objs } = await g.admin.storage.from(PHOTO_BUCKET).list(params.sublotId, { limit: 1000 });
          const paths = (objs ?? []).map((o: any) => `${params.sublotId}/${o.name}`);
          if (paths.length) {
            const { data: rm, error } = await g.admin.storage.from(PHOTO_BUCKET).remove(paths);
            if (error) return json({ error: `Storage: ${error.message}` }, 500);
            deleted = rm?.length ?? 0;
          }
        }
        return json({ confirmed: hit?.length ?? 0, deleted, remaining });
      }),
    },
  },
});
