/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Camera, CheckCircle2, FileSpreadsheet, Keyboard, Loader2, Pencil, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Keypad } from "../Keypad";
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

/* ---------------- WEIGH + HUID ---------------- */
export function WeighStep({ snap, run, refresh, locked, go }: StepProps) {
  const items = sortedItems(snap);
  const byComp = new Map(items.map((i) => [i.compartment_no, i]));
  const firstOpen = items.find((i) => i.gross_weight == null || !huidsDone(snap, i))?.compartment_no ?? items[0]?.compartment_no ?? null;
  const [sel, setSel] = useState<number | null>(firstOpen);
  const started = useRef(false);
  useEffect(() => {
    if (!started.current && !locked && snap.session.station === "loading" && items.length) {
      started.current = true; void run("start_weighing", { p_session: snap.session.id }, "Start weighing");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!items.length) return <Button className="h-14 w-full" onClick={() => go("load")}>Load the tray first</Button>;

  const weighed = items.filter((i) => i.gross_weight != null).length;
  const matched = items.filter((i) => huidsDone(snap, i)).length;
  const allDone = weighed === items.length && matched === items.length;
  const next = (after: number) =>
    (items.find((i) => i.compartment_no > after && (i.gross_weight == null || !huidsDone(snap, i)))
      ?? items.find((i) => i.gross_weight == null || !huidsDone(snap, i)))?.compartment_no ?? null;
  const item = sel != null ? byComp.get(sel) : undefined;

  return (
    <div className="space-y-4">
      <HuidPool snap={snap} refresh={refresh} locked={locked} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="num text-lg font-bold">Weighed {weighed} / {items.length} · HUIDs {matched} / {items.length}</span>
            <span className="text-sm text-muted-foreground">Tap a compartment</span>
          </div>
          <Grid snap={snap} selected={sel} onTap={(n) => byComp.has(n) && setSel(n)}
            stateOf={(n) => { const i = byComp.get(n); if (!i) return "empty"; if (i.hold_flag) return "hold"; return huidsDone(snap, i) ? "huid" : i.gross_weight != null ? "weighed" : "loaded"; }}
            sub={(n) => { const i = byComp.get(n); if (!i) return null; return snap.itemHuids[i.id]?.join(" ") ?? (i.net_weight != null ? Number(i.net_weight).toFixed(3) : null); }} />
          <Legend only={["loaded", "weighed", "huid", "hold"]} />
          {allDone && <Button className="h-16 w-full text-xl" onClick={() => go("finish")}>All done — Next: Finish →</Button>}
        </div>
        <div>
          {item ? <CompartmentPanel key={item.id + (snap.itemHuids[item.id]?.join() ?? "")} item={item} snap={snap} locked={locked} run={run} onDone={() => setSel(next(item.compartment_no))} />
            : <p className="rounded-lg border-2 border-dashed p-8 text-center text-muted-foreground">Every product is weighed and matched.</p>}
        </div>
      </div>
    </div>
  );
}

/* Weight panel with the HUID field on the same compartment, right after saving. */
function CompartmentPanel({ item, snap, locked, run, onDone }: { item: Item; snap: Snap; locked: boolean; run: Station["run"]; onDone: () => void }) {
  const ownSaved = item.gross_weight != null;
  const [gross, setGross] = useState(item.gross_weight != null ? Number(item.gross_weight).toFixed(3) : "");
  const [less, setLess] = useState(Number(item.less_weight ?? 0).toFixed(3));
  const [field, setField] = useState<"gross" | "less">("gross");
  const [showPad, setShowPad] = useState(false);
  const grossRef = useRef<HTMLInputElement>(null);
  const lessRef = useRef<HTMLInputElement>(null);
  const touched = useRef({ gross: false, less: false });
  useEffect(() => { if (!locked) grossRef.current?.focus(); }, [item.id, locked]);
  const allowed = snap.sublot.allowed_pcs?.length ? snap.sublot.allowed_pcs : [snap.sublot.default_pcs];
  const pcsOptions = [...new Set([...allowed, ...(ownSaved && !allowed.includes(item.pcs) ? [item.pcs] : [])])].sort((a, b) => a - b);
  const [pcs, setPcs] = useState<number | null>(allowed.length === 1 ? allowed[0] : ownSaved ? item.pcs : null);
  const [narr, setNarr] = useState(ownSaved ? (item.narration ?? "") : "");
  const [hold, setHold] = useState<HoldFlag | "">("");
  const [holdNote, setHoldNote] = useState("");
  const g = Number(gross || 0), l = Number(less || 0);
  const net = +(g - l).toFixed(3);
  const others = [...snap.sublotGross, ...snap.items.filter((i) => i.id !== item.id && i.gross_weight != null).map((i) => Number(i.gross_weight))];
  const avg = others.length ? others.reduce((a, b) => a + b, 0) / others.length : 0;
  const assigned = snap.itemHuids[item.id]?.length ?? 0;
  const [saved, setSaved] = useState(ownSaved);

  const save = async () => {
    if (!(g > 0)) return toast.error("Enter gross weight");
    if (l < 0 || l > g) return toast.error("Less weight must be between 0 and gross");
    if (pcs == null) return toast.error("Tap how many pieces this tag has");
    if (pcs < assigned) return toast.error(`Remove HUIDs first: ${(snap.itemHuids[item.id] ?? []).slice(pcs).join(", ")}`);
    if (avg > 0 && (g > avg * 3 || g < avg / 3) && !confirm(`Gross ${g.toFixed(3)} g is far from the average ${avg.toFixed(3)} g. Save anyway?`)) return;
    await run("save_weight", { p_item: item.id, p_gross: g, p_less: l, p_pcs: pcs, p_narration: narr.trim().toUpperCase() }, `Weight ${snap.tray.tray_code}-${item.compartment_no}`, item.id);
    toast.success(`${snap.tray.tray_code}-${pad(item.compartment_no)} saved — now add its HUID${pcs! > 1 ? "s" : ""}`);
    setSaved(true);
  };
  const wField = (k: "gross" | "less", label: string, v: string) => (
    <label className={cn("flex-1 rounded-lg border-4 p-2 text-left", field === k ? "border-ring bg-accent/30" : "border-border bg-card")}>
      <div className="text-xs font-bold uppercase text-muted-foreground">{label}</div>
      <input
        ref={k === "gross" ? grossRef : lessRef}
        type="text" inputMode="decimal" autoComplete="off" disabled={locked}
        value={v} placeholder="0.000"
        onFocus={(e) => { setField(k); e.currentTarget.select(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); if (k === "gross") lessRef.current?.focus(); else void save(); return; }
          if (/^[0-9.]$/.test(e.key) && !touched.current[k]) { e.preventDefault(); touched.current[k] = true; (k === "gross" ? setGross : setLess)(e.key === "." ? "0." : e.key); }
        }}
        onChange={(e) => {
          const x = e.target.value.replace(",", ".");
          if (x !== "" && !/^\d{0,8}(\.\d{0,3})?$/.test(x)) return;
          touched.current[k] = true; (k === "gross" ? setGross : setLess)(x);
        }}
        className="num w-full bg-transparent text-3xl font-bold outline-none"
      />
    </label>
  );
  return (
    <div className="space-y-3 rounded-xl border-2 bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="num text-3xl font-extrabold">{snap.tray.tray_code}-{pad(item.compartment_no)}</span>
        {item.hold_flag && <span className="rounded bg-destructive px-2 py-1 text-sm font-bold text-destructive-foreground">HOLD: {HOLD_LABEL[item.hold_flag]}</span>}
      </div>
      <div className="flex gap-2">
        {wField("gross", "Gross g", gross)}
        {wField("less", "Less g", less)}
        <div className="flex-1 rounded-lg bg-muted p-2"><div className="text-xs font-bold uppercase text-muted-foreground">Net g</div><div className="num text-3xl font-bold">{fmt3(net)}</div></div>
      </div>
      {!locked && (
        <div>
          <button type="button" className="text-sm font-semibold underline" onClick={() => setShowPad(!showPad)}>{showPad ? "Hide on-screen keypad" : "Show on-screen keypad"}</button>
          {showPad && <div className="mt-2"><Keypad value={field === "gross" ? gross : less} onChange={(v) => { touched.current[field] = true; (field === "gross" ? setGross : setLess)(v); }} /></div>}
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="font-bold">Pcs</span>
        {allowed.length === 1 ? (
          <span className="num rounded-lg bg-muted px-4 py-2 text-2xl font-bold">{pcs}</span>
        ) : (
          <>
            {pcsOptions.map((p) => (
              <button key={p} type="button" disabled={locked} onClick={() => { if (p < assigned) toast.error(`Remove HUIDs first: ${(snap.itemHuids[item.id] ?? []).slice(p).join(", ")}`); else setPcs(p); }}
                className={cn("num h-12 w-16 rounded-lg border-2 text-xl font-bold", pcs === p ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>{p}</button>
            ))}
            {pcs == null && <span className="text-sm font-semibold text-destructive">Tap one</span>}
          </>
        )}
      </div>
      <Input className="h-12 uppercase" placeholder="Narration (optional)" value={narr} onChange={(e) => setNarr(e.target.value.toUpperCase())} disabled={locked} />
      {!locked && !saved && (
        <>
          <Button className="h-16 w-full text-xl font-bold" disabled={pcs == null} onClick={() => void save()}>Save weight</Button>
          <details className="rounded-lg border p-2">
            <summary className="cursor-pointer font-semibold">Flag a problem (hold)</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <select className="h-12 rounded-md border bg-background px-2" value={hold} onChange={(e) => setHold(e.target.value as HoldFlag)}>
                <option value="">Reason…</option>
                {(Object.keys(HOLD_LABEL) as HoldFlag[]).map((k) => <option key={k} value={k}>{HOLD_LABEL[k]}</option>)}
              </select>
              <Input className="h-12" placeholder="Note" value={holdNote} onChange={(e) => setHoldNote(e.target.value)} />
              <Button variant="destructive" className="h-12" disabled={!hold} onClick={() => { void run("set_hold", { p_item: item.id, p_flag: hold, p_note: holdNote }, `Hold ${item.compartment_no}`, item.id); toast.success("Hold flagged"); }}>Flag</Button>
            </div>
          </details>
        </>
      )}
      {(saved || ownSaved) && <HuidPicker item={{ ...item, pcs: pcs ?? item.pcs, net_weight: net }} snap={snap} locked={locked} run={run} onDone={onDone} />}
    </div>
  );
}

/* HUID matching for one compartment — weight suggestions + search + manual. */
function HuidPicker({ item, snap, locked, run, onDone }: { item: Item; snap: Snap; locked: boolean; run: Station["run"]; onDone: () => void }) {
  const { status } = useSync();
  const current = snap.itemHuids[item.id] ?? [];
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [manual, setManual] = useState("");
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
    await run("assign_item_huids", { p_item: item.id, p_huids: h }, `HUID ${snap.tray.tray_code}-${item.compartment_no}`, item.id);
    toast.success(`${snap.tray.tray_code}-${pad(item.compartment_no)} → ${h.join(", ")}`);
    onDone();
  };
  const pick = (h: string) => {
    if (locked) return;
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

  if (current.length > 0) return (
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
      <Input className="num h-12 text-lg uppercase" placeholder="Search HUID (type any part)" value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} />
      <div className="grid max-h-[22rem] grid-cols-2 gap-2 overflow-auto sm:grid-cols-3">
        {list.map((h) => (
          <button key={h} type="button" disabled={locked} onClick={() => pick(h)}
            className="num flex flex-col items-start rounded-lg border-2 bg-background p-2 text-left active:bg-accent">
            <span className="text-xl font-bold tracking-wider">{h}</span>
          </button>
        ))}
        {list.length === 0 && <p className="col-span-full p-3 text-center text-muted-foreground">No free HUIDs{q ? " match" : " left"}.</p>}
      </div>
      <details className="rounded-lg border p-2">
        <summary className="cursor-pointer text-sm font-semibold">HUID not in the list? Type it</summary>
        <div className="mt-2 flex gap-2">
          <Input className="num h-12 uppercase" maxLength={6} placeholder="ABC123" value={manual} onChange={(e) => setManual(e.target.value.toUpperCase())} />
          <Button className="h-12" variant="outline" onClick={() => void addManual()}>Add</Button>
        </div>
      </details>
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
      </div>
    </details>
  );
}
