import { createFileRoute } from "@tanstack/react-router";
import { botGuard, json } from "@/lib/bot-auth.server";
import { loadBatch } from "@/lib/batch";

export const Route = createFileRoute("/api/public/batches/$sublotId/items")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const g = await botGuard(request, "bot", params.sublotId);
        if (g instanceof Response) return g;
        try {
          const b = await loadBatch(g.admin, params.sublotId);
          if (!["sealed", "exported"].includes(b.sublot.status)) return json({ error: `Sublot is ${b.sublot.status}; it must be sealed` }, 409);
          return json({ sublot_id: params.sublotId, lot_no: b.lot.lot_no, status: b.sublot.status, items: b.rows });
        } catch (e) {
          return json({ error: (e as Error).message }, 404);
        }
      },
    },
  },
});
