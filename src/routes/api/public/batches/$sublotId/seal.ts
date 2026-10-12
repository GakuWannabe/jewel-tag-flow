import { createFileRoute } from "@tanstack/react-router";
import { cors, preflight } from "@/lib/cors.server";
import { botGuard, json } from "@/lib/bot-auth.server";

export const Route = createFileRoute("/api/public/batches/$sublotId/seal")({
  server: {
    handlers: {
      OPTIONS: preflight,
      POST: cors(async ({ request, params }) => {
        const g = await botGuard(request, "bot", params.sublotId);
        if (g instanceof Response) return g;
        const { data, error } = await g.admin.rpc("seal_sublot", { p_sublot: params.sublotId });
        if (error) return json({ error: error.message }, 409);
        return json({ sealed: true, items: data });
      }),
    },
  },
});
