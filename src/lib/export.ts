/* eslint-disable @typescript-eslint/no-explicit-any */
import * as XLSX from "xlsx";
import JSZip from "jszip";
import Papa from "papaparse";
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

export function renameMapCsv(batch: Awaited<ReturnType<typeof loadBatch>>) {
  const lotNo = batch.lot.lot_no;
  const rows = batch.rows.map((r) => {
    const item: any = batch.items.find((i: any) => i.sequence === r.sequence);
    return {
      old_filename: item.source_photo_name ?? `${lotNo}-${r.tray_code}-${String(r.compartment_no).padStart(2, "0")}.jpg`,
      new_filename: r.photo_filename ?? "",
      tray: r.tray_code, compartment: r.compartment_no, ser_no: r.expected_ser_no,
    };
  });
  return Papa.unparse(rows);
}

export async function addPhotos(zip: JSZip, batch: Awaited<ReturnType<typeof loadBatch>>, onProgress?: (n: number, total: number) => void) {
  const folder = zip.folder("photos")!;
  const list = batch.items.filter((i: any) => i.photo_url && i.photo_filename);
  let n = 0;
  for (const i of list as any[]) {
    const { data, error } = await db.storage.from("photos").download(i.photo_url);
    if (error) throw new Error(`Photo download failed: ${i.photo_url}`);
    folder.file(i.photo_filename, await data.arrayBuffer(), { compression: "STORE" }); // as-is, no recompression
    onProgress?.(++n, list.length);
  }
}

export async function buildManualZip(sublotId: string, mapping: MapRow[], userName: string, onProgress?: (n: number, t: number) => void) {
  const { buf, batch } = await buildSheet(sublotId, mapping);
  const zip = new JSZip();
  const base = `${batch.lot.lot_no}-S${batch.sublot.sublot_no}`;
  zip.file(`${base}.xlsx`, buf);
  zip.file("batch.json", JSON.stringify(batch.rows, null, 2));
  zip.file("manifest.json", JSON.stringify({
    lot_no: batch.lot.lot_no, sublot_no: batch.sublot.sublot_no, item_count: batch.rows.length,
    pcs_total: batch.rows.reduce((a, r) => a + r.pcs, 0),
    huid_count: batch.rows.reduce((a, r) => a + r.huids.length, 0),
    photo_count: batch.rows.filter((r) => r.photo_filename).length,
    generated_at: new Date().toISOString(), generated_by: userName,
  }, null, 2));
  zip.file("rename_map.csv", renameMapCsv(batch));
  await addPhotos(zip, batch, onProgress);
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  return { blob, name: `${base}-export.zip` };
}

export async function buildRenamedPhotoZip(sublotId: string, onProgress?: (n: number, t: number) => void) {
  const batch = await loadBatch(db, sublotId);
  const zip = new JSZip();
  zip.file("rename_map.csv", renameMapCsv(batch));
  await addPhotos(zip, batch, onProgress);
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  return { blob, name: `${batch.lot.lot_no}-S${batch.sublot.sublot_no}-photos.zip` };
}

export function downloadBlob(blob: Blob | ArrayBuffer, name: string) {
  const b = blob instanceof Blob ? blob : new Blob([blob]);
  const url = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
