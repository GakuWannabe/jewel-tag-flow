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
import { useMasters } from "./lots.index";

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
  // once the manager types in Pieces, never overwrite it silently
  const [piecesTouched, setPiecesTouched] = useState(false);
  const pt = m?.productTypes.find((p: any) => p.id === f.product_type_id);
  const suggested = pt && f.tags && Number.isFinite(Number(f.tags)) ? String(Number(f.tags) * pt.default_pcs) : "";
  const showSuggest = piecesTouched && suggested && suggested !== f.pieces;

  const applyTagsOrType = (next: any) => {
    const p = m?.productTypes.find((x: any) => x.id === next.product_type_id);
    const sug = p && next.tags && Number.isFinite(Number(next.tags)) ? String(Number(next.tags) * p.default_pcs) : "";
    setF(piecesTouched ? next : { ...next, pieces: sug });
  };

  const addSublot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (showSuggest && !confirm(`Pieces is ${f.pieces}, but ${f.tags} tags × ${pt.default_pcs} pcs = ${suggested}. Keep ${f.pieces}?`)) return;
    const next = (data?.subs.reduce((a: number, s: any) => Math.max(a, s.sublot_no), 0) ?? 0) + 1;
    const { data: s, error } = await db.from("sublots").insert({ lot_id: lotId, sublot_no: next, product_type_id: f.product_type_id }).select().single();
    if (error) return toast.error(error.message);
    const { error: e2 } = await db.from("sublot_targets").insert({ sublot_id: s.id, declared_tags: Number(f.tags), declared_pieces: Number(f.pieces), declared_net_weight: Number(f.net) });
    if (e2) return toast.error(e2.message);
    setF({}); setPiecesTouched(false); refetch(); toast.success(`Sublot ${next} created as draft`);
  };

  const issue = async (id: string, no: number) => {
    const { error } = await db.from("sublots").update({ status: "issued" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Sublot ${no} issued to staff`); refetch();
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
      {has("manager") && (
        <section className="mb-4 rounded-lg border-2 border-primary bg-card p-4">
          <h2 className="mb-1 text-lg font-bold">Add sublot</h2>
          <p className="mb-3 text-sm text-muted-foreground">One sublot = one product type. Steps: 1) add sublot here → 2) open it, import tag slots + HUID list → 3) Issue to staff.</p>
          {!m ? <p>Loading…</p> : m.productTypes.length === 0 ? <p className="text-destructive">Add product types in Master data first.</p> : (
            <form onSubmit={addSublot} className="grid gap-3 sm:grid-cols-5">
              <div><Label>Product type</Label>
                <select className="h-12 w-full rounded-md border border-input bg-background px-3" value={f.product_type_id ?? ""} onChange={(e) => applyTagsOrType({ ...f, product_type_id: e.target.value })} required>
                  <option value="">—</option>{m.productTypes.map((p: any) => <option key={p.id} value={p.id}>{p.base_code} · {p.name} ({p.default_pcs} pcs/tag)</option>)}
                </select>
              </div>
              <div><Label>Tags (compartments)</Label><Input className="num h-12" inputMode="numeric" value={f.tags ?? ""} onChange={(e) => applyTagsOrType({ ...f, tags: e.target.value })} required /></div>
              <div><Label>Pieces (HUIDs)</Label><Input className="num h-12" inputMode="numeric" value={f.pieces ?? ""} onChange={(e) => { setPiecesTouched(true); setF({ ...f, pieces: e.target.value }); }} required />
                {showSuggest
                  ? <button type="button" className="mt-1 text-left text-xs font-semibold text-warning-foreground underline" onClick={() => { setF({ ...f, pieces: suggested }); setPiecesTouched(false); }}>Tags changed: {f.tags} × {pt.default_pcs} = {suggested}. Use {suggested}?</button>
                  : <p className="text-xs text-muted-foreground">Pre-filled as tags × pcs/tag; edit if needed.</p>}
              </div>
              <div><Label>Declared net weight (g)</Label><Input className="num h-12" inputMode="decimal" value={f.net ?? ""} onChange={(e) => setF({ ...f, net: e.target.value })} required /></div>
              <Button className="h-12 self-end" type="submit">Add sublot</Button>
            </form>
          )}
        </section>
      )}
      <div className="space-y-2">
        {data?.subs.length === 0 && <p className="text-muted-foreground">No sublots yet.</p>}
        {data?.subs.map((s: any) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
            <Link to="/manager/sublot/$id" params={{ id: s.id }} className="flex flex-1 flex-wrap items-center gap-3 hover:text-primary">
              <div className="text-lg font-bold">#{s.sublot_no}</div>
              <div className="font-semibold">{s.product_types.base_code} · {s.product_types.name}</div>
              <StatusBadge status={s.status} />
              {s.target && s.target.removed_tags > 0 && <span className="rounded bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground">ITEMS REMOVED</span>}
              <div className="num ml-auto text-sm">{s.target ? `${s.target.declared_tags} tags · ${s.target.declared_pieces} pieces · ${fmt3(s.target.declared_net_weight)} g` : ""}</div>
            </Link>
            {has("manager") && s.status === "draft" && <Button className="h-12" onClick={() => issue(s.id, s.sublot_no)}>Issue to staff</Button>}
            <Link to="/manager/sublot/$id" params={{ id: s.id }} className="text-sm font-semibold underline">Open →</Link>
          </div>
        ))}
      </div>
    </AppShell>
  );
}

const Info = ({ k, v }: { k: string; v: unknown }) => <div><div className="text-xs text-muted-foreground">{k}</div><div className="font-semibold">{String(v)}</div></div>;
