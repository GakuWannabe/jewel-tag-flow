/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { cors, preflight } from "@/lib/cors.server";
import { botGuard, json, photoStatus } from "@/lib/bot-auth.server";

export const Route = createFileRoute("/api/public/photo/queue")({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: cors(async ({ request }) => {
        const g = await botGuard(request, "photo");
        if (g instanceof Response) return g;
        const { data: subs, error } = await g.admin.from("sublots")
          .select("id,sublot_no,sealed_at, lots(lot_no, branches(branch_code)), product_types(base_code,name)")
          .eq("status", "photography").is("deleted_at", null).order("updated_at", { ascending: true });
        if (error) return json({ error: error.message }, 500);
        const ids = (subs ?? []).map((s: any) => s.id);
        const { data: items } = ids.length
          ? await g.admin.from("items").select("sublot_id,compcode,photo_url,photo_skipped_at").in("sublot_id", ids).is("deleted_at", null)
          : { data: [] };
        return json({ sublots: (subs ?? []).map((s: any) => {
          const its = (items ?? []).filter((i: any) => i.sublot_id === s.id);
          return {
            sublot_id: s.id, lot_no: s.lots?.lot_no, sublot_no: s.sublot_no, branch_code: s.lots?.branches?.branch_code,
            ic: `${s.lots?.branches?.branch_code ?? ""}${s.product_types?.base_code ?? ""}`, product_name: s.product_types?.name,
            total_items: its.length,
            done_count: its.filter((i: any) => photoStatus(i) === "done").length,
            skipped_count: its.filter((i: any) => photoStatus(i) === "skipped").length,
            pending_count: its.filter((i: any) => photoStatus(i) === "pending").length,
            compcode: its.find((i: any) => i.compcode)?.compcode ?? null,
            sealed_at: s.sealed_at,
          };
        }) });
      }),
    },
  },
});
