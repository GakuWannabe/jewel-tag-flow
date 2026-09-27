import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Keypad } from "@/components/station/Keypad";
import { TrayGrid, Legend, type CellState } from "@/components/station/TrayGrid";
import { useStation } from "@/lib/station";
import { useSync } from "@/lib/offline";
import { db, fmt3 } from "@/lib/db";
import { suggestHuids, hasConfusable, normHuid, validHuid } from "@/lib/huid-match";
import { HOLD_LABEL, type HoldFlag, type Item } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/station/$sessionId")({
  head: () => ({ meta: [{ title: "Tray — Tagging Line" }, { name: "description", content: "Load, weigh and assign HUIDs." }] }),
  component: SessionScreen,
});

function SessionScreen() {
  const { sessionId } = Route.useParams();
  const nav = useNavigate();
  const { snap, error, run } = useStation(sessionId);
  const [sel, setSel] = useState<number | null>(null);

  if (error && !snap) return <AppShell title="Tray" back="/station"><p className="text-destructive">{error}</p></AppShell>;
  if (!snap) return <AppShell title="Tray" back="/station"><p>Loading…</p></AppShell>;

  const locked = !["issued", "loading", "weighing"].includes(snap.sublot.status);
  const loading = snap.session.station === "loading" && ["empty", "loaded"].includes(snap.session.status);
  const byComp = new Map(snap.items.map((i) => [i.compartment_no, i]));
  const complete = (i: Item) => i.gross_weight != null && (snap.itemHuids[i.id]?.length ?? 0) === i.pcs;
  const stateOf = (n: number): CellState => {
    const i = byComp.get(n);
    if (!i) return "empty";
    if (i.hold_flag) return "hold";
    if (i.photo_url) return "photo";
    if (complete(i)) return "huid";
    if (i.gross_weight != null) return "weighed";
    return "loaded";
  };
  const remaining = snap.pool.filter((p) => !p.assigned_item_id).length;
  const allDone = snap.items.length > 0 && snap.items.every(complete);

  const tap = (n: number) => {
    if (locked) return;
    if (loading) {
      const occupied = byComp.has(n);
      const item = byComp.get(n);
      if (occupied && item?.gross_weight != null) return toast.error("Already weighed");
      void run("set_compartment", { p_session: sessionId, p_compartment: n, p_occupied: !occupied, p_item_id: item?.id ?? crypto.randomUUID() }, `Compartment ${n}`);
    } else if (byComp.has(n)) setSel(n);
  };

  const nextOpen = (after: number) => {
    const sorted = [...snap.items].sort((a, b) => a.compartment_no - b.compartment_no);
    return (sorted.find((i) => i.compartment_no > after && !complete(i)) ?? sorted.find((i) => !complete(i)))?.compartment_no ?? null;
  };

  return (
    <AppShell
      title={`${snap.sublot.lot_no} · Tray ${snap.tray.tray_code}`}
      back="/station"
      actions={<span className="num rounded-md bg-sidebar-primary px-2 py-1 text-sm font-bold text-sidebar-primary-foreground">HUIDs remaining: {remaining}</span>}
    >
      {locked && <div className="mb-3 rounded-lg bg-destructive p-4 text-center text-lg font-bold text-destructive-foreground">{snap.sublot.status === "halted" ? "Reconciliation failed — call manager." : `Sublot is ${snap.sublot.status.replace(/_/g, " ")} — read only.`}</div>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold">{loading ? "LOADING — tap filled compartments" : "WEIGHING"}</span>
            <span className="text-sm text-muted-foreground">{snap.sublot.base_code} · {snap.items.length} items</span>
          </div>
          <TrayGrid rows={snap.tray.rows} columns={snap.tray.columns} trayCode={snap.tray.tray_code} stateOf={stateOf} selected={sel} onTap={tap}
            sub={(n) => { const i = byComp.get(n); return i?.net_weight != null ? Number(i.net_weight).toFixed(3) : null; }} />
          <Legend />
          {!locked && loading && (
            <Button className="h-16 w-full text-xl" disabled={!snap.items.length} onClick={async () => {
              await run("start_weighing", { p_session: sessionId }, "Start weighing");
              setSel(nextOpen(0));
            }}>Loading done → Start weighing</Button>
          )}
          {!locked && !loading && snap.session.status !== "weighed" && (
            <Button className="h-16 w-full text-xl" disabled={!allDone} onClick={async () => {
              await run("close_tray_session", { p_session: sessionId }, `Close tray ${snap.tray.tray_code}`);
              toast.success(`Tray ${snap.tray.tray_code} complete`);
              void nav({ to: "/station" });
            }}>{allDone ? "Close tray" : "Close tray (complete all compartments)"}</Button>
          )}
          {snap.session.status === "weighed" && <p className="rounded bg-success p-3 text-center font-bold text-success-foreground">Tray complete</p>}
        </div>
        <div>
          {!loading && sel != null && byComp.get(sel) && (
            <EntryPanel
              key={byComp.get(sel)!.id}
              item={byComp.get(sel)!}
              snap={snap}
              locked={locked}
              run={run}
              onDone={() => setSel(nextOpen(sel))}
            />
          )}
          {!loading && sel == null && <p className="rounded-lg border-2 border-dashed p-8 text-center text-muted-foreground">Tap a compartment to weigh it.</p>}
        </div>
      </div>
    </AppShell>
  );
}

function EntryPanel({ item, snap, locked, run, onDone }: {
  item: Item; snap: NonNullable<ReturnType<typeof useStation>["snap"]>; locked: boolean;
  run: ReturnType<typeof useStation>["run"]; onDone: () => void;
}) {
  const { status } = useSync();
  const [gross, setGross] = useState(item.gross_weight != null ? Number(item.gross_weight).toFixed(3) : "");
  const [less, setLess] = useState(Number(item.less_weight ?? 0).toFixed(3));
  const [field, setField] = useState<"gross" | "less">("gross");
  const [pcs, setPcs] = useState(item.pcs);
  const [narr, setNarr] = useState(item.narration ?? "");
  const [huids, setHuids] = useState<string[]>(snap.itemHuids[item.id] ?? []);
  const [search, setSearch] = useState("");
  const [manual, setManual] = useState("");
  const [hold, setHold] = useState<HoldFlag | "">("");
  const [holdNote, setHoldNote] = useState("");

  const g = Number(gross || 0), l = Number(less || 0);
  const net = +(g - l).toFixed(3);
  const available = useMemo(() => snap.pool.filter((p) => !p.assigned_item_id || p.assigned_item_id === item.id), [snap.pool, item.id]);
  const freeForSuggest = available.filter((p) => !huids.includes(p.huid));
  const suggestions = useMemo(() => (net > 0 ? suggestHuids(available, net, pcs) : []), [available, net, pcs]);
  const searchHits = search.length >= 2 ? freeForSuggest.filter((p) => p.huid.includes(search.toUpperCase())).slice(0, 8) : [];

  const others = [...snap.sublotGross, ...snap.items.filter((i) => i.id !== item.id && i.gross_weight != null).map((i) => Number(i.gross_weight))];
  const avg = others.length ? others.reduce((a, b) => a + b, 0) / others.length : 0;

  useEffect(() => { if (huids.length > pcs) setHuids(huids.slice(0, pcs)); }, [pcs]); // eslint-disable-line react-hooks/exhaustive-deps

  const addHuid = async (raw: string) => {
    const h = normHuid(raw);
    if (!validHuid(h)) return toast.error("HUID must be 6 letters/digits");
    if (huids.includes(h)) return toast.error("Same HUID twice on one tag");
    if (huids.length >= pcs) return toast.error(`Only ${pcs} HUID slot(s)`);
    const local = snap.pool.find((p) => p.huid === h);
    if (local?.assigned_item_id && local.assigned_item_id !== item.id) return toast.error("Already used on another item");
    if (!local) {
      if (status !== "offline") {
        const { data } = await db.rpc("check_huids", { p_huids: [h] });
        if (data?.length) return toast.error(`${h} already exists (lot ${data[0].lot_no})`);
      } else toast.warning(`${h} is not in this sublot's list — it will be re-checked when back online.`);
    }
    if (hasConfusable(h)) toast.warning("Check 0/O, 1/I, 5/S, 8/B, 2/Z");
    setHuids([...huids, h]);
    setManual(""); setSearch("");
  };

  const save = async () => {
    if (!(g > 0)) return toast.error("Enter gross weight");
    if (l < 0 || l > g) return toast.error("Less weight must be between 0 and gross");
    if (avg > 0 && (g > avg * 3 || g < avg / 3) && !confirm(`Gross ${g.toFixed(3)} g is far from the sublot average ${avg.toFixed(3)} g. Save anyway?`)) return;
    await run("save_weight", { p_item: item.id, p_gross: g, p_less: l, p_pcs: pcs, p_narration: narr }, `Weight ${snap.tray.tray_code}-${item.compartment_no}`, item.id);
    const before = snap.itemHuids[item.id] ?? [];
    if (huids.length === pcs && huids.join() !== before.join()) {
      await run("assign_item_huids", { p_item: item.id, p_huids: huids }, `HUID ${snap.tray.tray_code}-${item.compartment_no}`, item.id);
    } else if (huids.length === 0 && before.length) {
      await run("unassign_item_huids", { p_item: item.id }, `Unassign ${item.compartment_no}`, item.id);
    }
    if (huids.length < pcs) toast.warning(`Saved weight — ${pcs - huids.length} HUID still needed`);
    else onDone();
  };

  const wField = (k: "gross" | "less", label: string, v: string) => (
    <button type="button" onClick={() => setField(k)} className={cn("flex-1 rounded-lg border-4 p-2 text-left", field === k ? "border-ring bg-accent/30" : "border-border bg-card")}>
      <div className="text-xs font-bold uppercase text-muted-foreground">{label}</div>
      <div className="num text-3xl font-bold">{v || "0.000"}</div>
    </button>
  );

  return (
    <div className="space-y-3 rounded-xl border-2 bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="num text-2xl font-extrabold">{snap.tray.tray_code}-{String(item.compartment_no).padStart(2, "0")}</span>
        {item.hold_flag && <span className="rounded bg-destructive px-2 py-1 text-sm font-bold text-destructive-foreground">HOLD: {HOLD_LABEL[item.hold_flag]}</span>}
      </div>
      <div className="flex gap-2">
        {wField("gross", "Gross g", gross)}
        {wField("less", "Less g", less)}
        <div className="flex-1 rounded-lg bg-muted p-2"><div className="text-xs font-bold uppercase text-muted-foreground">Net g</div><div className="num text-3xl font-bold">{fmt3(net)}</div></div>
      </div>
      {!locked && <Keypad value={field === "gross" ? gross : less} onChange={field === "gross" ? setGross : setLess} />}
      <div className="flex items-center gap-2">
        <span className="font-bold">Pcs</span>
        {[1, 2].map((p) => (
          <button key={p} type="button" onClick={() => setPcs(p)} className={cn("num h-12 w-16 rounded-lg border-2 text-xl font-bold", pcs === p ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>{p}</button>
        ))}
        <Input className="h-12 flex-1" placeholder="Narration (optional)" value={narr} onChange={(e) => setNarr(e.target.value)} />
      </div>

      <div className="space-y-2 rounded-lg bg-secondary p-2">
        <div className="flex items-center gap-2">
          <span className="font-bold">HUID</span>
          {Array.from({ length: pcs }, (_, i) => (
            <button key={i} type="button" onClick={() => setHuids(huids.filter((_, j) => j !== i))}
              className={cn("num h-12 flex-1 rounded-lg border-2 text-lg font-bold", huids[i] ? "border-success bg-success text-success-foreground" : "border-dashed bg-card text-muted-foreground")}>
              {huids[i] ? `${huids[i]} ✕` : `slot ${i + 1}`}
            </button>
          ))}
        </div>
        {huids.length < pcs && suggestions.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-3">
            {suggestions.map((s) => (
              <button key={s.rows.map((r) => r.id).join()} type="button" onClick={() => setHuids(s.rows.map((r) => r.huid))}
                className="rounded-lg border-2 border-primary bg-card p-2 text-left active:bg-accent">
                {s.rows.map((r) => <div key={r.id} className="num flex justify-between text-lg font-bold"><span>{r.huid}</span><span>{fmt3(r.piece_weight)}</span></div>)}
                <div className="num text-xs text-muted-foreground">Σ {fmt3(s.sum)} · Δ {fmt3(s.diff)}{pcs === 2 ? ` · spread ${fmt3(s.spread)}` : ""}</div>
              </button>
            ))}
          </div>
        )}
        {huids.length < pcs && (
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Input className="num h-12 uppercase" placeholder="Search pool by part of HUID" value={search} onChange={(e) => setSearch(e.target.value)} />
              {searchHits.map((p) => (
                <button key={p.id} type="button" onClick={() => void addHuid(p.huid)} className="num flex w-full justify-between border-b px-2 py-2 text-lg active:bg-accent">
                  <span>{p.huid}</span><span>{fmt3(p.piece_weight)}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input className="num h-12 uppercase" maxLength={6} placeholder="Type HUID" value={manual} onChange={(e) => setManual(e.target.value.toUpperCase())} />
              <Button className="h-12" variant="outline" onClick={() => void addHuid(manual)}>Add</Button>
            </div>
          </div>
        )}
      </div>

      {!locked && (
        <>
          <Button className="h-16 w-full text-xl font-bold" onClick={() => void save()}>Save & next</Button>
          <details className="rounded-lg border p-2">
            <summary className="cursor-pointer font-semibold">Flag a hold</summary>
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
