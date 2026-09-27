import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { db } from "@/lib/db";
import { useSettings } from "@/lib/settings";

export const Route = createFileRoute("/_authenticated/wip")({
  head: () => ({ meta: [{ title: "WIP dashboard — Tagging Line" }, { name: "description", content: "Live view of every open tray." }] }),
  component: Wip,
});

function Wip() {
  const { data: settings } = useSettings();
  const [now, setNow] = useState(Date.now());
  const { data, refetch } = useQuery({
    queryKey: ["wip"],
    queryFn: async () => {
      const [s, p, c] = await Promise.all([
        db.from("tray_sessions").select("*, trays(tray_code), sublots(id,sublot_no,status, lots(lot_no))").neq("status", "cleared").order("station_since"),
        db.from("profiles").select("id,name"),
        db.from("sync_conflicts").select("*").is("resolved_at", null).order("created_at", { ascending: false }),
      ]);
      return { sessions: s.data ?? [], names: Object.fromEntries((p.data ?? []).map((x: any) => [x.id, x.name])), conflicts: c.data ?? [] };
    },
  });

  useEffect(() => {
    const ch = db.channel("wip")
      .on("postgres_changes", { event: "*", schema: "public", table: "tray_sessions" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, () => refetch())
      .subscribe();
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => { db.removeChannel(ch); clearInterval(t); };
  }, [refetch]);

  const threshold = settings?.ageing_minutes ?? 30;
  return (
    <AppShell title="WIP dashboard" back="/app">
      {data?.conflicts.length ? (
        <div className="mb-4 rounded-lg border-2 border-destructive bg-destructive/10 p-3">
          <h2 className="font-bold text-destructive">Offline sync conflicts ({data.conflicts.length})</h2>
          {data.conflicts.map((c: any) => (
            <div key={c.id} className="flex items-center justify-between gap-2 border-t py-1 text-sm">
              <span><b>{data.names[c.created_by] ?? "?"}</b> · {c.op?.label}: {c.error}</span>
              <button className="rounded bg-card px-2 py-1 text-xs font-semibold" onClick={async () => { await db.from("sync_conflicts").update({ resolved_at: new Date().toISOString(), resolved_by: (await db.auth.getUser()).data.user?.id }).eq("id", c.id); refetch(); }}>Resolve</button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left"><tr><th className="p-2">Lot</th><th>Sublot</th><th>Tray</th><th>Status</th><th>Station</th><th>Holder</th><th>Minutes</th></tr></thead>
          <tbody>
            {(data?.sessions ?? []).map((s: any) => {
              const mins = Math.floor((now - new Date(s.station_since).getTime()) / 60000);
              const old = mins >= threshold && !["tagged"].includes(s.status);
              return (
                <tr key={s.id} className={`border-t ${old ? "bg-destructive/15 font-bold" : ""}`}>
                  <td className="num p-2">{s.sublots.lots.lot_no}</td>
                  <td><Link to="/manager/sublot/$id" params={{ id: s.sublots.id }} className="underline">#{s.sublots.sublot_no}</Link></td>
                  <td className="text-xl font-extrabold">{s.trays.tray_code}</td>
                  <td className="uppercase">{s.status}</td>
                  <td className="capitalize">{s.station}</td>
                  <td>{data?.names[s.holder_id] ?? "—"}</td>
                  <td className={`num ${old ? "text-destructive" : ""}`}>{mins}</td>
                </tr>
              );
            })}
            {data?.sessions.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No open trays.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Rows turn red after {threshold} minutes at one station. Tagged trays can be cleared from the sublot once exported.</p>
    </AppShell>
  );
}
