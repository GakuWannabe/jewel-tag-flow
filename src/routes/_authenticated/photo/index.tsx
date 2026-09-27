import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { db } from "@/lib/db";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/photo/")({
  head: () => ({ meta: [{ title: "Photography — Tagging Line" }, { name: "description", content: "Assigned shot lists." }] }),
  component: PhotoIndex,
});

function PhotoIndex() {
  const { userId, has } = useAuth();
  const { data = [] } = useQuery({
    queryKey: ["photo-index", userId],
    queryFn: async () => {
      let q = db.from("sublots").select("id,sublot_no,status,photographer_id, lots(lot_no), product_types(base_code)").in("status", ["photography", "ready_to_seal"]).is("deleted_at", null);
      if (!has("manager")) q = q.eq("photographer_id", userId);
      return (await q).data ?? [];
    },
    enabled: !!userId,
  });
  return (
    <AppShell title="Photography" back="/app">
      <div className="space-y-2">
        {data.map((s: any) => (
          <Link key={s.id} to="/photo/$sublotId" params={{ sublotId: s.id }} className="flex items-center gap-3 rounded-xl border-2 bg-card p-4">
            <span className="num text-2xl font-bold">{s.lots.lot_no}</span><span>#{s.sublot_no} · {s.product_types.base_code}</span>
            <span className="ml-auto"><StatusBadge status={s.status} /></span>
          </Link>
        ))}
        {data.length === 0 && <p className="text-muted-foreground">No sublots assigned to you for photography.</p>}
      </div>
    </AppShell>
  );
}
