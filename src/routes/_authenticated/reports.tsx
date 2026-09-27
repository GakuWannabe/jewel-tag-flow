import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/db";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Throughput — Tagging Line" }, { name: "description", content: "Items per hour by user, station and date." }] }),
  component: Reports,
});

/** Active hours = distinct clock-hours with at least one event. Items/hour = distinct items ÷ active hours. */
function Reports() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const { data } = useQuery({
    queryKey: ["tp", from, to],
    queryFn: async () => {
      const [e, p] = await Promise.all([
        db.from("station_events").select("item_id,station,user_id,created_at").gte("created_at", `${from}T00:00:00`).lte("created_at", `${to}T23:59:59`).limit(50000),
        db.from("profiles").select("id,name"),
      ]);
      return { events: e.data ?? [], names: Object.fromEntries((p.data ?? []).map((x: any) => [x.id, x.name])) };
    },
  });
  const rows = new Map<string, { date: string; user: string; station: string; items: Set<string>; hours: Set<string> }>();
  for (const ev of data?.events ?? []) {
    const d = new Date(ev.created_at);
    const date = d.toLocaleDateString("en-CA");
    const k = `${date}|${ev.user_id}|${ev.station}`;
    const r = rows.get(k) ?? { date, user: data!.names[ev.user_id] ?? "?", station: ev.station, items: new Set(), hours: new Set() };
    if (ev.item_id) r.items.add(ev.item_id);
    r.hours.add(`${date}-${d.getHours()}`);
    rows.set(k, r);
  }
  const list = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date) || a.station.localeCompare(b.station) || a.user.localeCompare(b.user));
  return (
    <AppShell title="Throughput" back="/app">
      <div className="mb-3 flex gap-2">
        <Input type="date" className="h-12" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="h-12" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left"><tr><th className="p-2">Date</th><th>Station</th><th>User</th><th>Items</th><th>Active hours</th><th>Items/hour</th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={`${r.date}${r.user}${r.station}`} className="border-t">
                <td className="p-2">{r.date}</td><td className="capitalize">{r.station}</td><td>{r.user}</td>
                <td className="num">{r.items.size}</td><td className="num">{r.hours.size}</td><td className="num font-bold">{(r.items.size / Math.max(1, r.hours.size)).toFixed(1)}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No activity in this range.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Data collection only — visible to managers and auditors.</p>
    </AppShell>
  );
}
