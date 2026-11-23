import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_lots",
  title: "List lots",
  description: "List recent lots (lot number, branch, received date, open/closed) visible to the signed-in user.",
  inputSchema: {
    status: z.enum(["open", "closed", "all"]).default("open").describe("Which lots to list."),
    limit: z.number().int().min(1).max(100).default(30).describe("Maximum lots to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, limit }, ctx) => {
    const sb = supabaseForUser(ctx);
    let q = sb.from("lots").select("id,lot_no,received_date,closed_at,branches(branch_code,name)").is("deleted_at", null).order("created_at", { ascending: false }).limit(limit);
    if (status === "open") q = q.is("closed_at", null);
    if (status === "closed") q = q.not("closed_at", "is", null);
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    const lots = (data ?? []).map((l: any) => ({
      id: String(l.id), lot_no: String(l.lot_no), branch: String(l.branches?.branch_code ?? ""),
      received_date: String(l.received_date), closed: l.closed_at != null,
    }));
    const text = lots.length ? lots.map((l) => `${l.branch} ${l.lot_no} — received ${l.received_date}${l.closed ? " (closed)" : ""} [${l.id}]`).join("\n") : "No lots.";
    return { content: [{ type: "text", text }], structuredContent: { lots } };
  },
});
