/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Keypad } from "../Keypad";
import { Legend } from "../TrayGrid";
import { TraySwitcher } from "../TraySwitcher";
import { fmt3 } from "@/lib/db";
import { HOLD_LABEL, type HoldFlag, type Item } from "@/lib/types";
import { cn } from "@/lib/utils";
import { pad, sortedItems, Grid, type StepProps, type Snap, type Station } from "./shared";

/* ---------------- WEIGH ---------------- */
export function WeighStep({ snap, run, locked, go }: StepProps) {
  const items = sortedItems(snap);
  const byComp = new Map(items.map((i) => [i.compartment_no, i]));
  const firstOpen = items.find((i) => i.gross_weight == null)?.compartment_no ?? items[0]?.compartment_no ?? null;
  const [sel, setSel] = useState<number | null>(firstOpen);
  const started = useRef(false);
  useEffect(() => {
    if (!started.current && !locked && snap.session.station === "loading" && items.length) {
      started.current = true; void run("start_weighing", { p_session: snap.session.id }, "Start weighing");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  const weighed = items.filter((i) => i.gross_weight != null).length;
  const allDone = weighed === items.length;
  const next = (after: number) =>
    (items.find((i) => i.compartment_no > after && (i.gross_weight == null))
      ?? items.find((i) => i.compartment_no !== after && i.gross_weight == null))?.compartment_no ?? null;
  const item = sel != null ? byComp.get(sel) : undefined;
  const lastNarr = useRef<string | null>(null);
  const latest = [...items].filter((i) => i.gross_weight != null).sort((a, b) => (b.weighed_at ?? "").localeCompare(a.weighed_at ?? ""))[0];
  const carryNarr = lastNarr.current ?? latest?.narration ?? "";

  return (
    <div className="space-y-4">
      <TraySwitcher snap={snap} step="weigh" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="num text-lg font-bold">Weighed {weighed} / {items.length}</span>
            <span className="text-sm text-muted-foreground">Tap a compartment</span>
          </div>
          <Grid snap={snap} selected={sel} onTap={(n) => byComp.has(n) && setSel(n)}
            stateOf={(n) => { const i = byComp.get(n); if (!i) return "empty"; if (i.hold_flag) return "hold"; return i.gross_weight != null ? "weighed" : "loaded"; }}
            sub={(n) => { const i = byComp.get(n); if (!i) return null; return i.net_weight != null ? Number(i.net_weight).toFixed(3) : null; }} />
          <Legend only={["loaded", "weighed", "hold"]} />
          {allDone && <Button className="h-16 w-full text-xl" onClick={() => go("huid")}>Next: HUID →</Button>}
        </div>
        <div>
          {item ? <CompartmentPanel key={item.id} item={item} snap={snap} locked={locked} run={run} carryNarr={carryNarr} onDone={(narration) => { lastNarr.current = narration; setSel(next(item.compartment_no)); }} />
            : <p className="rounded-lg border-2 border-dashed p-8 text-center text-muted-foreground">Every product is weighed.</p>}
        </div>
      </div>
    </div>
  );
}

/* Weight, pieces and narration for one compartment. */
function CompartmentPanel({ item, snap, locked, run, carryNarr, onDone }: { item: Item; snap: Snap; locked: boolean; run: Station["run"]; carryNarr: string; onDone: (narration: string) => void }) {
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
  const [narr, setNarr] = useState(ownSaved ? (item.narration ?? "") : carryNarr);
  const [hold, setHold] = useState<HoldFlag | "">("");
  const [holdNote, setHoldNote] = useState("");
  const g = Number(gross || 0), l = Number(less || 0);
  const net = +(g - l).toFixed(3);
  const others = [...snap.sublotGross, ...snap.items.filter((i) => i.id !== item.id && i.gross_weight != null).map((i) => Number(i.gross_weight))];
  const avg = others.length ? others.reduce((a, b) => a + b, 0) / others.length : 0;
  const assigned = snap.itemHuids[item.id]?.length ?? 0;
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!(g > 0)) return toast.error("Enter gross weight");
    if (l < 0 || l > g) return toast.error("Less weight must be between 0 and gross");
    if (pcs == null) return toast.error("Tap how many pieces this tag has");
    if (pcs < assigned) return toast.error(`Remove HUIDs first: ${(snap.itemHuids[item.id] ?? []).slice(pcs).join(", ")}`);
    if (avg > 0 && (g > avg * 3 || g < avg / 3) && !confirm(`Gross ${g.toFixed(3)} g is far from the average ${avg.toFixed(3)} g. Save anyway?`)) return;
    if (saving || locked) return;
    setSaving(true);
    try {
    await run("save_weight", { p_item: item.id, p_gross: g, p_less: l, p_pcs: pcs, p_narration: narr.trim().toUpperCase() }, `Weight ${snap.tray.tray_code}-${item.compartment_no}`, item.id);
    toast.success(`${snap.tray.tray_code}-${pad(item.compartment_no)} saved`);
    onDone(narr.trim().toUpperCase());
    } finally { setSaving(false); }
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
      {!locked && (
        <>
          <Button className="h-16 w-full text-xl font-bold" disabled={pcs == null || saving} onClick={() => void save()}>Save weight</Button>
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
      {(saved || ownSaved) && <HuidPicker item={{ ...item, pcs: pcs ?? item.pcs, net_weight: net }} snap={snap} locked={locked} run={run} carryNarr={carryNarr} onDone={onDone} />}
    </div>
  );
}

