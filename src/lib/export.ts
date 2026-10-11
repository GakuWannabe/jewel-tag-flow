/* eslint-disable @typescript-eslint/no-explicit-any */
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { db } from "./db";
import { fieldValue, loadBatch } from "./batch";
import type { MapRow } from "./settings";
import { ERP_HEADERS } from "./erp-template";

export async function buildSheet(sublotId: string, mapping: MapRow[]) {
  const b = await loadBatch(db, sublotId);
  const stored: string[] | null = b.sublot.slot_headers;
  const headers: string[] = stored && stored.length >= ERP_HEADERS.length ? stored : ERP_HEADERS;
  const itemById = new Map(b.items.map((i: any) => [i.id, i]));
  const slotByItem = new Map(b.slots.map((s: any) => [s.assigned_item_id, s]));
  const aoa: unknown[][] = [headers];
  for (const row of b.rows) {
    const item: any = b.items.find((i: any) => i.sequence === row.sequence);
    const slot: any = slotByItem.get(item.id);
    const base: Record<string, unknown> = { ...(slot?.raw ?? {}) };
    base[findCol(headers, "cmd")] = "C";
    for (const m of mapping) {
      const col = findCol(headers, m.column);
      base[col] = fieldValue(m.field, row, itemById.get(item.id));
    }
    aoa.push(headers.map((h) => base[h] ?? ""));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return { buf, batch: b };
}

function findCol(headers: string[], name: string) {
  return headers.find((h) => h === name) ?? headers.find((h) => h.toLowerCase() === name.toLowerCase()) ?? name;
}

/** Manual ZIP: filled sheet, batch.json, manifest.json and photos/ (already ERP-named by the photo app). */
export async function buildManualZip(
  sublotId: string, mapping: MapRow[], userName: string,
  links: { filename: string; url: string | null }[], onProgress?: (n: number, t: number) => void,
) {
  const { buf, batch } = await buildSheet(sublotId, mapping);
  const zip = new JSZip();
  const base = `${batch.lot.lot_no}-S${batch.sublot.sublot_no}`;
  zip.file(`${base}.xlsx`, buf);
  zip.file("batch.json", JSON.stringify(batch.rows, null, 2));
  const [{ data: tg }, { data: rem }] = await Promise.all([
    db.from("sublot_targets").select("*").eq("sublot_id", sublotId).maybeSingle(),
    db.from("item_removals").select("tray_code,compartment_no,gross_weight,less_weight,net_weight,pcs,huids,reason,removed_at,removed_by").eq("sublot_id", sublotId).order("removed_at"),
  ]);
  const removals = rem ?? [];
  zip.file("manifest.json", JSON.stringify({
    lot_no: batch.lot.lot_no, sublot_no: batch.sublot.sublot_no, item_count: batch.rows.length,
    pcs_total: batch.rows.reduce((a, r) => a + r.pcs, 0),
    huid_count: batch.rows.reduce((a, r) => a + r.huids.length, 0),
    photo_count: batch.rows.filter((r) => r.has_photo).length,
    photo_gaps: batch.items.filter((i: any) => !i.photo_url && i.photo_skipped_at).map((i: any) => ({ sequence: i.sequence, filename: i.photo_filename, reason: i.photo_skip_reason })),
    items_removed: removals.length > 0,
    declared: tg ? { tags: tg.declared_tags, pieces: tg.declared_pieces, net_weight: Number(tg.declared_net_weight) } : null,
    removed: tg ? { tags: tg.removed_tags, pieces: tg.removed_pieces, net_weight: Number(tg.removed_net_weight) } : null,
    removals,
    generated_at: new Date().toISOString(), generated_by: userName,
  }, null, 2));
  const folder = zip.folder("photos")!;
  const ok = links.filter((l) => l.url);
  let n = 0;
  for (const l of ok) {
    const res = await fetch(l.url!);
    if (!res.ok) throw new Error(`Photo download failed: ${l.filename}`);
    folder.file(l.filename, await res.arrayBuffer(), { compression: "STORE" }); // stored as-is
    onProgress?.(++n, ok.length);
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  return { blob, name: `${base}-export.zip` };
}

export function downloadBlob(blob: Blob | ArrayBuffer, name: string) {
  const b = blob instanceof Blob ? blob : new Blob([blob]);
  const url = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
