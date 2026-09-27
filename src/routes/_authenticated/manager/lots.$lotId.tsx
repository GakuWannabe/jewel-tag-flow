import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db, fmt3 } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { useMasters } from "./lots";

export const Route = createFileRoute("/_authenticated/manager/lots/$lotId")({
  head: () => ({ meta: [{ title: "Lot — Tagging Line" }, { name: "description", content: "Lot detail and sublots." }] }),
  component: LotDetail,
});

function LotDetail() {
  const { lotId } = Route.useParams();
  const { has } = useAuth();
  const { data: m } = useMasters();
  const { data, refetch } = useQuery({
    queryKey: ["lot", lotId],
    queryFn: async () => {
      const { data: lot } = await db.from("lots").select("*, branches(*), vendors(*), purities(*)").eq("id", lotId).single();
      const { data: subs } = await db.from("sublots").select("*, product_types(base_code,name)").eq("lot_id", lotId).is("deleted_at", null).order("sublot_no");
      const { data: tg } = await db.from("sublot_targets").select("*").in("sublot_id", (subs ?? []).map((s: any) => s.id));
      return { lot, subs: (subs ?? []).map((s: any) => ({ ...s, target: (tg ?? []).find((t: any) => t.sublot_id === s.id) })) };
    },
  });
  const [f, setF] = useState<any>({});

  const addSublot = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = (data?.subs.reduce((a: number, s: any) => Math.max(a, s.sublot_no), 0) ?? 0) + 1;
    const { data: s, error } = await db.from("sublots").insert({ lot_id: lotId, sublot_no: next, product_type_id: f.product_type_id }).select().single();
    if (error) return toast.error(error.message);
    const { error: e2 } = await db.from("sublot_targets").insert({ sublot_id: s.id, declared_pcs: Number(f.pcs), declared_net_weight: Number(f.net) });
    if (e2) return toast.error(e2.message);
    setF({}); refetch(); toast.success(`Sublot ${next} created`);
  };

  const lot = data?.lot;
  return (
    <AppShell title={lot ? `Lot ${lot.lot_no}` : "Lot"} back="/manager/lots">
      {lot && (
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg border bg-card p-4 text-sm sm:grid-cols-4">
          <Info k="Branch" v={`${lot.branches.branch_code} · ${lot.branches.branch_name}`} />
          <Info k="Vendor" v={`${lot.vendors.code} · ${lot.vendors.name}`} />
          <Info k="Purity" v={`${lot.purities.purity_label} (${Number(lot.melting).toFixed(2)})`} />
          <Info k="Received" v={lot.received_date} />
          <Info k="Wastage %" v={lot.wastage_pct} />
          <Info k="Making" v={`${lot.making_value} ${lot.making_type}`} />
          <div className="col-span-2"><Info k="Notes" v={lot.notes ?? "—"} /></div>
        </div>
      )}
      {has("manager") && m && (
        <form onSubmit={addSublot} className="mb-4 grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-4">
          <div><Label>Product type</Label>
            <select className="h-12 w-full rounded-md border border-input bg-background px-3" value={f.product_type_id ?? ""} onChange={(e) => setF({ ...f, product_type_id: e.target.value })} required>
              <option value="">—</option>{m.productTypes.map((p: any) => <option key={p.id} value={p.id}>{p.base_code} · {p.name}</option>)}
            </select>
          </div>
          <div><Label>Declared total pcs</Label><Input className="num h-12" inputMode="numeric" value={f.pcs ?? ""} onChange={(e) => setF({ ...f, pcs: e.target.value })} required /></div>
          <div><Label>Declared net weight (g)</Label><Input className="num h-12" inputMode="decimal" value={f.net ?? ""} onChange={(e) => setF({ ...f, net: e.target.value })} required /></div>
          <Button className="h-12 self-end" type="submit">Add sublot</Button>
        </form>
      )}
      <div className="space-y-2">
        {data?.subs.map((s: any) => (
          <Link key={s.id} to="/manager/sublot/$id" params={{ id: s.id }} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4 hover:border-primary">
            <div className="text-lg font-bold">#{s.sublot_no}</div>
            <div className="font-semibold">{s.product_types.base_code} · {s.product_types.name}</div>
            <StatusBadge status={s.status} />
            <div className="num ml-auto text-sm">{s.target ? `${s.target.declared_pcs} pcs · ${fmt3(s.target.declared_net_weight)} g` : ""}</div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}

const Info = ({ k, v }: { k: string; v: unknown }) => <div><div className="text-xs text-muted-foreground">{k}</div><div className="font-semibold">{String(v)}</div></div>;
