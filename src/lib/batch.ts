// Shared batch builder used by the manager export (browser) and the bot REST API (server).
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface BotRow {
  // ERP tab order — the bot replays these in exactly this order
  gross_weight: number; less_weight: number; melting: number; wastage_pct: number; narration: string;
  pcs: number; making_value: number; making_type: string; purity_label: string; vendor_code: string; huids: string[];
  // verification only
  sequence: number; compcode: string; type: string; ic: string; expected_ser_no: number;
  tray_code: string; compartment_no: number; photo_filename: string | null; has_photo: boolean;
}

export async function loadBatch(client: any, sublotId: string) {
  const { data: sublot, error } = await client
    .from("sublots")
    .select("*, product_types(*), vendors(*), purities(*), lots(*, branches(*), vendors(*), purities(*))")
    .eq("id", sublotId)
    .single();
  if (error || !sublot) throw new Error("Sublot not found");
  const { data: items } = await client
    .from("items")
    .select("*, tray_sessions(trays(tray_code)), item_huids(position, removed_at, huid_pool(huid))")
    .eq("sublot_id", sublotId)
    .is("deleted_at", null)
    .order("sequence", { ascending: true });
  const { data: slots } = await client.from("tag_slots").select("*").eq("sublot_id", sublotId).not("assigned_item_id", "is", null);
  const lot = sublot.lots;
  // pricing lives on the sublot; older sublots fall back to the lot
  const pick = (k: string) => sublot[k] ?? lot[k];
  const purity = sublot.purities ?? lot.purities;
  const vendor = sublot.vendors ?? lot.vendors;
  const rows: BotRow[] = (items ?? [])
    .filter((i: any) => i.sequence != null)
    .map((i: any) => ({
      gross_weight: Number(i.gross_weight),
      less_weight: Number(i.less_weight),
      melting: Number(pick("melting")),
      wastage_pct: Number(pick("wastage_pct")),
      narration: i.narration ?? "",
      pcs: i.pcs,
      making_value: Number(pick("making_value")),
      making_type: pick("making_type"),
      purity_label: purity?.purity_label ?? "",
      vendor_code: vendor?.code ?? "",
      huids: (i.item_huids ?? [])
        .filter((h: any) => !h.removed_at)
        .sort((a: any, b: any) => a.position - b.position)
        .map((h: any) => h.huid_pool.huid),
      sequence: i.sequence,
      compcode: i.compcode,
      type: i.type,
      ic: i.ic,
      expected_ser_no: i.ser_no,
      tray_code: i.tray_sessions?.trays?.tray_code,
      compartment_no: i.compartment_no,
      photo_filename: i.photo_filename ?? null,
      has_photo: !!i.photo_url,
    }));
  return { sublot, lot, items: items ?? [], slots: slots ?? [], rows };
}

/** Values for the configurable ERP-sheet mapping. */
export function fieldValue(field: string, row: BotRow, item: any): string | number | boolean | null {
  switch (field) {
    case "gross_weight": return row.gross_weight;
    case "less_weight": return row.less_weight;
    case "net_weight": return Number((row.gross_weight - row.less_weight).toFixed(3));
    case "narration": return row.narration;
    case "pcs": return row.pcs;
    case "purity_label": return row.purity_label;
    case "melting": return row.melting;
    case "making_value": return row.making_value;
    case "making_type": return row.making_type;
    case "wastage_pct": return row.wastage_pct;
    case "vendor_code": return row.vendor_code;
    case "huids": return row.huids.join(",");
    case "cat_a": return item.cat_a ?? "";
    case "cat_b": return item.cat_b ?? "";
    case "cat_c": return item.cat_c ?? "";
    case "stone_pcs": return item.stone_pcs ?? "";
    case "size": return item.size ?? "";
    case "photo_filename": return row.photo_filename ?? "";
    case "imgyesno": return row.has_photo ? "TRUE" : "FALSE";
    default: return null;
  }
}
