import { createFileRoute } from "@tanstack/react-router";
import { botGuard, json } from "@/lib/bot-auth.server";

export const Route = createFileRoute("/api/public/batches/$sublotId/seal")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const g = await botGuard(request, "bot", params.sublotId);
        if (g instanceof Response) return g;
        const { data, error } = await g.admin.rpc("seal_sublot", { p_sublot: params.sublotId });
        if (error) return json({ error: error.message }, 409);
        return json({ sealed: true, items: data });
      },
    },
  },
});
