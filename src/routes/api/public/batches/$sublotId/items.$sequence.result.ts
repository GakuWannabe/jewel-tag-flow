import { createFileRoute } from "@tanstack/react-router";
import { cors, preflight } from "@/lib/cors.server";
import { z } from "zod";
import { botGuard, json } from "@/lib/bot-auth.server";

const Body = z.object({
  actual_ser_no: z.number().int().nullable().optional(),
  status: z.enum(["ok", "failed"]),
  error_message: z.string().max(2000).nullable().optional(),
});

export const Route = createFileRoute("/api/public/batches/$sublotId/items/$sequence/result")({
  server: {
    handlers: {
      OPTIONS: preflight,
      POST: cors(async ({ request, params }) => {
        const g = await botGuard(request, "bot", params.sublotId);
        if (g instanceof Response) return g;
        const seq = Number(params.sequence);
        if (!Number.isInteger(seq) || seq < 1) return json({ error: "Bad sequence" }, 400);
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Invalid body" }, 400);
        const b = parsed.data;
        const { data: sub } = await g.admin.from("sublots").select("status").eq("id", params.sublotId).single();
        if (!sub) return json({ error: "Sublot not found" }, 404);
        if (sub.status === "halted") return json({ error: "Sublot halted — stop", halt: true }, 409);
        const { data: item } = await g.admin.from("items").select("id,ser_no").eq("sublot_id", params.sublotId).eq("sequence", seq).is("deleted_at", null).maybeSingle();
        if (!item) return json({ error: "No item at that sequence" }, 404);
        const mismatch = b.status === "ok" && b.actual_ser_no != null && b.actual_ser_no !== item.ser_no;
        await g.admin.from("bot_results").insert({
          sublot_id: params.sublotId, sequence: seq, expected_ser_no: item.ser_no, actual_ser_no: b.actual_ser_no ?? null,
          status: b.status, error_message: b.error_message ?? null, mismatch, bot_client_id: g.bot.id,
        });
        if (b.actual_ser_no != null) await g.admin.from("items").update({ actual_ser_no: b.actual_ser_no }).eq("id", item.id);
        if (mismatch || b.status === "failed") {
          await g.admin.from("sublots").update({ status: "halted", halt_reason: mismatch ? "bot_mismatch" : "bot_failed" }).eq("id", params.sublotId);
          return json({ recorded: true, halt: true, expected_ser_no: item.ser_no, actual_ser_no: b.actual_ser_no }, 409);
        }
        return json({ recorded: true, halt: false });
      }),
    },
  },
});
