import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db, rpc, errMsg, fmt3 } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { buildManualZip, buildSheet, downloadBlob } from "@/lib/export";
import { useServerFn } from "@tanstack/react-start";
import { unsealSublot, photoLinks } from "@/lib/photos.functions";
import { PhotoPanel } from "@/components/sublot/PhotoPanel";
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
  const [tab, setTab] = useState("overview");
  const [copied, setCopied] = useState(false);
  const unseal = useServerFn(unsealSublot);
  const links = useServerFn(photoLinks);
  const { data, refetch } = useQuery({
    queryKey: ["sublot-admin", id],
    queryFn: async () => {
      const { data: s } = await db.from("sublots").select("*, product_types(*), lots(*, branches(*), vendors(*))").eq("id", id).single();
      const [t, r, pool, items, slots, photog, br, rm] = await Promise.all([
        db.from("sublot_targets").select("*").eq("sublot_id", id).maybeSingle(),
        db.from("reconciliations").select("*").eq("sublot_id", id).order("created_at", { ascending: false }).limit(1),
        db.from("huid_pool").select("id,huid,assigned_item_id").eq("sublot_id", id).is("deleted_at", null),
        db.from("items").select("id,pcs,net_weight,hold_flag,photo_url,gross_weight").eq("sublot_id", id).is("deleted_at", null),
        db.from("tag_slots").select("id,assigned_item_id").eq("sublot_id", id).is("superseded_at", null),
        db.from("user_roles").select("user_id, profiles:user_id(name)").eq("role", "photo"),
        db.from("bot_results").select("*").eq("sublot_id", id).order("created_at", { ascending: false }).limit(20),
        db.from("item_removals").select("*").eq("sublot_id", id).order("removed_at", { ascending: false }),
      ]);
      const removals = rm.data ?? [];
      const { data: voids } = await db.from("removal_voids").select("*").eq("sublot_id", id);
      const uids = [...new Set([...removals.map((x: any) => x.removed_by), ...(voids ?? []).map((v: any) => v.voided_by)])];
      const { data: profs } = uids.length ? await db.from("profiles").select("id,name").in("id", uids) : { data: [] };
      const nm = (u: string) => (profs ?? []).find((p: any) => p.id === u)?.name ?? "—";
      return { s, target: t.data, recon: r.data?.[0], pool: pool.data ?? [], items: items.data ?? [], slots: slots.data ?? [], photographers: photog.data ?? [], botResults: br.data ?? [],
        removals: removals.map((x: any) => {
          const v = (voids ?? []).find((v: any) => v.removal_id === x.id);
          return { ...x, by: nm(x.removed_by), void: v ? { ...v, by: nm(v.voided_by) } : null };
        }) };
    },
  });
  if (!data?.s) return <AppShell title="Sublot" back="/manager/lots"><p>Loading…</p></AppShell>;
  const { s, target, recon, pool, items, slots, removals } = data;
  const lot = s.lots;
  const tt = target ? target.declared_tags - target.removed_tags : 0;
  const tp = target ? target.declared_pieces - target.removed_pieces : 0;
  const tn = target ? Number(target.declared_net_weight) - Number(target.removed_net_weight) : 0;
  const enteredPcs = items.reduce((a: number, i: any) => a + i.pcs, 0);
  const enteredNet = items.reduce((a: number, i: any) => a + Number(i.net_weight ?? 0), 0);
  const holds = items.filter((i: any) => i.hold_flag).length;
  const poolFree = pool.filter((p: any) => !p.assigned_item_id).length;
  const freeSlots = slots.filter((x: any) => !x.assigned_item_id).length;
  const sealed = ["sealed", "photography", "ready_to_export", "exported", "closed"].includes(s.status);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try { await fn(); await refetch(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(""); }
  };

  const checks = [
    { ok: recon?.passed === true, label: "Reconciliation passed" },
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
        <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(id); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy ID"}</Button>
        {removals.length > 0 && <span className="rounded bg-destructive px-2 py-1 text-xs font-bold text-destructive-foreground">ITEMS REMOVED ({removals.length})</span>}
        {s.halt_reason && <span className="font-bold text-destructive">{s.halt_reason.replace(/_/g, " ")}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          {isMgr && s.status === "draft" && <Button className="h-12" disabled={!!busy} onClick={() => run("issue", async () => { const { error } = await db.from("sublots").update({ status: "issued" }).eq("id", id); if (error) throw error; toast.success("Issued — staff can now load trays"); })}>Issue to staff</Button>}
          {isMgr && s.status === "halted" && <Button variant="outline" onClick={() => run("reopen", () => rpc("manager_reopen_sublot", { p_sublot: id, p_status: "weighing" }))}>Reopen for weighing</Button>}
          {isMgr && s.status === "halted" && s.halt_reason === "bot_mismatch" && <Button variant="outline" onClick={() => run("reopen", () => rpc("manager_reopen_sublot", { p_sublot: id, p_status: "sealed" }))}>Clear halt (back to sealed)</Button>}
        </div>
      </div>
      {s.tags_continued > 0 && (
        <p className="mb-4 rounded-lg border-2 border-destructive bg-destructive/10 p-3 text-sm font-semibold text-destructive">{s.tags_continued} tag number{s.tags_continued === 1 ? " was" : "s were"} continued automatically beyond the imported list (marked "?" in Tag slots). The bot checks each one against the ERP.</p>
      )}
      {isMgr && s.status === "draft" && (
        <p className="mb-4 rounded-lg border border-warning bg-warning/10 p-3 text-sm">Draft — staff can't see this sublot yet. Import the tag slot list and HUID list, then tap <b>Issue to staff</b>. Staff then pick lot {lot.lot_no} on the Station screen.</p>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-3 h-auto flex-wrap">
          {["overview", "tag slots", "huids", "items", "photos", "seal & export"].map((t) => <TabsTrigger key={t} value={t} className="h-10 px-4 capitalize">{t}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="overview" className="space-y-3">
          {target && (
            <Box title="Reconciliation — declared / removed / entered">
              <div className="overflow-x-auto">
                <table className="num w-full text-sm">
                  <thead className="font-sans text-left text-xs text-muted-foreground"><tr><th className="p-1" /><th>Declared</th><th>Removed</th><th>Target</th><th>Entered</th><th>Variance</th></tr></thead>
                  <tbody>
                    {[
                      { k: "Tags (compartments)", d: target.declared_tags, r: target.removed_tags, e: items.length, f: String },
                      { k: "Pieces (HUIDs)", d: target.declared_pieces, r: target.removed_pieces, e: enteredPcs, f: String },
                      { k: "Net weight (g)", d: Number(target.declared_net_weight), r: Number(target.removed_net_weight), e: enteredNet, f: fmt3 },
                    ].map((row) => {
                      const tgt = row.d - row.r; const v = row.e - tgt;
                      return (
                        <tr key={row.k} className="border-t text-base">
                          <td className="p-1 font-sans text-sm font-semibold">{row.k}</td>
                          <td>{row.f(row.d)}</td>
                          <td className={row.r ? "font-bold text-destructive" : ""}>{row.r ? `−${row.f(row.r)}` : row.f(0)}</td>
                          <td className="font-bold">{row.f(tgt)}</td>
                          <td className="font-bold">{row.f(row.e)}</td>
                          <td className={`font-bold ${Math.abs(v) > 0.0005 ? "text-destructive" : "text-success"}`}>{v > 0 ? "+" : ""}{row.f(v)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">Removed = pieces that left the lot. Compartments marked in error do not appear here and do not change the target. Declared totals never change; weight tolerance is based on declared pieces ({target.declared_pieces}).</p>
            </Box>
          )}
          {removals.length > 0 && (
            <Box title="Removal log">
              <div className="overflow-x-auto"><table className="num w-full text-sm">
                <thead className="font-sans text-left text-xs text-muted-foreground"><tr><th className="p-1">When</th><th>By</th><th>Pos</th><th>Net</th><th>Pcs</th><th>HUIDs</th><th>Reason</th><th /></tr></thead>
                <tbody>{removals.map((x: any) => (
                  <tr key={x.id} className="border-t">
                    <td className={`p-1 ${x.void ? "line-through text-muted-foreground" : ""}`}>{new Date(x.removed_at).toLocaleString()}</td>
                    <td className={`font-sans ${x.void ? "line-through text-muted-foreground" : ""}`}>{x.by}</td>
                    <td className={x.void ? "line-through text-muted-foreground" : ""}>{x.tray_code}-{String(x.compartment_no).padStart(2, "0")}</td>
                    <td className={x.void ? "line-through text-muted-foreground" : ""}>{fmt3(x.net_weight)}</td>
                    <td className={x.void ? "line-through text-muted-foreground" : ""}>{x.pcs}</td>
                    <td className={x.void ? "line-through text-muted-foreground" : ""}>{x.huids ?? "—"}</td>
                    <td className={`font-sans ${x.void ? "line-through text-muted-foreground" : ""}`}>{x.reason}</td>
                    <td className="font-sans text-xs">
                      {x.void ? <span className="font-semibold">Voided by {x.void.by}, {new Date(x.void.voided_at).toLocaleString()}: {x.void.reason}</span>
                        : isMgr && !sealed && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => {
                          const r = prompt(`Void this removal?\nThe target goes back up by 1 tag, ${x.pcs} pcs and ${fmt3(x.net_weight)} g. Use this when the compartment was actually marked in error. The log row stays, struck through.\n\nReason (required):`);
                          if (r?.trim()) void run("void", () => rpc("void_removal", { p_removal: x.id, p_reason: r }));
                        }}>Void this removal</Button>}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            </Box>
          )}
          {recon && (
            <Box title={`Last reconciliation — ${recon.passed ? "PASS" : "FAIL"}`}>
              <div className="num grid grid-cols-2 gap-1 text-sm sm:grid-cols-5">
                {recon.target_tags != null && <span>Tags {recon.entered_tags}/{recon.target_tags} (Δ {recon.entered_tags - recon.target_tags})</span>}
                <span>Pieces {recon.entered_pcs}/{recon.target_pcs} (Δ {recon.entered_pcs - recon.target_pcs})</span>
                <span>Net Δ {fmt3(Number(recon.entered_net) - Number(recon.target_net))} g</span>
                <span>Tolerance ±{fmt3(recon.tolerance)}</span>
                <span>HUIDs left {recon.huids_remaining}</span>
              </div>
              {poolFree > 0 && (
                <p className="rounded bg-warning/30 p-2 text-sm font-semibold">
                  <span className="num">{poolFree} HUID{poolFree === 1 ? "" : "s"} not assigned: {pool.filter((p: any) => !p.assigned_item_id).map((p: any) => p.huid).join(", ")}</span>{" "}
                  <button type="button" className="underline" onClick={() => setTab("huids")}>Open HUIDs tab →</button>
                </p>
              )}
            </Box>
          )}
        </TabsContent>

        <TabsContent value="tag slots">
          <TagSlotPanel sublot={s} branch={lot.branches.branch_code} baseCode={s.product_types.base_code} declaredTags={target?.declared_tags} canEdit={isMgr && !sealed} onDone={refetch} />
        </TabsContent>
        <TabsContent value="huids">
          <HuidPanel sublot={s} expectedPieces={target?.declared_pieces} canEdit={isMgr && !sealed} onDone={refetch} />
          <p className="mt-2 text-xs text-muted-foreground">The pool should hold exactly one HUID per declared piece.</p>
        </TabsContent>
        <TabsContent value="items"><ItemsPanel sublotId={id} canEdit={isMgr} onChange={refetch} /></TabsContent>
        <TabsContent value="photos"><PhotoPanel sublot={s} isMgr={isMgr} onChange={refetch} /></TabsContent>

        <TabsContent value="seal & export" className="space-y-3">
          {!sealed && (
            <Box title="Seal preconditions">
              <ul className="space-y-1">{checks.map((c) => <li key={c.label} className={c.ok ? "text-success" : "font-semibold text-destructive"}>{c.ok ? "✓" : "✗"} {c.label}</li>)}</ul>
              <p className="text-xs text-muted-foreground">Sealing normally happens automatically when reconciliation passes. Use this only to recover a sublot that is halted or waiting to seal.</p>
              {isMgr && ["ready_to_seal", "halted"].includes(s.status) && (
                <Button className="h-14 w-full text-lg" disabled={!!busy || !checks.every((c) => c.ok)} onClick={() => {
                  if (!confirm("Seal? Tag numbers will be assigned, the sublot locked and sent to photography.")) return;
                  void run("seal", async () => { const n = await rpc<number>("seal_sublot", { p_sublot: id }); toast.success(`Sealed: ${n} tags assigned — now in photography`); });
                }}>Seal & assign tag slots</Button>
              )}
            </Box>
          )}
          {sealed && isMgr && settings && (
            <Box title="Exports">
              <div className="grid gap-2 sm:grid-cols-3">
                <Button className="h-14" disabled={!!busy} onClick={() => run("sheet", async () => { const { buf } = await buildSheet(id, settings.export_mapping); downloadBlob(buf, `${lot.lot_no}-S${s.sublot_no}.xlsx`); })}>Filled ERP sheet (Mode 1)</Button>
                <Button className="h-14" variant="outline" disabled={!!busy} onClick={() => run("zip", async () => { const l = await links({ data: { sublotId: id } }); const z = await buildManualZip(id, settings.export_mapping, name, l, (n, t) => setBusy(`zip ${n}/${t}`)); downloadBlob(z.blob, z.name); })}>Full manual ZIP (sheet + photos)</Button>
              </div>
              {busy && <p className="text-sm font-semibold">Working: {busy}…</p>}
              {["sealed", "ready_to_export"].includes(s.status) && <Button variant="outline" onClick={() => run("exp", () => rpc("mark_exported", { p_sublot: id }))}>Mark as exported</Button>}
              {["sealed", "photography", "ready_to_export"].includes(s.status) && (
                <Button variant="destructive" disabled={!!busy} onClick={() => {
                  const r = prompt("UNSEAL this sublot?\nTag numbers go back to the list, filenames are cleared and every uploaded photo is deleted. This is logged permanently.\n\nReason (required):");
                  if (!r?.trim()) return;
                  void run("unseal", async () => { const x = await unseal({ data: { sublotId: id, reason: r } }); toast.success(`Unsealed — ${x.deleted} photo(s) deleted`); });
                }}>Unseal…</Button>
              )}
              <Button variant="outline" onClick={() => run("clear", async () => {
                if (!confirm("Physically emptied the trays? This frees them for the next batch.")) return;
                const { data: ss } = await db.from("tray_sessions").select("id").eq("sublot_id", id).neq("status", "cleared");
                for (const x of ss ?? []) await rpc("clear_tray_session", { p_session: x.id });
                toast.success("Trays cleared");
              })}>Clear trays for reuse</Button>
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
