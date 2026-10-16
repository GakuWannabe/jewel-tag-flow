/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Camera, FileText, FileSpreadsheet, Keyboard, Pencil, X, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ocrExtract } from "@/lib/ocr.functions";
import { parseTagSlots, parseHuids, type SlotParse } from "@/lib/imports";
import { rpc, errMsg, fmt3 } from "@/lib/db";
import { hasConfusable, normHuid, validHuid } from "@/lib/huid-match";
import { cn } from "@/lib/utils";
import type { StepProps } from "./steps-tray";

export const fileToDataUrl = (f: File) =>
  new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f); });

function UploadTile({ icon: Icon, label, sub, accept, onFile, disabled }: { icon: typeof Camera; label: string; sub: string; accept: string; onFile: (f: File) => void; disabled?: boolean }) {
  return (
    <label className={cn("flex min-h-24 cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-primary bg-card p-4 active:bg-accent", disabled && "pointer-events-none opacity-50")}>
      <Icon className="h-9 w-9 shrink-0 text-primary" />
      <div><div className="text-lg font-bold">{label}</div><div className="text-sm text-muted-foreground">{sub}</div></div>
      <input type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </label>
  );
}

function gapsOf(nums: number[]) {
  const s = [...nums].sort((a, b) => a - b); const g: number[] = [];
  for (let i = 1; i < s.length; i++) for (let x = s[i - 1] + 1; x < s[i]; x++) g.push(x);
  return { min: s[0], max: s[s.length - 1], gaps: g };
}

