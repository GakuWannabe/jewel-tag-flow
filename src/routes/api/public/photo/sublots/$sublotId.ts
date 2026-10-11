/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { botGuard, json, photoStatus } from "@/lib/bot-auth.server";

// Never returns weights, piece weights or declared totals — the photo device must not see them.
export const Route = createFileRoute("/api/public/photo/sublots/$sublotId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const g = await botGuard(request, "photo", params.sublotId);
        if (g instanceof Response) return g;
        const { data: s } = await g.admin.from("sublots").select("id,sublot_no,status, lots(lot_no)").eq("id", params.sublotId).is("deleted_at", null).maybeSingle();
        if (!s) return json({ error: "Sublot not found" }, 404);
        if (!["photography", "ready_to_export"].includes(s.status)) return json({ error: `Sublot is ${s.status}; not open for photography` }, 409);
        const { data: items } = await g.admin.from("items")
          .select("sequence,compartment_no,ser_no,compcode,ic,photo_filename,pcs,photo_url,photo_skipped_at, tray_sessions(trays(tray_code,rows,columns))")
          .eq("sublot_id", params.sublotId).is("deleted_at", null).not("sequence", "is", null).order("sequence");
        const trays = new Map<string, any>();
        for (const i of items ?? []) { const t = i.tray_sessions?.trays; if (t && !trays.has(t.tray_code)) trays.set(t.tray_code, { tray_code: t.tray_code, rows: t.rows, columns: t.columns }); }
        const first = items?.[0];
        return json({
          sublot_id: s.id, lot_no: s.lots?.lot_no, sublot_no: s.sublot_no, compcode: first?.compcode ?? null, ic: first?.ic ?? null,
          trays: [...trays.values()],
          items: (items ?? []).map((i: any) => ({
            sequence: i.sequence, tray_code: i.tray_sessions?.trays?.tray_code, compartment_no: i.compartment_no, ser_no: i.ser_no,
            filename: i.photo_filename, pcs: i.pcs, status: photoStatus(i),
          })),
        });
      },
    },
  },
});
