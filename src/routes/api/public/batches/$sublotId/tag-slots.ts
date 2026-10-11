import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { botGuard, json } from "@/lib/bot-auth.server";

// Body: { headers: string[], rows: Array<Record<header, value>> } — the ERP sheet as JSON.
const Body = z.object({ headers: z.array(z.string()).min(1).max(300), rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000) });

export const Route = createFileRoute("/api/public/batches/$sublotId/tag-slots")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const g = await botGuard(request, "bot", params.sublotId);
        if (g instanceof Response) return g;
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
        const { headers, rows } = parsed.data;
        const col = (n: string) => headers.find((h) => h.toLowerCase() === n.toLowerCase()) ?? n;
        const seen = new Set<number>();
        const out = [];
        for (const r of rows) {
          const ser = Number(String(r[col("ser_no")] ?? "").trim());
          if (!Number.isInteger(ser) || ser <= 0) return json({ error: `Invalid ser_no ${String(r[col("ser_no")])}` }, 400);
          if (seen.has(ser)) return json({ error: `Duplicate ser_no ${ser}` }, 400);
          seen.add(ser);
          out.push({
            compcode: String(r[col("COMPCODE")] ?? "").trim(),
            type: String(r[col("type")] ?? "").trim().toUpperCase(),
            ic: String(r[col("IC")] ?? "").trim().toUpperCase(),
            ser_no: ser,
            cmd: String(r[col("cmd")] ?? "C").trim(),
            raw: r,
          });
        }
        const { data, error } = await g.admin.rpc("import_tag_slots", { p_sublot: params.sublotId, p_headers: headers, p_rows: out });
        if (error) return json({ error: error.message }, 409);
        const sers = [...seen].sort((a, b) => a - b);
        return json({ imported: data, min: sers[0], max: sers[sers.length - 1] });
      },
    },
  },
});
