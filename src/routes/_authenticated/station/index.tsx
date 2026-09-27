import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { db, rpc, errMsg } from "@/lib/db";
import { snapGet, snapSet } from "@/lib/offline";

export const Route = createFileRoute("/_authenticated/station/")({
  head: () => ({ meta: [{ title: "Tray station — Tagging Line" }, { name: "description", content: "Pick the packet and tray." }] }),
  component: StationPick,
});

function StationPick() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<any>(null);
  const [cached, setCached] = useState<any>(null);
  useEffect(() => { snapGet("station-index").then(setCached); }, []);

  const { data, refetch } = useQuery({
    queryKey: ["station-index"],
    queryFn: async () => {
      const [s, t, open] = await Promise.all([
        db.from("sublots").select("id,sublot_no,status, lots(lot_no), product_types(base_code,name)").in("status", ["issued", "loading", "weighing", "halted"]).is("deleted_at", null),
        db.from("trays").select("*").eq("active", true).order("tray_code"),
        db.from("tray_sessions").select("id,status,station,sublot_id,tray_id, trays(tray_code)").neq("status", "cleared"),
      ]);
      const v = { sublots: s.data ?? [], trays: t.data ?? [], open: open.data ?? [] };
      await snapSet("station-index", v);
      return v;
    },
  });
  const d = data ?? cached;
  const list = (d?.sublots ?? []).filter((s: any) => !q || s.lots.lot_no.toUpperCase().includes(q.toUpperCase()));

  const openTray = async (tray: any) => {
    try {
      const id = await rpc<string>("open_tray_session", { p_sublot: picked.id, p_tray: tray.id });
      void nav({ to: "/station/$sessionId", params: { sessionId: id } });
    } catch (e) { toast.error(errMsg(e)); refetch(); }
  };

  const closeSublot = async (s: any) => {
    if (!confirm(`Close sublot ${s.lots.lot_no} #${s.sublot_no}? All trays must be weighed.`)) return;
    try {
      const pass = await rpc<boolean>("close_sublot", { p_sublot: s.id });
      if (pass) toast.success("Reconciliation passed — sent to photography");
      else toast.error("Reconciliation failed — call manager.", { duration: 20000 });
      refetch(); setPicked(null);
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <AppShell title={picked ? `${picked.lots.lot_no} · #${picked.sublot_no}` : "Tray station"} back="/app">
      {!picked ? (
        <div className="space-y-3">
          <Input autoFocus className="num h-16 text-2xl uppercase" placeholder="Lot number on packet" value={q} onChange={(e) => setQ(e.target.value)} />
          {list.map((s: any) => (
            <button key={s.id} onClick={() => setPicked(s)} className="flex w-full items-center gap-3 rounded-xl border-2 bg-card p-4 text-left active:bg-accent">
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
          <section>
            <h2 className="mb-2 font-bold">Open a new tray</h2>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {(d?.trays ?? []).map((t: any) => {
                const busy = (d?.open ?? []).find((o: any) => o.tray_id === t.id);
                return (
                  <button key={t.id} disabled={!!busy} onClick={() => openTray(t)} className="rounded-xl border-2 bg-card p-3 text-center disabled:opacity-40">
                    <div className="text-4xl font-extrabold">{t.tray_code}</div>
                    <div className="text-xs">{busy ? "in use" : `${t.rows}×${t.columns}`}</div>
                  </button>
                );
              })}
            </div>
          </section>
          <div className="flex gap-2">
            <Button variant="outline" className="h-14 flex-1" onClick={() => setPicked(null)}>Change packet</Button>
            <Button className="h-14 flex-1" onClick={() => closeSublot(picked)}>Close sublot</Button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
