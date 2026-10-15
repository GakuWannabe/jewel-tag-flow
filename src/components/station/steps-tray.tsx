/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Move, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Keypad } from "./Keypad";
import { TrayGrid, Legend, type CellState } from "./TrayGrid";
import type { useStation } from "@/lib/station";
import { useSync, enqueue } from "@/lib/offline";
import { db, rpc, errMsg, fmt3 } from "@/lib/db";
import { hasConfusable, normHuid, validHuid } from "@/lib/huid-match";
import { HOLD_LABEL, type HoldFlag, type Item } from "@/lib/types";
import { cn } from "@/lib/utils";

type Station = ReturnType<typeof useStation>;
export type Snap = NonNullable<Station["snap"]>;
export type StepKey = "tags" | "load" | "weigh" | "huids" | "match" | "finish";
export interface StepProps { snap: Snap; run: Station["run"]; refresh: Station["refresh"]; locked: boolean; go: (s: StepKey) => void }

const pad = (n: number) => String(n).padStart(2, "0");
export const huidsDone = (snap: Snap, i: Item) => (snap.itemHuids[i.id]?.length ?? 0) === i.pcs;
const sortedItems = (snap: Snap) => [...snap.items].sort((a, b) => a.compartment_no - b.compartment_no);

function Grid({ snap, stateOf, selected, onTap, sub, editMode, onMove }: { snap: Snap; stateOf: (n: number) => CellState; selected?: number | null; onTap: (n: number) => void; sub?: (n: number) => string | null; editMode?: boolean; onMove?: (a: number, b: number) => void }) {
  return <TrayGrid rows={snap.tray.rows} columns={snap.tray.columns} trayCode={snap.tray.tray_code} stateOf={stateOf} selected={selected} onTap={onTap} sub={sub} editMode={editMode} onMove={onMove} />;
}

// Blind count: never says how many products remain — staff decide from the physical packet.
function NextTrayBanner({ snap, locked }: { snap: Snap; locked: boolean }) {
  if (locked) return null;
  return (
    <Link to="/station" search={{ sublot: snap.sublot.id }} className="block rounded-xl border-2 border-dashed p-4 text-center text-lg font-bold">Load another tray →</Link>
  );
}

