/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Camera, CheckCircle2, FileSpreadsheet, Keyboard, Loader2, Pencil, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TraySwitcher } from "../TraySwitcher";
import { Legend } from "../TrayGrid";
import { useSync } from "@/lib/offline";
import { db, rpc, errMsg, fmt3 } from "@/lib/db";
import { ocrExtract } from "@/lib/ocr.functions";
import { parseHuids } from "@/lib/imports";
import { hasConfusable, normHuid, validHuid } from "@/lib/huid-match";
import { HOLD_LABEL, type HoldFlag, type Item } from "@/lib/types";
import { cn } from "@/lib/utils";
import { pad, huidsDone, sortedItems, Grid, type StepProps, type Snap, type Station } from "./shared";

const fileToDataUrl = (f: File) =>
  new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f); });

/* ---------------- HUID ---------------- */
export function HuidStep({ snap, run, refresh, locked, go }: StepProps) {
  const items = sortedItems(snap);
  const byComp = new Map(items.map((i) => [i.compartment_no, i]));
  const [sel, setSel] = useState<number | null>(() => items.find((i) => !huidsDone(snap, i))?.compartment_no ?? items[0]?.compartment_no ?? null);
  const matched = items.filter((i) => huidsDone(snap, i)).length;
  const item = sel != null ? byComp.get(sel) : undefined;
  const next = (after: number) => (items.find((i) => i.compartment_no > after && !huidsDone(snap, i)) ?? items.find((i) => i.compartment_no !== after && !huidsDone(snap, i)))?.compartment_no ?? null;
  return <div className="space-y-4">
    <TraySwitcher snap={snap} step="huid" />
    <HuidPool snap={snap} refresh={refresh} locked={locked} />
    <BulkEntry snap={snap} run={run} locked={locked} />
    <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div className="space-y-3">
        <p className="num text-lg font-bold">HUIDs {matched} / {items.length}</p>
        <Grid snap={snap} selected={sel} onTap={(n) => byComp.has(n) && setSel(n)}
          stateOf={(n) => { const i = byComp.get(n); return !i ? "empty" : i.hold_flag ? "hold" : huidsDone(snap, i) ? "huid" : "loaded"; }}
          sub={(n) => { const i = byComp.get(n); return i ? (snap.itemHuids[i.id] ?? []).join(" ") || `${i.pcs} HUID${i.pcs === 1 ? "" : "s"}` : null; }} />
        <Legend only={["loaded", "huid", "hold"]} />
        {items.length > 0 && matched === items.length && <Button className="h-16 w-full text-xl" onClick={() => go("finish")}>Next: Finish →</Button>}
      </div>
      <div>{item ? <div className="space-y-3">
        <h3 className="num text-3xl font-extrabold">{snap.tray.tray_code}-{pad(item.compartment_no)} · {item.pcs} pcs</h3>
        <HuidPicker key={item.id + (snap.itemHuids[item.id]?.join() ?? "")} item={item} snap={snap} locked={locked} run={run} onDone={() => setSel(next(item.compartment_no))} />
      </div> : <p className="p-4 text-muted-foreground">{items.length ? "Every product has its HUIDs." : "Load the tray first."}</p>}</div>
    </div>
  </div>;
}

