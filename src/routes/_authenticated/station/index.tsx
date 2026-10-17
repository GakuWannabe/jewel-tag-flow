import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { db, rpc, errMsg } from "@/lib/db";
import { enqueue, snapGet, snapSet } from "@/lib/offline";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/station/")({
  head: () => ({ meta: [{ title: "Tray station — Tagging Line" }, { name: "description", content: "Pick the packet and tray." }] }),
  validateSearch: (s: Record<string, unknown>): { sublot?: string } => (typeof s.sublot === "string" ? { sublot: s.sublot } : {}),
  component: StationPick,
});

/** Greedy tray suggestion: largest trays first, smallest for the remainder. */
function suggestTrays(trays: any[], pieces: number): { tray: any; count: number }[] {
  const byCap = [...trays].sort((a, b) => b.compartment_count - a.compartment_count);
  const out: { tray: any; count: number }[] = [];
  let left = pieces;
  while (left > 0 && byCap.length) {
    const tray = left >= byCap[byCap.length - 1].compartment_count
      ? byCap.find((t) => t.compartment_count <= left) ?? byCap[byCap.length - 1]
      : byCap[byCap.length - 1];
    const count = Math.min(left, tray.compartment_count);
    const ex = out.find((o) => o.tray.id === tray.id);
    if (ex && count === tray.compartment_count) ex.count += count; else out.push({ tray, count });
    left -= count;
  }
  return out;
}