/* ---------------- STEP 2 · LOAD ---------------- */
export function LoadStep({ snap, run, refresh, locked, go }: StepProps) {
  const [edit, setEdit] = useState(false);
  const [pending, setPending] = useState<{ from: number; to: number } | null>(null);
  const byComp = new Map(snap.items.map((i) => [i.compartment_no, i]));
  const canLoad = !locked && ["empty", "loaded"].includes(snap.session.status);

  const [rm, setRm] = useState<Item | null>(null);
  const [rmReason, setRmReason] = useState("");
  const press = useRef<{ t: ReturnType<typeof setTimeout> | null; fired: boolean }>({ t: null, fired: false });
  const startPress = (e: import("react").PointerEvent) => {
    if (edit || locked) return;
    const el = (e.target as HTMLElement).closest("[data-comp]") as HTMLElement | null;
    const it = el ? byComp.get(Number(el.dataset.comp)) : undefined;
    press.current.fired = false;
    if (!it || it.gross_weight == null) return;
    press.current.t = setTimeout(() => {
      press.current.fired = true;
      if (it.ser_no != null) return void toast.error("This tag is sealed — a manager must unseal first");
      setRmReason(""); setRm(it);
    }, 600);
  };
  const endPress = () => { if (press.current.t) clearTimeout(press.current.t); press.current.t = null; };
  const doRemove = async () => {
    if (!rm || !rmReason.trim()) return;
    try { await rpc("correct_item", { p_item: rm.id, p_reason: rmReason.trim() }); toast.success(`Compartment ${pad(rm.compartment_no)} removed`); setRm(null); await refresh(); }
    catch (err) { toast.error(errMsg(err)); }
  };

  const tap = (n: number) => {
    if (press.current.fired) { press.current.fired = false; return; }
    if (!canLoad) return;
    const item = byComp.get(n);
    if (item?.ser_no != null) return toast.error("This tag already has a tag number — a manager must unseal first");
    if (item?.gross_weight != null) {
      if (!confirm(`Clear ${snap.tray.tray_code}-${pad(n)} (gross ${fmt3(Number(item.gross_weight))} g)? Its HUIDs go back to the list.`)) return;
      void (async () => {
        try { await rpc("correct_item", { p_item: item.id, p_reason: "unloaded at tray station" }); toast.success(`Compartment ${pad(n)} cleared`); await refresh(); }
        catch (err) { toast.error(errMsg(err)); }
      })();
      return;
    }
    void run("set_compartment", { p_session: snap.session.id, p_compartment: n, p_occupied: !item, p_item_id: item?.id ?? crypto.randomUUID() }, `Compartment ${n}`);
  };
  const doMove = () => {
    if (!pending) return;
    const it = byComp.get(pending.from);
    if (it) void run("move_item", { p_item: it.id, p_to: pending.to }, `Move ${pending.from}→${pending.to}`, it.id);
    setPending(null);
  };
  const target = pending ? byComp.get(pending.to) : null;
  const anyWeighed = snap.items.some((i) => i.gross_weight != null);
  const fillAll = () => {
    if (!canLoad || anyWeighed) return;
    const total = snap.tray.rows * snap.tray.columns;
    const ops = [];
    for (let n = 1; n <= total; n++) if (!byComp.has(n))
      ops.push({ fn: "set_compartment", args: { p_session: snap.session.id, p_compartment: n, p_occupied: true, p_item_id: crypto.randomUUID() }, label: `Compartment ${n}`, sublotId: snap.sublot.id });
    void enqueue(ops); // one write — never loses compartments
    toast.success("Every compartment marked — tap the empty ones to clear them");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="num rounded-lg bg-card px-3 py-2 text-lg font-bold">{snap.items.length} in this tray</span>
        <div className="ml-auto flex gap-2">
          {canLoad && <Button variant="outline" className="h-11" disabled={anyWeighed || edit} onClick={fillAll}>Fill whole tray</Button>}
          {!locked && <Button variant={edit ? "default" : "outline"} className="h-11" onClick={() => setEdit(!edit)}><Move className="mr-1 h-4 w-4" />{edit ? "Done editing" : "Edit"}</Button>}
        </div>
      </div>
      <p className="rounded-lg bg-muted p-3 text-base font-semibold">
        {edit ? "Drag a product to another compartment (or tap it, then tap the new spot)." : canLoad ? "Tap every compartment that has a product in it. Tap again to clear it." : "Loading is finished for this tray. Use Edit to move a product."}
      </p>
      <div onPointerDown={startPress} onPointerUp={endPress} onPointerLeave={endPress} onPointerCancel={endPress} onContextMenu={(e) => e.preventDefault()}>
        <Grid snap={snap} stateOf={(n) => (byComp.has(n) ? "loaded" : "empty")} onTap={tap} editMode={edit} onMove={(from, to) => setPending({ from, to })} />
      </div>
      <Legend only={["empty", "loaded"]} />
      {!locked && snap.items.some((i) => i.gross_weight != null) && <p className="text-sm text-muted-foreground">Marked one too many? Press and hold a weighed compartment to remove it.</p>}
      <NextTrayBanner snap={snap} locked={locked} />
      <Button className="h-16 w-full text-xl" disabled={!snap.items.length} onClick={() => go("weigh")}>Next: Weighing →</Button>

      <AlertDialog open={!!rm} onOpenChange={(o) => !o && setRm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this compartment?</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              Remove this compartment? Use this only when no product was ever placed here. The sublot totals will not change. Compartment <b>{rm && pad(rm.compartment_no)}</b>'s HUIDs go back to the list; this is logged with your name.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input className="h-12" placeholder="Reason (required)" value={rmReason} onChange={(e) => setRmReason(e.target.value)} />
          <AlertDialogFooter>
            <AlertDialogCancel className="h-12">Cancel</AlertDialogCancel>
            <Button variant="destructive" className="h-12" disabled={!rmReason.trim()} onClick={() => void doRemove()}>Remove</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move product?</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              Move the product from compartment <b>{pending && pad(pending.from)}</b> to <b>{pending && pad(pending.to)}</b>.
              {target && <> The product in {pending && pad(pending.to)} will move to {pending && pad(pending.from)}.</>}
              {" "}Make sure you move it in the real tray too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-12">Cancel</AlertDialogCancel>
            <AlertDialogAction className="h-12" onClick={doMove}>Yes, move it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------------- STEP 3 · WEIGH ---------------- */
export function WeighStep({ snap, run, locked, go }: StepProps) {
  const items = sortedItems(snap);
  const byComp = new Map(items.map((i) => [i.compartment_no, i]));
  const firstOpen = items.find((i) => i.gross_weight == null)?.compartment_no ?? items[0]?.compartment_no ?? null;
  const [sel, setSel] = useState<number | null>(firstOpen);
  // Narration carries forward within this tray session: kept in a ref and persisted per session
  // (tagged with the sublot) so it survives re-renders, refreshes and restarts.
  const narrKey = `tl-narr-${snap.session.id}`;
  const carryRef = useRef<string | null>(null);
  if (carryRef.current == null) {
    let v: string | null = null;
    try { const raw = localStorage.getItem(narrKey); const o = raw ? JSON.parse(raw) : null; if (o && o.sublot === snap.sublot.id) v = String(o.v ?? ""); } catch { /* ignore */ }
    if (v == null) {
      const saved = snap.items.filter((i) => i.gross_weight != null).sort((a, b) => String(a.weighed_at ?? "").localeCompare(String(b.weighed_at ?? "")));
      v = saved[saved.length - 1]?.narration ?? "";
    }
    carryRef.current = v;
  }
  const [carry, setCarryState] = useState<string>(carryRef.current);
  const setCarry = (v: string) => {
    carryRef.current = v; setCarryState(v);
    try { localStorage.setItem(narrKey, JSON.stringify({ sublot: snap.sublot.id, v })); } catch { /* ignore */ }
  };
  const started = useRef(false);
  useEffect(() => {
    if (!started.current && !locked && snap.session.station === "loading" && items.length) {
      started.current = true; void run("start_weighing", { p_session: snap.session.id }, "Start weighing");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!snap.tagNumbers.length) return (
    <div className="space-y-3 rounded-xl bg-warning p-6 text-center text-warning-foreground">
      <p className="text-xl font-bold">Add the next tag numbers first.</p>
      <Button className="h-14" onClick={() => go("tags")}>Go to Tag numbers</Button>
    </div>
  );
  if (!items.length) return <Button className="h-14 w-full" onClick={() => go("load")}>Load the tray first</Button>;

  const done = items.filter((i) => i.gross_weight != null).length;
  const next = (after: number) => (items.find((i) => i.compartment_no > after && i.gross_weight == null) ?? items.find((i) => i.gross_weight == null))?.compartment_no ?? null;
  const item = sel != null ? byComp.get(sel) : undefined;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="num text-lg font-bold">Weighed {done} / {items.length}</span>
          <span className="text-sm text-muted-foreground">Tap a compartment</span>
        </div>
        <Grid snap={snap} selected={sel} onTap={(n) => byComp.has(n) && setSel(n)}
          stateOf={(n) => { const i = byComp.get(n); if (!i) return "empty"; if (i.hold_flag) return "hold"; return i.gross_weight != null ? "weighed" : "loaded"; }}
          sub={(n) => { const i = byComp.get(n); return i?.net_weight != null ? Number(i.net_weight).toFixed(3) : null; }} />
        <Legend only={["loaded", "weighed", "hold"]} />
        {done === items.length && <Button className="h-16 w-full text-xl" onClick={() => go(snap.pool.length ? "match" : "huids")}>All weighed — Next: HUIDs →</Button>}
      </div>
      <div>
        {item ? <WeightPanel key={item.id} item={item} snap={snap} locked={locked} run={run} carry={carry} onSaved={setCarry} onDone={() => setSel(next(item.compartment_no))} />
          : <p className="rounded-lg border-2 border-dashed p-8 text-center text-muted-foreground">All products are weighed.</p>}
      </div>
    </div>
  );
}

function WeightPanel({ item, snap, locked, run, carry, onSaved, onDone }: { item: Item; snap: Snap; locked: boolean; run: Station["run"]; carry: string; onSaved: (n: string) => void; onDone: () => void }) {
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
  // One allowed value: fixed. Several: staff must pick — never guessed — unless this item was already saved.
  const [pcs, setPcs] = useState<number | null>(allowed.length === 1 ? allowed[0] : ownSaved ? item.pcs : null);
  const [narr, setNarr] = useState(ownSaved ? (item.narration ?? "") : carry);
  const [carried, setCarried] = useState(!ownSaved && carry !== "");
  const [hold, setHold] = useState<HoldFlag | "">("");
  const [holdNote, setHoldNote] = useState("");
  const g = Number(gross || 0), l = Number(less || 0);
  const net = +(g - l).toFixed(3);
  const others = [...snap.sublotGross, ...snap.items.filter((i) => i.id !== item.id && i.gross_weight != null).map((i) => Number(i.gross_weight))];
  const avg = others.length ? others.reduce((a, b) => a + b, 0) / others.length : 0;
  const assigned = snap.itemHuids[item.id]?.length ?? 0;

  const save = async () => {
    if (!(g > 0)) return toast.error("Enter gross weight");
    if (l < 0 || l > g) return toast.error("Less weight must be between 0 and gross");
    if (pcs == null) return toast.error("Tap how many pieces this tag has");
    if (pcs < assigned) return toast.error(`Remove HUIDs first: ${(snap.itemHuids[item.id] ?? []).slice(pcs).join(", ")}`);
    if (avg > 0 && (g > avg * 3 || g < avg / 3) && !confirm(`Gross ${g.toFixed(3)} g is far from the average ${avg.toFixed(3)} g. Save anyway?`)) return;
    await run("save_weight", { p_item: item.id, p_gross: g, p_less: l, p_pcs: pcs, p_narration: narr.trim() }, `Weight ${snap.tray.tray_code}-${item.compartment_no}`, item.id);
    onSaved(narr.trim());
    toast.success(`${snap.tray.tray_code}-${pad(item.compartment_no)} saved`);
    onDone();
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
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input className={cn("h-12", carried && "text-muted-foreground italic")} placeholder="Narration (optional)" value={narr} onChange={(e) => { setNarr(e.target.value); setCarried(false); }} />
          {carried && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-muted px-1.5 text-xs font-semibold text-muted-foreground">carried</span>}
        </div>
        {narr !== "" && !locked && <Button type="button" variant="ghost" className="h-12" onClick={() => { setNarr(""); setCarried(false); }}>Clear</Button>}
      </div>
      {!locked && (
        <>
          <Button className="h-16 w-full text-xl font-bold" disabled={pcs == null} onClick={() => void save()}>Save & next</Button>
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
    </div>
  );
}

/* ---------------- STEP 5 · MATCH HUIDs ---------------- */
export function MatchStep({ snap, run, locked, go }: StepProps) {
  const items = sortedItems(snap);
  const byComp = new Map(items.map((i) => [i.compartment_no, i]));
  const [sel, setSel] = useState<number | null>(items.find((i) => !huidsDone(snap, i))?.compartment_no ?? items[0]?.compartment_no ?? null);
  const left = snap.pool.filter((p) => !p.assigned_item_id).length;

  if (!snap.pool.length) return (
    <div className="space-y-3 rounded-xl bg-warning p-6 text-center text-warning-foreground">
      <p className="text-xl font-bold">Add the HUID list first.</p>
      <Button className="h-14" onClick={() => go("huids")}>Go to HUID list</Button>
    </div>
  );
  const done = items.filter((i) => huidsDone(snap, i)).length;
  const next = (after: number) => (items.find((i) => i.compartment_no > after && !huidsDone(snap, i)) ?? items.find((i) => !huidsDone(snap, i)))?.compartment_no ?? null;
  const item = sel != null ? byComp.get(sel) : undefined;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="num text-lg font-bold">Matched {done} / {items.length}</span>
          <span className="num rounded bg-sidebar-primary px-2 py-1 text-sm font-bold text-sidebar-primary-foreground">HUIDs left: {left}</span>
        </div>
        <Grid snap={snap} selected={sel} onTap={(n) => byComp.has(n) && setSel(n)}
          stateOf={(n) => { const i = byComp.get(n); if (!i) return "empty"; if (i.hold_flag) return "hold"; return huidsDone(snap, i) ? "huid" : i.gross_weight != null ? "weighed" : "loaded"; }}
          sub={(n) => { const i = byComp.get(n); return i ? (snap.itemHuids[i.id]?.join(" ") ?? (i.net_weight != null ? Number(i.net_weight).toFixed(3) : null)) : null; }} />
        <Legend only={["loaded", "weighed", "huid", "hold"]} />
        {done === items.length && <Button className="h-16 w-full text-xl" onClick={() => go("finish")}>All matched — Next: Finish →</Button>}
      </div>
      <div>
        {item ? <MatchPanel key={item.id + (snap.itemHuids[item.id]?.join() ?? "")} item={item} snap={snap} locked={locked} run={run} onDone={() => setSel(next(item.compartment_no))} />
          : <p className="rounded-lg border-2 border-dashed p-8 text-center text-muted-foreground">Every product has its HUIDs.</p>}
      </div>
    </div>
  );
}

function MatchPanel({ item, snap, locked, run, onDone }: { item: Item; snap: Snap; locked: boolean; run: Station["run"]; onDone: () => void }) {
  const { status } = useSync();
  const current = snap.itemHuids[item.id] ?? [];
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [manual, setManual] = useState("");
  const free = useMemo(() => snap.pool.filter((p) => !p.assigned_item_id), [snap.pool]);
  const online = status !== "offline";
  // Weight matching happens on the server; we only ever receive HUID strings.
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
    const src = found ?? free.filter((p) => !q || p.huid.includes(q)).map((p) => p.huid); // offline: local pool strings
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

  return (
    <div className="space-y-3 rounded-xl border-2 bg-card p-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="num text-3xl font-extrabold">{snap.tray.tray_code}-{pad(item.compartment_no)}</span>
        <span className="num text-lg">{item.net_weight != null ? `${fmt3(item.net_weight)} g net` : "not weighed yet"} · {item.pcs} pc{item.pcs > 1 ? "s" : ""}</span>
      </div>

      {current.length > 0 ? (
        <div className="space-y-2 rounded-lg bg-success p-3 text-success-foreground">
          <div className="flex items-center gap-2 text-lg font-bold"><CheckCircle2 className="h-6 w-6" /> {current.join(" + ")}</div>
          {!locked && <div className="flex gap-2">
            <Button variant="secondary" className="h-12 flex-1" onClick={() => void run("unassign_item_huids", { p_item: item.id }, `Unassign ${item.compartment_no}`, item.id)}>Change HUIDs</Button>
            <Button variant="secondary" className="h-12 flex-1" onClick={onDone}>Next →</Button>
          </div>}
        </div>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

/* ---------------- STEP 6 · FINISH ---------------- */
export function FinishStep({ snap, run, locked, go }: StepProps) {
  const nav = useNavigate();
  const items = snap.items;
  const weighed = items.filter((i) => i.gross_weight != null).length;
  const matched = items.filter((i) => huidsDone(snap, i)).length;
  const holds = items.filter((i) => i.hold_flag).length;
  const ready = items.length > 0 && weighed === items.length && matched === items.length;
  const closed = snap.session.status !== "empty" && snap.session.status !== "loaded";

  const Row = ({ label, v, ok, to }: { label: string; v: string; ok: boolean; to: StepKey }) => (
    <button type="button" onClick={() => go(to)} className={cn("flex w-full items-center justify-between rounded-lg border-2 p-4 text-left text-lg", ok ? "border-success" : "border-warning")}>
      <span className="font-semibold">{label}</span><span className="num font-bold">{v} {ok ? "✓" : "→"}</span>
    </button>
  );
  const closeSublot = async () => {
    if (!confirm(`Close sublot ${snap.sublot.lot_no} #${snap.sublot.sublot_no}? All trays must be finished.`)) return;
    try {
      const pass = await rpc<boolean>("close_sublot", { p_sublot: snap.sublot.id });
      if (pass) toast.success("Check passed — sent to photography"); else toast.error("Check failed — call manager.", { duration: 20000 });
      void nav({ to: "/station" });
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div className="mx-auto max-w-xl space-y-3">
      <Row label="Tag numbers" v={`${snap.tagNumbers.length}`} ok={snap.tagNumbers.length > 0} to="tags" />
      <Row label="Weighed" v={`${weighed} / ${items.length}`} ok={items.length > 0 && weighed === items.length} to="weigh" />
      <Row label="HUIDs matched" v={`${matched} / ${items.length}`} ok={items.length > 0 && matched === items.length} to="match" />
      {holds > 0 && <p className="rounded-lg bg-destructive p-3 font-bold text-destructive-foreground">{holds} product(s) on hold — manager will review.</p>}
      {!locked && !closed && (
        <Button className="h-16 w-full text-xl" disabled={!ready} onClick={async () => { await run("close_tray_session", { p_session: snap.session.id }, `Close tray ${snap.tray.tray_code}`); toast.success(`Tray ${snap.tray.tray_code} complete`); }}>
          {ready ? `Finish tray ${snap.tray.tray_code}` : "Finish tray (complete the steps above)"}
        </Button>
      )}
      {closed && <p className="rounded-lg bg-success p-4 text-center text-lg font-bold text-success-foreground">Tray {snap.tray.tray_code} is finished.</p>}
      <NextTrayBanner snap={snap} locked={locked} />
      {closed && !locked && <Button variant="secondary" className="h-16 w-full text-xl" onClick={() => void closeSublot()}>All trays done — Close sublot</Button>}
      <Button variant="outline" className="h-14 w-full" onClick={() => nav({ to: "/station" })}>Back to station</Button>
    </div>
  );
}
