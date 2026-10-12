/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { cors, preflight } from "@/lib/cors.server";
import { botGuard, json, PHOTO_BUCKET } from "@/lib/bot-auth.server";

export const Route = createFileRoute("/api/public/batches/$sublotId/photos")({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: cors(async ({ request, params }) => {
        const g = await botGuard(request, "bot", params.sublotId);
        if (g instanceof Response) return g;
        const { data: items, error } = await g.admin.from("items").select("sequence,ser_no,photo_filename,photo_url,photo_delivered_at")
          .eq("sublot_id", params.sublotId).is("deleted_at", null).not("photo_url", "is", null).order("sequence");
        if (error) return json({ error: error.message }, 500);
        const list = items ?? [];
        const { data: signed } = list.length
          ? await g.admin.storage.from(PHOTO_BUCKET).createSignedUrls(list.map((i: any) => i.photo_url), 600)
          : { data: [] };
        return json(list.map((i: any, k: number) => ({
          sequence: i.sequence, ser_no: i.ser_no, filename: i.photo_filename, url: signed?.[k]?.signedUrl ?? null, delivered: !!i.photo_delivered_at,
        })));
      }),
    },
  },
});
