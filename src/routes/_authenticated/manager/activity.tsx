/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { db, fmt3 } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/manager/activity")({
  head: () => ({
    meta: [
      { title: "Who did what — Tagging Line" },
      { name: "description", content: "See which staff member loaded, weighed and matched HUIDs for every product." },
      { property: "og:title", content: "Who did what — Tagging Line" },
      { property: "og:description", content: "User-wise activity log for the tagging line." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Activity,
});

const sel = "h-12 rounded-md border border-input bg-background px-3";
const t = (s?: string | null) => (s ? new Date(s).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—");

function describe(a: string) {
  if (a === "loaded") return "Placed in tray";
  if (a === "weighed") return "Entered weight";
  if (a === "huid") return "Matched HUIDs";
  if (a.startsWith("moved:")) return `Moved compartment ${a.slice(6).replace("->", " → ")}`;
  if (a.startsWith("huid_import:")) return `Added ${a.split(":")[1]} HUIDs to list`;
  if (a.startsWith("tag_import:")) return `Saved ${a.split(":")[1]} tag numbers`;
  return a;
}

function Activity() {
  const [tab, setTab] = useState<"products" | "log">("products");
  const [sublot, setSublot] = useState("");
  const [user, setUser] = useState("");

  const { data: base } = useQuery({
    queryKey: ["activity-base"],
    queryFn: async () => {
      const [p, s] = await Promise.all([
        db.from("profiles").select("id,name,username"),
        db.from("sublots").select("id,sublot_no, lots(lot_no), product_types(base_code)").is("deleted_at", null).order("created_at", { ascending: false }),
      ]);
      return { profiles: p.data ?? [], sublots: s.data ?? [] };
    },
  });
  const who = useMemo(() => { const m = new Map<string, string>(); for (const p of base?.profiles ?? []) m.set(p.id, p.name || p.username); return (id?: string | null) => (id ? m.get(id) ?? "?" : "—"); }, [base]);
  const sublotId = sublot || base?.sublots?.[0]?.id || "";

  const { data: items = [] } = useQuery({
    enabled: !!sublotId && tab === "products",
    queryKey: ["activity-items", sublotId],
    queryFn: async () => {
      const [it, ev] = await Promise.all([
        db.from("items").select("id,compartment_no,gross_weight,less_weight,net_weight,pcs,created_by,created_at,weighed_by,weighed_at, tray_sessions(trays(tray_code)), item_huids(removed_at,created_by,created_at, huid_pool(huid))").eq("sublot_id", sublotId).is("deleted_at", null),
        db.from("station_events").select("item_id,action,user_id,created_at").eq("sublot_id", sublotId).like("action", "moved:%"),
      ]);
      const moves: Record<string, any[]> = {};
      for (const e of ev.data ?? []) (moves[e.item_id] ??= []).push(e);
      return (it.data ?? []).map((i: any) => ({ ...i, moves: moves[i.id] ?? [] }))
        .sort((a: any, b: any) => a.tray_sessions.trays.tray_code.localeCompare(b.tray_sessions.trays.tray_code) || a.compartment_no - b.compartment_no);
    },
  });

  const { data: log = [] } = useQuery({
    enabled: tab === "log",
    queryKey: ["activity-log", sublot, user],
    queryFn: async () => {
      let q = db.from("station_events").select("id,action,station,user_id,created_at,item_id, items(compartment_no, net_weight, tray_sessions(trays(tray_code))), sublots(sublot_no, lots(lot_no))").order("created_at", { ascending: false }).limit(500);
      if (sublot) q = q.eq("sublot_id", sublot);
      if (user) q = q.eq("user_id", user);
      return (await q).data ?? [];
    },
  });

  const perUser = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const e of log) { const k = who(e.user_id); const a = describe(e.action).split(" ")[0] + " " + (describe(e.action).split(" ")[1] ?? ""); (m[k] ??= {})[a] = ((m[k] ??= {})[a] ?? 0) + 1; }
    return m;
  }, [log, who]);

  return (
    <AppShell title="Who did what" back="/app">
      <div className="mb-3 flex flex-wrap gap-2">
        {(["products", "log"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={cn("h-12 rounded-lg border-2 px-4 font-bold", tab === k ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>
            {k === "products" ? "Product by product" : "Activity log by user"}
          </button>
        ))}
        <select className={sel} value={sublot} onChange={(e) => setSublot(e.target.value)}>
          {tab === "log" && <option value="">All sublots</option>}
          {(base?.sublots ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.lots?.lot_no} #{s.sublot_no} · {s.product_types?.base_code}</option>)}
        </select>
        {tab === "log" && (
          <select className={sel} value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">All users</option>
            {(base?.profiles ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name || p.username}</option>)}
          </select>
        )}
      </div>

      {tab === "products" ? (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left"><tr>
              <th className="p-2">Position</th><th>Net g (gross / less)</th><th>Pcs</th><th>Placed by</th><th>Weight by</th><th>HUIDs · by</th><th>Moves</th>
            </tr></thead>
            <tbody>
              {items.map((i: any) => {
                const h = i.item_huids.filter((x: any) => !x.removed_at);
                return (
                  <tr key={i.id} className="border-t align-top">
                    <td className="num p-2 font-bold">{i.tray_sessions.trays.tray_code}-{String(i.compartment_no).padStart(2, "0")}</td>
                    <td className="num">{fmt3(i.net_weight)} <span className="text-muted-foreground">({fmt3(i.gross_weight)} / {fmt3(i.less_weight)})</span></td>
                    <td className="num">{i.pcs}</td>
                    <td>{who(i.created_by)}<div className="text-xs text-muted-foreground">{t(i.created_at)}</div></td>
                    <td>{i.weighed_by ? <>{who(i.weighed_by)}<div className="text-xs text-muted-foreground">{t(i.weighed_at)}</div></> : "—"}</td>
                    <td>{h.length ? <><span className="num">{h.map((x: any) => x.huid_pool.huid).join(", ")}</span><div className="text-xs text-muted-foreground">{who(h[0].created_by)} · {t(h[0].created_at)}</div></> : "—"}</td>
                    <td className="text-xs">{i.moves.map((m: any, k: number) => <div key={k}>{m.action.slice(6).replace("->", "→")} · {who(m.user_id)} · {t(m.created_at)}</div>)}</td>
                  </tr>
                );
              })}
              {items.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No products yet.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(perUser).map(([u, c]) => (
              <div key={u} className="rounded-lg border bg-card p-3">
                <div className="font-bold">{u}</div>
                <div className="text-sm text-muted-foreground">{Object.entries(c).map(([a, n]) => `${a}: ${n}`).join(" · ")}</div>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left"><tr><th className="p-2">When</th><th>Who</th><th>What</th><th>Lot / sublot</th><th>Position</th></tr></thead>
              <tbody>
                {log.map((e: any) => (
                  <tr key={e.id} className="border-t">
                    <td className="p-2 text-xs">{t(e.created_at)}</td>
                    <td className="font-semibold">{who(e.user_id)}</td>
                    <td>{describe(e.action)}</td>
                    <td className="num">{e.sublots ? `${e.sublots.lots?.lot_no} #${e.sublots.sublot_no}` : "—"}</td>
                    <td className="num">{e.items ? `${e.items.tray_sessions?.trays?.tray_code}-${String(e.items.compartment_no).padStart(2, "0")}` : ""}</td>
                  </tr>
                ))}
                {log.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Nothing recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
