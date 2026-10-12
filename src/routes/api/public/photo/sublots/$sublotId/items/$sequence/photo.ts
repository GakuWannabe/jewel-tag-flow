import { createFileRoute } from "@tanstack/react-router";
import { cors, preflight } from "@/lib/cors.server";
import { botGuard, json, photoStatus, PHOTO_BUCKET } from "@/lib/bot-auth.server";

const MAX = 12 * 1024 * 1024;

export const Route = createFileRoute("/api/public/photo/sublots/$sublotId/items/$sequence/photo")({
  server: {
    handlers: {
      OPTIONS: preflight,
      POST: cors(async ({ request, params }) => {
        const g = await botGuard(request, "photo", params.sublotId);
        if (g instanceof Response) return g;
        const seq = Number(params.sequence);
        if (!Number.isInteger(seq) || seq < 1) return json({ error: "Bad sequence" }, 400);
        const { data: s } = await g.admin.from("sublots").select("status").eq("id", params.sublotId).maybeSingle();
        if (!s) return json({ error: "Sublot not found" }, 404);
        if (s.status !== "photography") return json({ error: `Sublot is ${s.status}; not open for photography` }, 409);
        const { data: item } = await g.admin.from("items").select("id,photo_filename").eq("sublot_id", params.sublotId).eq("sequence", seq).is("deleted_at", null).maybeSingle();
        if (!item?.photo_filename) return json({ error: "No item at that sequence" }, 404);

        const form = await request.formData().catch(() => null);
        const file = form?.get("file");
        if (!file || typeof file === "string") return json({ error: "Missing file field" }, 400);
        if (file.type && !/^image\/jpe?g$/i.test(file.type)) return json({ error: "File must be image/jpeg" }, 415);
        if (file.size === 0) return json({ error: "Empty file" }, 400);
        if (file.size > MAX) return json({ error: "File larger than 12 MB" }, 413);

        // name is always the server-computed one; client filenames are ignored
        const path = `${params.sublotId}/${item.photo_filename}`;
        const { error: upErr } = await g.admin.storage.from(PHOTO_BUCKET).upload(path, await file.arrayBuffer(), { upsert: true, contentType: "image/jpeg" });
        if (upErr) return json({ error: `Storage: ${upErr.message}` }, 500);
        await g.admin.from("items").update({ photo_url: path, photo_matched_at: new Date().toISOString(), photo_skipped_at: null, photo_skip_reason: null, photo_delivered_at: null }).eq("id", item.id);

        const { data: all } = await g.admin.from("items").select("photo_url,photo_skipped_at").eq("sublot_id", params.sublotId).is("deleted_at", null);
        return json({ ok: true, filename: item.photo_filename, done_count: (all ?? []).filter((i: any) => photoStatus(i) === "done").length, total: (all ?? []).length });
      }),
    },
  },
});
