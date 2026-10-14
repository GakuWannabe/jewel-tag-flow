import * as XLSX from "xlsx";
import { hasConfusable, normHuid, validHuid } from "./huid-match";

export interface SlotRow { compcode: string; type: string; ic: string; ser_no: number; cmd: string; raw: Record<string, unknown> }
export interface SlotParse {
  headers: string[]; rows: SlotRow[]; errors: string[];
  count: number; min: number; max: number; gaps: number[];
}

async function readRows(file: File): Promise<unknown[][]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
}

/** Parse the ERP gap-list export. Each ser_no is its own row — never a range. */
export async function parseTagSlots(file: File, expect: { branch: string; baseCode: string }): Promise<SlotParse> {
  const aoa = await readRows(file);
  const headers = (aoa[0] ?? []).map((h) => String(h).trim());
  const idx = (n: string) => headers.findIndex((h) => h.toLowerCase() === n.toLowerCase());
  const iC = idx("COMPCODE"), iT = idx("type"), iI = idx("IC"), iS = idx("ser_no"), iCmd = idx("cmd");
  const errors: string[] = [];
  if ([iC, iT, iI, iS].some((i) => i < 0)) errors.push("Missing one of the required columns: COMPCODE, type, IC, ser_no");
  const rows: SlotRow[] = [];
  const seen = new Set<number>();
  for (const r of aoa.slice(1)) {
    if (!r || r.every((c) => c === "" || c == null)) continue;
    const ser = Number(String(r[iS]).trim());
    if (!Number.isInteger(ser) || ser <= 0) { errors.push(`Invalid ser_no "${r[iS]}"`); continue; }
    if (seen.has(ser)) { errors.push(`Duplicate ser_no ${ser}`); continue; }
    seen.add(ser);
    const raw: Record<string, unknown> = {};
    headers.forEach((h, i) => { raw[h] = r[i] ?? ""; });
    rows.push({
      compcode: String(r[iC]).trim(), type: String(r[iT]).trim().toUpperCase(), ic: String(r[iI]).trim().toUpperCase(),
      ser_no: ser, cmd: iCmd >= 0 ? String(r[iCmd]).trim() : "C", raw,
    });
  }
  if (rows.length) {
    const k = (x: SlotRow) => `${x.compcode}|${x.type}|${x.ic}`;
    if (new Set(rows.map(k)).size > 1) errors.push("Mixed file: COMPCODE, type and IC are not identical on every row");
    const f = rows[0];
    if (f.type !== expect.branch) errors.push(`type "${f.type}" does not match the lot's branch "${expect.branch}"`);
    if (!f.ic.startsWith(expect.branch)) errors.push(`IC "${f.ic}" does not begin with branch letter "${expect.branch}"`);
    if (f.ic.slice(1) !== expect.baseCode) errors.push(`IC "${f.ic}" minus branch letter is "${f.ic.slice(1)}", but this sublot's product is "${expect.baseCode}"`);
  } else errors.push("No rows found");
  const sers = rows.map((r) => r.ser_no).sort((a, b) => a - b);
  const min = sers[0] ?? 0, max = sers[sers.length - 1] ?? 0;
  const gaps: number[] = [];
  for (let i = 1; i < sers.length; i++) for (let g = sers[i - 1] + 1; g < sers[i]; g++) gaps.push(g);
  return { headers, rows, errors, count: rows.length, min, max, gaps };
}

export interface HuidRow { huid: string; weight: number | null; confusable: boolean; error?: string }
export async function parseHuids(file: File): Promise<{ rows: HuidRow[]; errors: string[] }> {
  const aoa = await readRows(file);
  let start = 0, iH = 0, iW = 1;
  const head = (aoa[0] ?? []).map((h) => String(h).toLowerCase());
  if (head.some((h) => h.includes("huid"))) {
    start = 1;
    iH = head.findIndex((h) => h.includes("huid"));
    iW = head.findIndex((h) => h.includes("weight") || h === "wt" || h.includes("wt"));
  }
  const rows: HuidRow[] = []; const errors: string[] = []; const seen = new Set<string>();
  for (const r of aoa.slice(start)) {
    if (!r || r.every((c) => c === "" || c == null)) continue;
    const huid = normHuid(String(r[iH] ?? ""));
    const w = iW >= 0 && r[iW] !== "" ? Number(r[iW]) : null;
    const row: HuidRow = { huid, weight: w != null && !Number.isNaN(w) ? w : null, confusable: hasConfusable(huid) };
    if (!validHuid(huid)) row.error = "Must be exactly 6 letters/digits";
    else if (seen.has(huid)) row.error = "Duplicate within file";
    seen.add(huid);
    if (row.error) errors.push(`${huid || "(blank)"}: ${row.error}`);
    rows.push(row);
  }
  return { rows, errors };
}

export interface ManualSlotRow extends SlotRow { assumed: boolean }
export interface ManualSlotParse extends Omit<SlotParse, "rows"> { rows: ManualSlotRow[]; assumedCount: number; givenMax: number }

/** Parse a typed list like "66-79, 81-108, 110-128". If `need` exceeds the list, continue from the highest given number — those are ASSUMED free. */
export function parseTagList(text: string, ctx: { branch: string; baseCode: string; compcode?: string; need?: number }): ManualSlotParse {
  const errors: string[] = [];
  const nums: number[] = [];
  const seen = new Set<number>();
  for (const tok of text.split(/[\s,;]+/).filter(Boolean)) {
    const m = tok.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) { errors.push(`"${tok}" is not a number or range`); continue; }
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    if (a <= 0 || b < a) { errors.push(`Range "${tok}" is invalid`); continue; }
    if (b - a > 5000) { errors.push(`Range "${tok}" is too large`); continue; }
    for (let n = a; n <= b; n++) { if (seen.has(n)) errors.push(`Duplicate ser_no ${n}`); else { seen.add(n); nums.push(n); } }
  }
  const sorted = [...nums].sort((x, y) => x - y);
  const givenMax = sorted[sorted.length - 1] ?? 0;
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) for (let g = sorted[i - 1] + 1; g < sorted[i]; g++) gaps.push(g);
  const compcode = ctx.compcode ?? "A", type = ctx.branch, ic = `${ctx.branch}${ctx.baseCode}`;
  const mk = (ser_no: number, assumed: boolean): ManualSlotRow => ({ compcode, type, ic, ser_no, cmd: "C", assumed, raw: { COMPCODE: compcode, type, IC: ic, ser_no, cmd: "C" } });
  const rows = sorted.map((n) => mk(n, false));
  let assumedCount = 0;
  if (ctx.need != null && sorted.length && rows.length < ctx.need) {
    for (let n = givenMax + 1; rows.length < ctx.need; n++) { rows.push(mk(n, true)); assumedCount++; }
  }
  if (!rows.length) errors.push("No tag numbers entered");
  const all = rows.map((r) => r.ser_no);
  return { headers: [], rows, errors, count: rows.length, min: all[0] ?? 0, max: all[all.length - 1] ?? 0, gaps, assumedCount, givenMax };
}
