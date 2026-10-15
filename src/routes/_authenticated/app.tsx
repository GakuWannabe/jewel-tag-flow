import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { supabase } from "@/integrations/supabase/client";
import { Scale, Package, Database, Users, Settings, Activity, BarChart3, History, AlertTriangle } from "lucide-react";
import type { Role } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({ meta: [{ title: "Home — Tagging Line" }, { name: "description", content: "Choose your station." }] }),
  component: Home,
});

const TILES: { to: string; label: string; sub: string; icon: typeof Scale; roles: Role[] }[] = [
  { to: "/station", label: "Tray station", sub: "Load · weigh · HUID", icon: Scale, roles: ["staff", "manager"] },
  { to: "/manager/lots", label: "Lots & sublots", sub: "Create · import · seal · export", icon: Package, roles: ["manager", "auditor"] },
  { to: "/wip", label: "WIP dashboard", sub: "Live tray status", icon: Activity, roles: ["manager", "auditor"] },
  { to: "/reports", label: "Throughput", sub: "Items per hour", icon: BarChart3, roles: ["manager", "auditor"] },
  { to: "/manager/activity", label: "Who did what", sub: "Weights · HUIDs · moves by user", icon: History, roles: ["manager", "auditor"] },
  { to: "/manager/master", label: "Master data", sub: "Branches · vendors · trays", icon: Database, roles: ["manager", "auditor"] },
  { to: "/manager/users", label: "Users", sub: "Staff & PINs", icon: Users, roles: ["manager"] },
  { to: "/manager/settings", label: "Settings", sub: "Tolerance · export map · bots", icon: Settings, roles: ["manager"] },
];

const REASON: Record<string, string> = {
  reconciliation_failed: "Reconciliation failed — counts or weight don't match",
  bot_mismatch: "ERP bot got a different tag number",
};
const plain = (r: string | null) => (r ? REASON[r] ?? r.replace(/_/g, " ") : "No reason recorded");

function HaltedBanner() {
  const { data, refetch } = useQuery({
    queryKey: ["halted-sublots"],
    queryFn: async () => (await db.from("sublots").select("id,sublot_no,halt_reason,product_types(name),lots(lot_no)").eq("status", "halted").is("deleted_at", null)).data ?? [],
  });
  useEffect(() => {
    const ch = supabase.channel("home-halted").on("postgres_changes", { event: "*", schema: "public", table: "sublots" }, () => void refetch()).subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [refetch]);
  if (!data?.length) return null;
  return (
    <section className="mb-4 rounded-xl border-2 border-destructive bg-destructive p-4 text-destructive-foreground">
      <h2 className="flex items-center gap-2 text-xl font-extrabold"><AlertTriangle className="h-6 w-6" />{data.length} sublot{data.length === 1 ? "" : "s"} halted — needs a manager</h2>
      <ul className="mt-2 space-y-1">
        {data.map((s: any) => (
          <li key={s.id}>
            <Link to="/manager/sublot/$id" params={{ id: s.id }} className="flex flex-wrap gap-x-3 rounded-lg bg-background/15 p-3 font-semibold hover:bg-background/25">
              <span className="num">{s.lots?.lot_no} · #{s.sublot_no}</span><span>{s.product_types?.name}</span><span className="font-normal">{plain(s.halt_reason)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Home() {
  const { name, roles, has } = useAuth();
  const tiles = TILES.filter((t) => has(...t.roles));
  return (
    <AppShell title={name ? `Hello, ${name}` : "Tagging Line"}>
      {roles.length === 0 && <p className="rounded-md bg-warning p-4 font-semibold text-warning-foreground">Loading your access… If this stays, ask a manager to give you a role.</p>}
      {has("manager", "auditor") && <HaltedBanner />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to} className="flex min-h-24 items-center gap-4 rounded-xl border-2 border-border bg-card p-4 transition-colors active:bg-accent hover:border-primary">
            <t.icon className="h-10 w-10 shrink-0 text-primary" />
            <div>
              <div className="text-xl font-bold">{t.label}</div>
              <div className="text-sm text-muted-foreground">{t.sub}</div>
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
