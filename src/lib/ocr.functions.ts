import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Kind = "tags" | "huids";
interface Input { kind: Kind; dataUrl: string; mime: string; filename: string }

const PROMPTS: Record<Kind, string> = {
  tags:
    "This is a screenshot, photo or PDF from a jewellery ERP listing EMPTY / available tag serial numbers (column usually called ser_no). " +
    "Extract every tag serial number exactly as shown, as integers, in the order they appear. Do not invent numbers, do not fill gaps. " +
    "Ignore other columns (item codes, dates, weights).",
  huids:
    "This is a hallmarking centre delivery voucher. Extract every HUID: a 6-character code of uppercase letters and digits. " +
    "If a piece weight in grams is printed on the same line, return it, otherwise null. Keep the order printed. Do not invent values.",
};

const SCHEMAS: Record<Kind, Record<string, unknown>> = {
  tags: {
    type: "object", additionalProperties: false, required: ["numbers"],
    properties: { numbers: { type: "array", items: { type: "integer" } } },
  },
  huids: {
    type: "object", additionalProperties: false, required: ["rows"],
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["huid", "weight"],
          properties: { huid: { type: "string" }, weight: { type: ["number", "null"] } },
        },
      },
    },
  },
};

/** Reads tag numbers or HUIDs from an uploaded image/PDF. Signed-in users only. */
export const ocrExtract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Input) => {
    if (!d?.dataUrl?.startsWith("data:")) throw new Error("No file");
    if (d.dataUrl.length > 14_000_000) throw new Error("File too large (max ~10 MB)");
    if (d.kind !== "tags" && d.kind !== "huids") throw new Error("Bad kind");
    return d;
  })
  .handler(async ({ data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI reading is not configured");
    const isPdf = data.mime === "application/pdf";
    const media = isPdf
      ? { type: "input_file", filename: data.filename || "file.pdf", file_data: data.dataUrl }
      : { type: "input_image", image_url: data.dataUrl };
    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "fetch" },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        stream: true,
        store: false,
        reasoning: { effort: "low", summary: "auto" },
        include: ["reasoning.encrypted_content"],
        text: { format: { type: "json_schema", name: "extract", strict: true, schema: SCHEMAS[data.kind] } },
        input: [{ role: "user", content: [{ type: "input_text", text: PROMPTS[data.kind] }, media] }],
      }),
    });
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Too many requests — wait a moment and try again.");
      if (res.status === 402) throw new Error("AI credits are used up — ask the workspace owner to top up.");
      throw new Error(`Could not read the file (${res.status}). ${t.slice(0, 200)}`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", out = "", failed: string | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const p = line.slice(5).trim();
        if (!p || p === "[DONE]") continue;
        try {
          const ev = JSON.parse(p);
          if (ev.type === "response.output_text.delta") out += ev.delta ?? "";
          else if (ev.type === "response.failed" || ev.type === "error") failed = ev.response?.error?.message ?? ev.message ?? "AI error";
        } catch { /* ignore partial */ }
      }
    }
    if (!out) throw new Error(failed ?? "Nothing could be read from this file.");
    const parsed = JSON.parse(out);
    if (data.kind === "tags") return { numbers: (parsed.numbers ?? []) as number[], rows: [] as { huid: string; weight: number | null }[] };
    return { numbers: [] as number[], rows: (parsed.rows ?? []) as { huid: string; weight: number | null }[] };
  });