function StationPick() {
  const nav = useNavigate();
  const { sublot: preselect } = Route.useSearch();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<any>(null);
  const [pieces, setPieces] = useState("");
  const [plan, setPlan] = useState<{ tray: any; count: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [cached, setCached] = useState<any>(null);
  useEffect(() => { snapGet("station-index").then(setCached); }, []);

  const { data, refetch } = useQuery({
    queryKey: ["station-index"],
    queryFn: async () => {
      const [s, t, open] = await Promise.all([
        db.from("sublots").select("id,sublot_no,status,lot_type, lots(lot_no), product_types(base_code,name)").in("status", ["issued", "loading", "weighing", "halted"]).is("deleted_at", null),
        db.from("trays").select("*").eq("active", true).order("tray_code"),
        db.from("tray_sessions").select("id,status,station,sublot_id,tray_id, trays(tray_code)").neq("status", "cleared"),
      ]);
      const v = { sublots: s.data ?? [], trays: t.data ?? [], open: open.data ?? [] };
      await snapSet("station-index", v);
      return v;
    },
  });
  const d = data ?? cached;
  useEffect(() => {
    if (preselect && !picked && d?.sublots) { const s = d.sublots.find((x: any) => x.id === preselect); if (s) setPicked(s); }
  }, [preselect, d, picked]);
  const list = (d?.sublots ?? []).filter((s: any) => !q || s.lots.lot_no.toUpperCase().includes(q.toUpperCase()));
  const freeTrays = (d?.trays ?? []).filter((t: any) => !(d?.open ?? []).some((o: any) => o.tray_id === t.id));

  const n = Number(pieces);
  const makePlan = () => {
    if (!Number.isInteger(n) || n < 1) return toast.error("Type how many pieces are in the packet");
    const p = suggestTrays(freeTrays, n);
    if (!p.length) return toast.error("No free trays — clear a finished tray first");
    setPlan(p);
  };
  const adjust = (i: number, delta: number) => {
    if (!plan) return;
    const next = plan.map((p, j) => j === i ? { ...p, count: Math.max(0, Math.min(p.tray.compartment_count, p.count + delta)) } : p).filter((p) => p.count > 0);
    setPlan(next);
  };
  const planned = (plan ?? []).reduce((a, p) => a + p.count, 0);

  const accept = async () => {
    if (!plan || planned !== n) return toast.error(`Plan covers ${planned} pieces but the packet has ${n} — adjust it`);
    setBusy(true);
    try {
      let first: string | null = null;
      for (const p of plan) {
        const id = await rpc<string>("open_tray_session", { p_sublot: picked.id, p_tray: p.tray.id });
        first ??= id;
        // auto-assign compartments 1..count so loading is just a check
        await enqueue([...Array(p.count)].map((_, k) => ({
          fn: "set_compartment",
          args: { p_session: id, p_compartment: k + 1, p_occupied: true, p_item_id: crypto.randomUUID() },
          label: `Compartment ${k + 1}`, sublotId: picked.id,
        })));
      }
      toast.success("Trays ready — check the loading on screen");
      void nav({ to: "/station/$sessionId", params: { sessionId: first! } });
    } catch (e) { toast.error(errMsg(e)); refetch(); } finally { setBusy(false); }
  };

  const closeSublot = async (s: any) => {
    if (!confirm(`Close sublot ${s.lots.lot_no} #${s.sublot_no}? All trays must be weighed.`)) return;
    try {
      const pass = await rpc<boolean>("close_sublot", { p_sublot: s.id });
      if (pass) toast.success("Check passed — sealed and sent to tagging");
      else toast.error("Check failed — call manager.", { duration: 20000 });
      refetch(); setPicked(null); setPlan(null); setPieces("");
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <AppShell title={picked ? `${picked.lots.lot_no} · #${picked.sublot_no}` : "Tray station"} back="/app">
      {!picked ? (
        <div className="space-y-3">
          <Input autoFocus className="num h-16 text-2xl uppercase" placeholder="Lot number on packet" value={q} onChange={(e) => setQ(e.target.value)} />
          {list.map((s: any) => (
            <button key={s.id} onClick={() => { setPicked(s); setPlan(null); setPieces(""); }} className="flex w-full items-center gap-3 rounded-xl border-2 bg-card p-4 text-left active:bg-accent">
              <span className="num text-2xl font-bold">{s.lots.lot_no}</span>
              <span className="text-lg">#{s.sublot_no} · {s.product_types.base_code}</span>
              <span className="ml-auto"><StatusBadge status={s.status} /></span>
            </button>
          ))}
          {list.length === 0 && <p className="text-muted-foreground">No sublots issued for tagging.</p>}
        </div>
      ) : picked.status === "halted" ? (
        <div className="rounded-xl bg-destructive p-8 text-center text-2xl font-bold text-destructive-foreground">
          Reconciliation failed — call manager.
          <div className="mt-4"><Button variant="secondary" onClick={() => setPicked(null)}>Back</Button></div>
        </div>
      ) : (
        <div className="space-y-4">
          {(d?.open ?? []).filter((o: any) => o.sublot_id === picked.id).length > 0 && (
            <section>
              <h2 className="mb-2 font-bold">Resume tray</h2>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {d.open.filter((o: any) => o.sublot_id === picked.id).map((o: any) => (
                  <button key={o.id} onClick={() => nav({ to: "/station/$sessionId", params: { sessionId: o.id } })} className="rounded-xl border-4 border-primary bg-card p-3 text-center">
                    <div className="text-4xl font-extrabold">{o.trays.tray_code}</div><div className="text-xs uppercase">{o.status}</div>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3 rounded-xl border-2 bg-card p-4">
            <h2 className="text-xl font-extrabold">Start a new tray</h2>
            <label className="block space-y-1.5">
              <span className="text-base font-bold">How many pieces are in this packet?</span>
              <Input className="num h-16 text-3xl" inputMode="numeric" placeholder="0" value={pieces}
                onChange={(e) => { setPieces(e.target.value.replace(/\D/g, "")); setPlan(null); }} />
              <span className="block text-xs text-muted-foreground">Count the physical pieces — the app never tells you this number.</span>
            </label>
            {!plan && <Button className="h-14 w-full text-lg" disabled={!n} onClick={makePlan}>Suggest trays</Button>}

            {plan && (
              <div className="space-y-3">
                <p className="font-semibold">Suggested trays — adjust if you like:</p>
                {plan.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg border-2 p-3">
                    <span className="text-3xl font-extrabold">{p.tray.tray_code}</span>
                    <span className="text-sm text-muted-foreground">{p.tray.rows}×{p.tray.columns}</span>
                    <div className="ml-auto flex items-center gap-2">
                      <Button variant="outline" className="h-11 w-11 text-xl" onClick={() => adjust(i, -1)}>−</Button>
                      <span className={cn("num w-16 text-center text-2xl font-bold", p.count !== p.tray.compartment_count && "text-warning")}>{p.count}</span>
                      <Button variant="outline" className="h-11 w-11 text-xl" onClick={() => adjust(i, 1)}>+</Button>
                    </div>
                  </div>
                ))}
                <p className={cn("num text-sm font-semibold", planned === n ? "text-success" : "text-destructive")}>
                  Plan covers {planned} of {n} pieces{planned !== n ? " — fix it with +/−" : " ✓"}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" className="h-14 flex-1" onClick={() => setPlan(null)}>Back</Button>
                  <Button className="h-14 flex-[2] text-lg" disabled={planned !== n || busy} onClick={() => void accept()}>
                    {busy ? "Opening trays…" : "Accept — open trays"}
                  </Button>
                </div>
              </div>
            )}
          </section>

          <div className="flex gap-2">
            <Button variant="outline" className="h-14 flex-1" onClick={() => { setPicked(null); setPlan(null); setPieces(""); }}>Change packet</Button>
            <Button className="h-14 flex-1" onClick={() => closeSublot(picked)}>Close sublot</Button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
