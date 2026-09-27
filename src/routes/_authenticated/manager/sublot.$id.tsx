import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db, rpc, errMsg, fmt3 } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { buildManualZip, buildRenamedPhotoZip, buildSheet, downloadBlob } from "@/lib/export";
import { TagSlotPanel } from "@/components/sublot/TagSlotPanel";
import { HuidPanel } from "@/components/sublot/HuidPanel";
import { ItemsPanel } from "@/components/sublot/ItemsPanel";

export const Route = createFileRoute("/_authenticated/manager/sublot/$id")({
  head: () => ({ meta: [{ title: "Sublot — Tagging Line" }, { name: "description", content: "Imports, reconciliation, seal and export." }] }),
  component: SublotPage,
});

function SublotPage() {
  const { id } = Route.useParams();
  const { has, name } = useAuth();
  const isMgr = has("manager");
  const { data: settings } = useSettings();
  const [busy, setBusy] = useState("");
  const { data, refetch } = useQuery({
    queryKey: ["sublot-admin", id],
    queryFn: async () => {
      const { data: s } = await db.from("sublots").select("*, product_types(*), lots(*, branches(*), vendors(*))").eq("id", id).single();
      const [t, r, pool, items, slots, photog, br] = await Promise.all([
        db.from("sublot_targets").select("*").eq("sublot_id", id).maybeSingle(),
        db.from("reconciliations").select("*").eq("sublot_id", id).order("created_at", { ascending: false }).limit(1),
        db.from("huid_pool").select("id,assigned_item_id").eq("sublot_id", id).is("deleted_at", null),
        db.from("items").select("id,pcs,net_weight,hold_flag,photo_url,gross_weight").eq("sublot_id", id).is("deleted_at", null),
        db.from("tag_slots").select("id,assigned_item_id").eq("sublot_id", id).is("superseded_at", null),
        db.from("user_roles").select("user_id, profiles:user_id(name)").eq("role", "photo"),
        db.from("bot_results").select("*").eq("sublot_id", id).order("created_at", { ascending: false }).limit(20),
      ]);
      return { s, target: t.data, recon: r.data?.[0], pool: pool.data ?? [], items: items.data ?? [], slots: slots.data ?? [], photographers: photog.data ?? [], botResults: br.data ?? [] };
    },
  });
  if (!data?.s) return <AppShell title="Sublot" back="/manager/lots"><p>Loading…</p></AppShell>;
  const { s, target, recon, pool, items, slots } = data;
  const lot = s.lots;
  const tp = target ? target.declared_pcs + target.adjust_pcs : 0;
  const tn = target ? Number(target.declared_net_weight) + Number(target.adjust_net_weight) : 0;
  const enteredPcs = items.reduce((a: number, i: any) => a + i.pcs, 0);
  const enteredNet = items.reduce((a: number, i: any) => a + Number(i.net_weight ?? 0), 0);
  const holds = items.filter((i: any) => i.hold_flag).length;
  const missingPhotos = items.filter((i: any) => !i.photo_url).length;
  const poolFree = pool.filter((p: any) => !p.assigned_item_id).length;
  const freeSlots = slots.filter((x: any) => !x.assigned_item_id).length;
  const sealed = ["sealed", "exported", "closed"].includes(s.status);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try { await fn(); await refetch(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(""); }
  };

  const checks = [
    { ok: recon?.passed === true, label: "Reconciliation passed" },
    { ok: missingPhotos === 0 && items.length > 0, label: `All photos matched (${missingPhotos} missing)` },
    { ok: holds === 0, label: `No open holds (${holds})` },
    { ok: poolFree === 0, label: `HUID pool empty (${poolFree} left)` },
    { ok: freeSlots >= items.length, label: `Enough tag slots (${freeSlots} for ${items.length})` },
  ];

  return (
    <AppShell title={`${lot.lot_no} · Sublot ${s.sublot_no}`} back={`/manager/lots/${lot.id}`}>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
        <div className="text-lg font-bold">{s.product_types.base_code} · {s.product_types.name}</div>
        <div className="num text-sm">IC {lot.branches.branch_code}{s.product_types.base_code}</div>
        <StatusBadge status={s.status} />
        {s.halt_reason && <span className="font-bold text-destructive">{s.halt_reason.replace(/_/g, " ")}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          {isMgr && s.status === "draft" && <Button disabled={!!busy} onClick={() => run("issue", () => db.from("sublots").update({ status: "issued" }).eq("id", id))}>Issue to staff</Button>}
          {isMgr && s.status === "halted" && <Button variant="outline" onClick={() => run("reopen", () => rpc("manager_reopen_sublot", { p_sublot: id, p_status: "weighing" }))}>Reopen for weighing</Button>}
          {isMgr && s.status === "halted" && s.halt_reason === "bot_mismatch" && <Button variant="outline" onClick={() => run("reopen", () => rpc("manager_reopen_sublot", { p_sublot: id, p_status: "sealed" }))}>Clear halt (back to sealed)</Button>}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-3 h-auto flex-wrap">
          {["overview", "tag slots", "huids", "items", "photos", "seal & export"].map((t) => <TabsTrigger key={t} value={t} className="h-10 px-4 capitalize">{t}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="overview" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Box title="Pieces"><Cmp a={enteredPcs} b={tp} fmt={(x) => String(x)} /></Box>
            <Box title="Net weight (g)"><Cmp a={enteredNet} b={tn} fmt={fmt3} /></Box>
          </div>
          {target && (target.adjust_pcs !== 0 || Number(target.adjust_net_weight) !== 0) && (
            <p className="text-sm text-muted-foreground">Declared {target.declared_pcs} pcs / {fmt3(target.declared_net_weight)} g, adjusted by removals {target.adjust_pcs} pcs / {fmt3(target.adjust_net_weight)} g.</p>
          )}
          {recon && (
            <Box title={`Last reconciliation — ${recon.passed ? "PASS" : "FAIL"}`}>
              <div className="num grid grid-cols-2 gap-1 text-sm sm:grid-cols-4">
                <span>Pcs {recon.entered_pcs}/{recon.target_pcs} (Δ {recon.entered_pcs - recon.target_pcs})</span>
                <span>Net Δ {fmt3(Number(recon.entered_net) - Number(recon.target_net))} g</span>
                <span>Tolerance ±{fmt3(recon.tolerance)}</span>
                <span>HUIDs left {recon.huids_remaining}</span>
              </div>
            </Box>
          )}
          {isMgr && (
            <Box title="Photographer">
              <select className="h-12 w-full rounded-md border bg-background px-3" value={s.photographer_id ?? ""} onChange={(e) => run("photog", () => db.from("sublots").update({ photographer_id: e.target.value || null }).eq("id", id))}>
                <option value="">— unassigned —</option>
                {data.photographers.map((p: any) => <option key={p.user_id} value={p.user_id}>{p.profiles?.name ?? p.user_id}</option>)}
              </select>
              <Link to="/photo/$sublotId" params={{ sublotId: id }} className="text-sm font-semibold underline">Open shot list</Link>
            </Box>
          )}
        </TabsContent>

        <TabsContent value="tag slots">
          <TagSlotPanel sublot={s} branch={lot.branches.branch_code} baseCode={s.product_types.base_code} declaredPcs={target?.declared_pcs} canEdit={isMgr && !sealed} onDone={refetch} />
        </TabsContent>
        <TabsContent value="huids">
          <HuidPanel sublot={s} expectedPieces={target ? target.declared_pcs * 1 : undefined} canEdit={isMgr && !sealed} onDone={refetch} />
          <p className="mt-2 text-xs text-muted-foreground">Declared pcs already count pieces (a pair = 2), so the pool should hold one HUID per declared piece.</p>
        </TabsContent>
        <TabsContent value="items"><ItemsPanel sublotId={id} canEdit={isMgr} onChange={refetch} /></TabsContent>
        <TabsContent value="photos">
          <Box title="Photos">
            <p>{items.length - missingPhotos} of {items.length} matched.</p>
            <Link to="/photo/$sublotId" params={{ sublotId: id }} className="font-semibold underline">Shot list & ZIP upload</Link>
          </Box>
        </TabsContent>

        <TabsContent value="seal & export" className="space-y-3">
          {!sealed && (
            <Box title="Seal preconditions">
              <ul className="space-y-1">{checks.map((c) => <li key={c.label} className={c.ok ? "text-success" : "font-semibold text-destructive"}>{c.ok ? "✓" : "✗"} {c.label}</li>)}</ul>
              {isMgr && (
                <Button className="h-14 w-full text-lg" disabled={!!busy || !checks.every((c) => c.ok) || s.status !== "ready_to_seal"} onClick={() => {
                  if (!confirm("Seal? Tag numbers will be assigned and the sublot locked.")) return;
                  void run("seal", async () => { const n = await rpc<number>("seal_sublot", { p_sublot: id }); toast.success(`Sealed: ${n} tags assigned`); });
                }}>Seal & assign tag slots</Button>
              )}
            </Box>
          )}
          {sealed && isMgr && settings && (
            <Box title="Exports">
              <div className="grid gap-2 sm:grid-cols-3">
                <Button className="h-14" disabled={!!busy} onClick={() => run("sheet", async () => { const { buf } = await buildSheet(id, settings.export_mapping); downloadBlob(buf, `${lot.lot_no}-S${s.sublot_no}.xlsx`); })}>Filled ERP sheet (Mode 1)</Button>
                <Button className="h-14" variant="secondary" disabled={!!busy} onClick={() => run("photos", async () => { const z = await buildRenamedPhotoZip(id, (n, t) => setBusy(`photos ${n}/${t}`)); downloadBlob(z.blob, z.name); })}>Renamed photos ZIP</Button>
                <Button className="h-14" variant="outline" disabled={!!busy} onClick={() => run("zip", async () => { const z = await buildManualZip(id, settings.export_mapping, name, (n, t) => setBusy(`zip ${n}/${t}`)); downloadBlob(z.blob, z.name); })}>Full manual ZIP</Button>
              </div>
              {busy && <p className="text-sm font-semibold">Working: {busy}…</p>}
              {s.status === "sealed" && <Button variant="outline" onClick={() => run("exp", () => rpc("mark_exported", { p_sublot: id }))}>Mark as exported</Button>}
              <p className="text-xs text-muted-foreground">Mode 2 bot API: <code className="num">/api/public/batches/{id}/items</code> with header <code>x-api-key</code>.</p>
            </Box>
          )}
          {data.botResults.length > 0 && (
            <Box title="Bot results">
              <table className="num w-full text-sm"><tbody>{data.botResults.map((b: any) => (
                <tr key={b.id} className={b.mismatch || b.status === "failed" ? "text-destructive font-bold" : ""}><td>#{b.sequence}</td><td>exp {b.expected_ser_no}</td><td>got {b.actual_ser_no ?? "—"}</td><td>{b.status}</td><td className="font-sans">{b.error_message}</td></tr>
              ))}</tbody></table>
            </Box>
          )}
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

const Box = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2 rounded-lg border bg-card p-4"><h3 className="font-bold">{title}</h3>{children}</section>
);
function Cmp({ a, b, fmt }: { a: number; b: number; fmt: (n: number) => string }) {
  const d = a - b;
  return (
    <div className="num grid grid-cols-3 gap-2 text-center">
      <div><div className="font-sans text-xs text-muted-foreground">Entered</div><div className="text-2xl font-bold">{fmt(a)}</div></div>
      <div><div className="font-sans text-xs text-muted-foreground">Target</div><div className="text-2xl font-bold">{fmt(b)}</div></div>
      <div><div className="font-sans text-xs text-muted-foreground">Variance</div><div className={`text-2xl font-bold ${Math.abs(d) > 0.0005 ? "text-destructive" : "text-success"}`}>{d > 0 ? "+" : ""}{fmt(d)}</div></div>
    </div>
  );
}
