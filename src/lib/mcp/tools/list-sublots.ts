import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_sublots",
  title: "List sublots",
  description: "List sublots with product and workflow status, optionally for one lot or one status.",
  inputSchema: {
    lot_id: z.string().uuid().optional().describe("Only sublots of this lot (id from list_lots)."),
    status: z.string().max(40).optional().describe("Only sublots in this status, e.g. open, photography, ready_to_export, halted."),
    limit: z.number().int().min(1).max(200).default(50).describe("Maximum sublots to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ lot_id, status, limit }, ctx) => {
    const sb = supabaseForUser(ctx);
    let q = sb.from("sublots").select("id,sublot_no,status,lot_type,halt_reason,lots(lot_no),product_types(name),items(count)").is("deleted_at", null).order("created_at", { ascending: false }).limit(limit);
    if (lot_id) q = q.eq("lot_id", lot_id);
    if (status) q = q.eq("status", status as never);
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    const sublots = (data ?? []).map((s: any) => ({
      id: String(s.id), lot_no: String(s.lots?.lot_no ?? ""), sublot_no: Number(s.sublot_no),
      product: String(s.product_types?.name ?? ""), status: String(s.status), type: String(s.lot_type),
      items: Number(s.items?.[0]?.count ?? 0), halt_reason: s.halt_reason ? String(s.halt_reason) : null,
    }));
    const text = sublots.length ? sublots.map((s) => `${s.lot_no}/${s.sublot_no} ${s.product} — ${s.status}${s.halt_reason ? ` (${s.halt_reason})` : ""}, ${s.items} items [${s.id}]`).join("\n") : "No sublots.";
    return { content: [{ type: "text", text }], structuredContent: { sublots } };
  },
});