function BulkEntry({ snap, run, locked }: { snap: Snap; run: Station["run"]; locked: boolean }) {
  const [text, setText] = useState("");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState<string[]>([]);
  const tokens = text.toUpperCase().split(/[\s,;]+/).filter(Boolean);
  const remaining = sortedItems(snap).filter((i) => !huidsDone(snap, i));
  const slots = remaining.flatMap((i) => Array.from({ length: Math.max(0, i.pcs - (snap.itemHuids[i.id]?.length ?? 0)) }, () => i));
  const rows = tokens.map((h, index) => {
    const pool = snap.pool.find((p) => p.huid === h);
    const item = slots[index];
    const problem = !validHuid(h) ? "Invalid HUID" : tokens.indexOf(h) !== index ? "Duplicate" : !pool ? "Not in pool" : pool.assigned_item_id ? "Already assigned" : !item ? "No compartment available" : null;
    return { h, item, problem };
  });
  const groups = remaining.map((item) => ({ item, rows: rows.filter((r) => r.item?.id === item.id) })).filter((g) => g.rows.length);
  const complete = groups.every((g) => g.rows.length + (snap.itemHuids[g.item.id]?.length ?? 0) === g.item.pcs);
  const commit = async () => {
    if (!rows.length || rows.some((r) => r.problem) || !complete || busy || locked) return;
    setBusy(true);
    try {
      for (const g of groups) {
        const hs = [...(snap.itemHuids[g.item.id] ?? []), ...g.rows.map((r) => r.h)];
        await run("assign_item_huids", { p_item: g.item.id, p_huids: hs }, `Bulk HUID ${snap.tray.tray_code}-${g.item.compartment_no}`, g.item.id);
        setCommitted((old) => [...old, g.item.id]);
      }
      toast.success("Bulk HUIDs saved"); setText(""); setReview(false); setCommitted([]);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return <section className="space-y-3 border-y py-4">
    <h3 className="text-xl font-bold">Bulk entry</h3>
    <textarea aria-label="Bulk HUIDs" className="num min-h-28 w-full rounded-md border-2 bg-background p-3 text-lg uppercase" placeholder="Paste or scan HUIDs" disabled={locked || busy} value={text} onChange={(e) => { setText(e.target.value); setReview(false); setCommitted([]); }} />
    <Button variant="outline" className="h-12" disabled={locked || busy || !tokens.length} onClick={() => setReview(true)}>Review matches</Button>
    {review && <div className="space-y-2">
      {rows.map((r, i) => <div key={i} className={cn("flex flex-wrap justify-between gap-2 border-b py-2 font-bold", r.problem ? "text-destructive" : "text-success")}><span className="num">{r.h}</span><span>{r.problem ?? `Matched → ${snap.tray.tray_code}-${pad(r.item?.compartment_no ?? 0)}`}</span></div>)}
      {!complete && <p className="font-bold text-destructive">Include all HUIDs needed for each selected compartment.</p>}
      {!!committed.length && <p className="text-warning">{committed.length} compartments saved. Review remaining entries before retrying.</p>}
      <Button className="h-14 w-full text-lg" disabled={locked || busy || !!committed.length || !rows.length || rows.some((r) => r.problem) || !complete} onClick={() => void commit()}>{busy ? "Saving…" : "Assign reviewed HUIDs"}</Button>
    </div>}
  </section>;
}

/* HUID matching for one compartment — weight suggestions + search + manual. */
function HuidPicker({ item, snap, locked, run, onDone }: { item: Item; snap: Snap; locked: boolean; run: Station["run"]; onDone: () => void }) {
  const { status } = useSync();
  const current = snap.itemHuids[item.id] ?? [];
  const [picked, setPicked] = useState<string[]>(current);
  const [q, setQ] = useState("");
  const [manual, setManual] = useState("");
  const committing = useRef(false);
  const free = useMemo(() => snap.pool.filter((p) => !p.assigned_item_id), [snap.pool]);
  const online = status !== "offline";
  const [suggestions, setSuggestions] = useState<string[][]>([]);
  useEffect(() => {
    if (!online || current.length || item.net_weight == null) { setSuggestions([]); return; }
    let live = true;
    void db.rpc("suggest_huids", { p_item: item.id }).then(({ data }: any) => { if (live) setSuggestions((data ?? []).map((r: any) => r.huids)); });
    return () => { live = false; };
  }, [item.id, item.net_weight, item.pcs, online, current.length, free.length]);
  const [found, setFound] = useState<string[] | null>(null);
  useEffect(() => {
    if (!online) { setFound(null); return; }
    let live = true;
    const t = setTimeout(() => {
      void db.rpc("suggest_huids", { p_item: item.id, p_fragment: q }).then(({ data, error }: any) => { if (live) setFound(error ? null : (data ?? []).map((r: any) => r.huids[0])); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [item.id, q, online, free.length]);
  const list = useMemo(() => {
    const src = found ?? free.filter((p) => !q || p.huid.includes(q)).map((p) => p.huid);
    return src.filter((h) => !picked.includes(h));
  }, [found, free, q, picked]);

  const commit = async (h: string[]) => {
    if (locked || committing.current || h.length !== item.pcs || new Set(h).size !== h.length) return;
    committing.current = true;
    try {
    await run("assign_item_huids", { p_item: item.id, p_huids: h }, `HUID ${snap.tray.tray_code}-${item.compartment_no}`, item.id);
    toast.success(`${snap.tray.tray_code}-${pad(item.compartment_no)} → ${h.join(", ")}`);
    onDone();
    } catch (e) { toast.error(errMsg(e)); } finally { committing.current = false; }
  };
  const pick = (h: string) => {
    if (locked || committing.current || picked.includes(h)) return;
    const nextP = [...picked, h];
    if (nextP.length >= item.pcs) void commit(nextP.slice(0, item.pcs)); else setPicked(nextP);
  };
  const addManual = async () => {
    const h = normHuid(manual);
    if (!validHuid(h)) return toast.error("HUID must be 6 letters/digits");
    if (picked.includes(h)) return toast.error("Same HUID twice on one tag");
    const local = snap.pool.find((p) => p.huid === h);
    if (local?.assigned_item_id) return toast.error("Already used on another product");
    if (!local && status !== "offline") {
      const { data } = await db.rpc("check_huids", { p_huids: [h] });
      if (data?.length) return toast.error(`${h} already exists (lot ${data[0].lot_no})`);
    }
    if (hasConfusable(h)) toast.warning("Check 0/O, 1/I, 5/S, 8/B, 2/Z");
    setManual(""); pick(h);
  };

  if (current.length === item.pcs) return (
    <div className="space-y-2 rounded-lg bg-success p-3 text-success-foreground">
      <div className="flex items-center gap-2 text-lg font-bold"><CheckCircle2 className="h-6 w-6" /> {current.join(" + ")}</div>
      {!locked && <div className="flex gap-2">
        <Button variant="secondary" className="h-12 flex-1" onClick={() => void run("unassign_item_huids", { p_item: item.id }, `Unassign ${item.compartment_no}`, item.id)}>Change HUIDs</Button>
        <Button variant="secondary" className="h-12 flex-1" onClick={onDone}>Next →</Button>
      </div>}
    </div>
  );

  return (
    <div className="space-y-3 border-t-2 pt-3">
      <div className="flex gap-2">
        {Array.from({ length: item.pcs }, (_, i) => (
          <button key={i} type="button" onClick={() => setPicked(picked.filter((_, j) => j !== i))}
            className={cn("num h-14 flex-1 rounded-lg border-2 text-xl font-bold", picked[i] ? "border-primary bg-primary text-primary-foreground" : "border-dashed bg-background text-muted-foreground")}>
            {picked[i] ? `${picked[i]} ✕` : `HUID ${i + 1}`}
          </button>
        ))}
      </div>
      {suggestions.length > 0 && picked.length === 0 && (
        <div>
          <div className="mb-1 text-sm font-bold uppercase text-muted-foreground">Best weight match</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {suggestions.map((hs) => (
              <button key={hs.join()} type="button" disabled={locked} onClick={() => void commit(hs)}
                className="rounded-lg border-2 border-primary bg-background p-2 text-left active:bg-accent">
                {hs.map((h) => <div key={h} className="num text-xl font-bold tracking-wider">{h}</div>)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
      <section className="space-y-2">
      <h3 className="font-bold">Search / pick from pool</h3>
      <Input className="num h-12 text-lg uppercase" placeholder="Search HUID (type any part)" value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} />
      <div className="grid max-h-[22rem] gap-2 overflow-auto xl:grid-cols-2">
        {list.map((h) => (
          <button key={h} type="button" disabled={locked} onClick={() => pick(h)}
            className="num flex flex-col items-start rounded-lg border-2 bg-background p-2 text-left active:bg-accent">
            <span className="text-xl font-bold tracking-wider">{h}</span>
          </button>
        ))}
        {list.length === 0 && <p className="col-span-full p-3 text-center text-muted-foreground">No free HUIDs{q ? " match" : " left"}.</p>}
      </div>
      </section>
      <section className="space-y-2">
        <h3 className="font-bold">Type HUID directly</h3>
        <div className="flex flex-wrap gap-2">
          <Input className="num h-12 min-w-0 uppercase" maxLength={6} placeholder="ABC123" disabled={locked} value={manual} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addManual(); } }} onChange={(e) => setManual(e.target.value.toUpperCase())} />
          <Button className="h-12" variant="outline" disabled={locked || !manual.trim()} onClick={() => void addManual()}>Add</Button>
        </div>
      </section>
      </div>
    </div>
  );
}

/* The sublot's HUID pool: photo of the hallmarking voucher, Excel/CSV, or typed. */
function HuidPool({ snap, refresh, locked }: { snap: Snap; refresh: () => Promise<void>; locked: boolean }) {
  const ocr = useServerFn(ocrExtract);
  const [rows, setRows] = useState<{ huid: string; weight: number | null }[] | null>(null);
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
  const problems = (r: { huid: string }, i: number) => {
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
    <details className="rounded-xl border-2 bg-card" open={total === 0}>
      <summary className="cursor-pointer p-3 font-bold">
        HUID list for this sublot · <span className="num">{total} in list · {left} not matched yet</span>
      </summary>
      <div className="space-y-3 border-t p-3">
        {!locked && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={cn("flex min-h-20 cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-primary bg-card p-3 active:bg-accent", busy && "pointer-events-none opacity-50")}>
              <Camera className="h-8 w-8 shrink-0 text-primary" />
              <div><div className="font-bold">Photo of voucher</div><div className="text-sm text-muted-foreground">Read all HUIDs from the hallmarking voucher</div></div>
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ""; }} />
            </label>
            <label className={cn("flex min-h-20 cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-primary bg-card p-3 active:bg-accent", busy && "pointer-events-none opacity-50")}>
              <FileSpreadsheet className="h-8 w-8 shrink-0 text-primary" />
              <div><div className="font-bold">Excel / CSV list</div><div className="text-sm text-muted-foreground">Columns HUID, weight</div></div>
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ""; }} />
            </label>
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
          <div className="space-y-3 rounded-xl border-2 bg-background p-3">
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
                          <div className="text-xs">{bad ? <span className="font-bold text-destructive"> {bad}</span> : null}</div>
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
      </div>
    </details>
  );
}
