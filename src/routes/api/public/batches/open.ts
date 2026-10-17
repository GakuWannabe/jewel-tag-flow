import { createFileRoute } from "@tanstack/react-router";
import { cors, preflight } from "@/lib/cors.server";
import { botGuard, json } from "@/lib/bot-auth.server";

// Sublots waiting for the bot to tag them: sealed, not yet photographed.
export const Route = createFileRoute("/api/public/batches/open")({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: cors(async ({ request }) => {
        const g = await botGuard(request, "bot");
        if (g instanceof Response) return g;
        const { data, error } = await g.admin
          .from("sublots")
          .select("id,sublot_no,status,lot_type, lots(lot_no, branches(branch_code)), product_types(name,base_code), items(count)")
          .eq("status", "sealed")
          .is("deleted_at", null);
        if (error) return json({ error: error.message }, 500);
        const sublots = (data ?? [])
          .map((s: any) => ({
            sublot_id: s.id,
            lot_no: s.lots?.lot_no ?? "",
            sublot_no: s.sublot_no,
            product_name: s.product_types?.name ?? "",
            ic: `${s.lots?.branches?.branch_code ?? ""}${s.product_types?.base_code ?? ""}`,
            branch_code: s.lots?.branches?.branch_code ?? "",
            total_items: s.items?.[0]?.count ?? 0,
            status: s.status,
            lot_type: s.lot_type,
          }))
          .sort((a: any, b: any) => a.lot_no.localeCompare(b.lot_no) || a.sublot_no - b.sublot_no);
        return json({ sublots });
      }),
    },
  },
});
