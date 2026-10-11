import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { Scale, Camera, Package, Database, Users, Settings, Activity, BarChart3, History } from "lucide-react";
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

function Home() {
  const { name, roles, has } = useAuth();
  const tiles = TILES.filter((t) => has(...t.roles));
  return (
    <AppShell title={name ? `Hello, ${name}` : "Tagging Line"}>
      {roles.length === 0 && <p className="rounded-md bg-warning p-4 font-semibold text-warning-foreground">Loading your access… If this stays, ask a manager to give you a role.</p>}
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