/* ---------------- STEP 1 · TAG NUMBERS ---------------- */
export function TagStep({ snap, refresh, locked, go }: StepProps) {
  const ocr = useServerFn(ocrExtract);
  const [nums, setNums] = useState<number[] | null>(null);
  const [excel, setExcel] = useState<SlotParse | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<number | null>(null);
  const [editVal, setEditVal] = useState("");
  const [add, setAdd] = useState("");

  const onFile = async (f: File) => {
    setBusy(true);
    try {
      if (/\.(xlsx|xls|csv)$/i.test(f.name)) {
        const p = await parseTagSlots(f, { branch: snap.sublot.branch_code, baseCode: snap.sublot.base_code });
        if (p.errors.length) toast.error(p.errors.slice(0, 3).join("\n"), { duration: 10000 });
        setExcel(p); setNums(p.rows.map((r) => r.ser_no));
      } else {
        const r = await ocr({ data: { kind: "tags", dataUrl: await fileToDataUrl(f), mime: f.type || "image/jpeg", filename: f.name } });
        const list = [...new Set(r.numbers.filter((n) => Number.isInteger(n) && n > 0))];
        setExcel(null); setNums(list);
        toast[list.length ? "success" : "error"](list.length ? `Read ${list.length} numbers — please check each one` : "No numbers found in this file");
      }
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const save = async () => {
    if (!nums?.length) return;
    if (new Set(nums).size !== nums.length) return toast.error("The same number appears twice");
    try {
      if (excel && !excel.errors.length && excel.rows.length) {
        const t = excel.rows[0];
        const rows = nums.map((n, i) => { const src = excel.rows[i] ?? t; return { compcode: src.compcode, type: src.type, ic: src.ic, ser_no: n, cmd: src.cmd, raw: { ...src.raw, ser_no: n } }; });
        await rpc("import_tag_slots", { p_sublot: snap.sublot.id, p_headers: excel.headers, p_rows: rows });
      } else {
        await rpc("import_tag_numbers", { p_sublot: snap.sublot.id, p_ser_nos: nums });
      }
      toast.success(`${nums.length} tag numbers saved`);
      setNums(null); setExcel(null); await refresh();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const list = nums ?? snap.tagNumbers;
  const info = list.length ? gapsOf(list) : null;
  const reviewing = nums != null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-warning p-3 text-sm font-semibold text-warning-foreground">
        Get the next tag numbers for <b>{snap.sublot.branch_code}{snap.sublot.base_code}</b> from the ERP right before you start. Numbers used by other counters since then will cause a mismatch.
      </div>

      {!locked && (
        <div className="grid gap-3 sm:grid-cols-3">
          <UploadTile icon={Camera} label="Screenshot / photo" sub="Read numbers from an image" accept="image/*" onFile={onFile} disabled={busy} />
          <UploadTile icon={FileText} label="PDF" sub="Read numbers from a PDF" accept="application/pdf" onFile={onFile} disabled={busy} />
          <UploadTile icon={FileSpreadsheet} label="EMPTY FORMAT sheet" sub="Excel from the ERP (ser_no column)" accept=".xlsx,.xls,.csv" onFile={onFile} disabled={busy} />
        </div>
      )}
      {busy && <p className="flex items-center gap-2 text-lg font-semibold"><Loader2 className="h-6 w-6 animate-spin" /> Reading the file…</p>}

      {excel?.errors.length ? <div className="rounded-lg bg-destructive p-3 text-destructive-foreground"><b>This sheet can't be used:</b><ul className="list-disc pl-5">{excel.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul></div> : null}

      {list.length > 0 && info && (
        <div className="space-y-3 rounded-xl border-2 bg-card p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-lg font-bold">{reviewing ? "Check the numbers" : "Saved tag numbers"}</span>
            <span className="num rounded bg-muted px-2 py-1 text-sm">{list.length} numbers · {info.min} → {info.max}</span>
            {info.gaps.length > 0 && <span className="num rounded bg-warning px-2 py-1 text-sm text-warning-foreground">Skipped: {info.gaps.slice(0, 20).join(", ")}{info.gaps.length > 20 ? "…" : ""}</span>}
          </div>
          {reviewing && <p className="text-sm text-muted-foreground">Tap the pencil to fix a number that was read wrong. Tap ✕ to remove it.</p>}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8">
            {list.map((n, i) => (
              <div key={`${n}-${i}`} className="flex items-center gap-1 rounded-lg border-2 bg-background p-1">
                {reviewing && edit === i ? (
                  <>
                    <Input autoFocus inputMode="numeric" className="num h-10 px-1 text-lg" value={editVal} onChange={(e) => setEditVal(e.target.value.replace(/\D/g, ""))} />
                    <button type="button" className="rounded bg-success p-2 text-success-foreground" onClick={() => { const v = Number(editVal); if (v > 0) setNums(list.map((x, j) => (j === i ? v : x))); setEdit(null); }}><Check className="h-4 w-4" /></button>
                  </>
                ) : (
                  <>
                    <span className="num flex-1 text-center text-lg font-bold">{n}</span>
                    {reviewing && <>
                      <button type="button" aria-label="Edit" className="rounded p-1.5 hover:bg-accent" onClick={() => { setEdit(i); setEditVal(String(n)); }}><Pencil className="h-4 w-4" /></button>
                      <button type="button" aria-label="Remove" className="rounded p-1.5 text-destructive hover:bg-accent" onClick={() => setNums(list.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button>
                    </>}
                    {!reviewing && !locked && (
                      <button type="button" aria-label={`Remove ${n}`} className="rounded p-1.5 text-destructive hover:bg-accent" onClick={async () => {
                        if (!confirm(`Remove tag number ${n}?`)) return;
                        try { await rpc("clear_tag_slots", { p_sublot: snap.sublot.id, p_ser_no: n }); await refresh(); } catch (e) { toast.error(errMsg(e)); }
                      }}><X className="h-4 w-4" /></button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          {reviewing && (
            <>
              <div className="flex gap-2">
                <Input inputMode="numeric" className="num h-12" placeholder="Add a missing number" value={add} onChange={(e) => setAdd(e.target.value.replace(/\D/g, ""))} />
                <Button variant="outline" className="h-12" onClick={() => { const v = Number(add); if (v > 0) { setNums([...list, v].sort((a, b) => a - b)); setAdd(""); } }}>Add</Button>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="h-14 flex-1" onClick={() => { setNums(null); setExcel(null); }}>Cancel</Button>
                <Button className="h-14 flex-[2] text-lg" disabled={!!excel?.errors.length} onClick={() => void save()}>Numbers are correct — save {list.length}</Button>
              </div>
            </>
          )}
        </div>
      )}
      {!reviewing && !locked && snap.tagNumbers.length > 0 && (
        <Button variant="outline" className="h-12 w-full text-destructive" onClick={async () => {
          if (!confirm(`Clear all ${snap.tagNumbers.length} tag numbers? Products keep their place; numbers are re-assigned automatically when a new list is imported or at seal.`)) return;
          try { await rpc("clear_tag_slots", { p_sublot: snap.sublot.id, p_ser_no: null }); toast.success("Tag numbers cleared"); await refresh(); } catch (e) { toast.error(errMsg(e)); }
        }}>Clear all tag numbers</Button>
      )}
      {!reviewing && snap.tagNumbers.length > 0 && <Button className="h-16 w-full text-xl" onClick={() => go("load")}>Next: Load tray →</Button>}
      {!reviewing && snap.tagNumbers.length === 0 && !busy && <p className="rounded-lg border-2 border-dashed p-6 text-center text-muted-foreground">No tag numbers yet. Upload one of the three above.</p>}
    </div>
  );
}

/* ---------------- STEP 4 · HUID LIST ---------------- */
interface Row { huid: string; weight: number | null }
export function HuidListStep({ snap, refresh, locked, go }: StepProps) {
  const ocr = useServerFn(ocrExtract);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [source, setSource] = useState("manual");
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const [edit, setEdit] = useState<number | null>(null);
  const [editVal, setEditVal] = useState("");
  const [dupes, setDupes] = useState<Record<string, string>>({});

  const total = snap.pool.length, left = snap.pool.filter((p) => !p.assigned_item_id).length;

  const onPhoto = async (f: File) => {
    setBusy(true);
    try {
      if (/\.(xlsx|xls|csv)$/i.test(f.name)) {
        const r = await parseHuids(f); setSource("import");
        setRows([...(rows ?? []), ...r.rows.map((x) => ({ huid: x.huid, weight: x.weight }))]);
      } else {
        const r = await ocr({ data: { kind: "huids", dataUrl: await fileToDataUrl(f), mime: f.type || "image/jpeg", filename: f.name } });
        setSource("ocr");
        setRows([...(rows ?? []), ...r.rows.map((x) => ({ huid: normHuid(x.huid), weight: x.weight }))]);
        toast[r.rows.length ? "success" : "error"](r.rows.length ? `Read ${r.rows.length} HUIDs — please check each one` : "No HUIDs found");
      }
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const addTyped = () => {
    const h = normHuid(typed);
    if (!validHuid(h)) return toast.error("HUID must be exactly 6 letters/digits");
    if ((rows ?? []).some((r) => r.huid === h) || snap.pool.some((p) => p.huid === h)) return toast.error(`${h} is already in the list`);
    setRows([...(rows ?? []), { huid: h, weight: null }]); setTyped("");
  };

  const problems = (r: Row, i: number) => {
    if (!validHuid(r.huid)) return "Must be 6 letters/digits";
    if ((rows ?? []).findIndex((x) => x.huid === r.huid) !== i) return "Twice in list";
    if (snap.pool.some((p) => p.huid === r.huid)) return "Already added";
    if (dupes[r.huid]) return dupes[r.huid];
    return null;
  };

  const save = async () => {
    if (!rows?.length) return;
    try {
      const found = await rpc<any[]>("check_huids", { p_huids: rows.map((r) => r.huid) });
      if (found?.length) {
        const d: Record<string, string> = {};
        for (const x of found) d[x.huid] = `Used in lot ${x.lot_no} #${x.sublot_no}`;
        setDupes(d); return toast.error("Some HUIDs already exist — fix the red ones");
      }
      if (rows.some((r, i) => problems(r, i))) return toast.error("Fix the red rows first");
      const n = await rpc<number>("import_huids", { p_sublot: snap.sublot.id, p_rows: rows.map((r) => ({ huid: r.huid, weight: r.weight, source })) });
      toast.success(`${n} HUIDs added`); setRows(null); setDupes({}); await refresh();
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-lg">
        <span className="num rounded-lg bg-card px-3 py-2 font-bold">{total} HUIDs in list</span>
        <span className="num rounded-lg bg-sidebar-primary px-3 py-2 font-bold text-sidebar-primary-foreground">{left} not matched yet</span>
      </div>

      {!locked && (
        <div className="grid gap-3 sm:grid-cols-2">
          <UploadTile icon={Camera} label="Photo of voucher" sub="Read all HUIDs from the hallmarking voucher" accept="image/*,application/pdf" onFile={onPhoto} disabled={busy} />
          <UploadTile icon={FileSpreadsheet} label="Excel / CSV list" sub="Columns HUID, weight" accept=".xlsx,.xls,.csv" onFile={onPhoto} disabled={busy} />
          <div className="rounded-xl border-2 bg-card p-3 sm:col-span-2">
            <div className="mb-2 flex items-center gap-2 font-bold"><Keyboard className="h-5 w-5" /> Type HUIDs one by one</div>
            <div className="flex gap-2">
              <Input className="num h-14 text-2xl uppercase tracking-widest" maxLength={6} placeholder="ABC123" value={typed}
                onChange={(e) => setTyped(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter") addTyped(); }} />
              <Button className="h-14 px-6 text-lg" onClick={addTyped}>Add</Button>
            </div>
          </div>
        </div>
      )}
      {busy && <p className="flex items-center gap-2 text-lg font-semibold"><Loader2 className="h-6 w-6 animate-spin" /> Reading the voucher…</p>}

      {rows && rows.length > 0 && (
        <div className="space-y-3 rounded-xl border-2 bg-card p-3">
          <div className="text-lg font-bold">Check before saving · {rows.length} HUIDs</div>
          <p className="text-sm text-muted-foreground">Yellow = easily confused letters (0/O, 1/I, 5/S, 8/B, 2/Z). Tap the pencil to fix.</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r, i) => {
              const bad = problems(r, i);
              return (
                <div key={i} className={cn("flex items-center gap-2 rounded-lg border-2 p-2", bad ? "border-destructive bg-destructive/10" : hasConfusable(r.huid) ? "border-warning bg-warning/20" : "")}>
                  <span className="num w-7 text-sm text-muted-foreground">{i + 1}</span>
                  {edit === i ? (
                    <>
                      <Input autoFocus maxLength={6} className="num h-11 flex-1 text-xl uppercase" value={editVal} onChange={(e) => setEditVal(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
                      <button type="button" className="rounded bg-success p-2 text-success-foreground" onClick={() => { setRows(rows.map((x, j) => (j === i ? { ...x, huid: normHuid(editVal) } : x))); setEdit(null); }}><Check className="h-5 w-5" /></button>
                    </>
                  ) : (
                    <>
                      <div className="flex-1">
                        <div className="num text-xl font-bold tracking-wider">{r.huid || "—"}</div>
                        <div className="text-xs">{r.weight != null ? `${fmt3(r.weight)} g` : ""}{bad ? <span className="font-bold text-destructive"> {bad}</span> : null}</div>
                      </div>
                      <button type="button" aria-label="Edit" className="rounded p-2 hover:bg-accent" onClick={() => { setEdit(i); setEditVal(r.huid); }}><Pencil className="h-5 w-5" /></button>
                      <button type="button" aria-label="Remove" className="rounded p-2 text-destructive hover:bg-accent" onClick={() => setRows(rows.filter((_, j) => j !== i))}><X className="h-5 w-5" /></button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="h-14 flex-1" onClick={() => { setRows(null); setDupes({}); }}>Cancel</Button>
            <Button className="h-14 flex-[2] text-lg" onClick={() => void save()}>All correct — save {rows.length} HUIDs</Button>
          </div>
        </div>
      )}

      {!rows && total > 0 && (
        <details className="rounded-xl border bg-card p-3">
          <summary className="cursor-pointer font-semibold">See saved HUIDs ({total})</summary>
          <div className="num mt-2 grid grid-cols-3 gap-1 text-sm sm:grid-cols-6">
            {snap.pool.map((p) => {
              const it = p.assigned_item_id ? snap.items.find((i) => i.id === p.assigned_item_id) : null;
              return (
                <span key={p.id} className={cn("flex items-center justify-between gap-1 rounded px-2 py-1", p.assigned_item_id ? "bg-success text-success-foreground" : "bg-muted")}>
                  {p.huid}
                  {p.assigned_item_id ? <span className="text-xs">{it ? `${snap.tray.tray_code}-${String(it.compartment_no).padStart(2, "0")}` : "other tray"}</span>
                    : !locked && (
                      <button type="button" aria-label={`Delete ${p.huid}`} className="rounded p-1 hover:bg-destructive hover:text-destructive-foreground"
                        onClick={async () => {
                          if (!confirm(`Delete HUID ${p.huid} from the list?`)) return;
                          try { await rpc("delete_pool_huid", { p_huid_pool_id: p.id, p_reason: "removed at tray station (entered wrongly)" }); toast.success(`${p.huid} deleted`); await refresh(); }
                          catch (e) { toast.error(errMsg(e)); }
                        }}><X className="h-3 w-3" /></button>
                    )}
                </span>
              );
            })}
          </div>
        </details>
      )}
      {!rows && total > 0 && <Button className="h-16 w-full text-xl" onClick={() => go("match")}>Next: Match HUIDs to products →</Button>}
    </div>
  );
}
