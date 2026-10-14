/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, X, Copy, ChevronRight, Check } from "lucide-react";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db, fmt3, errMsg } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { useMasters, Field, Choice } from "./lots.index";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/manager/lots/$lotId")({
  head: () => ({ meta: [{ title: "Lot — Tagging Line" }, { name: "description", content: "Lot totals and its sublots." }] }),
  component: LotDetail,
});

const MAKING = [
  { v: "per_gram", label: "Per gram", sub: "₹ × grams" },
  { v: "percentage", label: "Percentage", sub: "% of value" },
  { v: "per_piece", label: "Per piece", sub: "₹ × pieces" },
] as const;
const makingLabel = (t?: string) => MAKING.find((x) => x.v === t)?.label ?? "—";

function LotDetail() {
  const { lotId } = Route.useParams();
  const { has } = useAuth();
  const isMgr = has("manager");
  const { data: m } = useMasters();
  const { data, refetch } = useQuery({
    queryKey: ["lot", lotId],
    queryFn: async () => {
      const [{ data: lot }, { data: lt }, { data: subs }] = await Promise.all([
        db.from("lots").select("*, branches(*)").eq("id", lotId).single(),
        db.from("lot_targets").select("*").eq("lot_id", lotId).maybeSingle(),
        db.from("sublots").select("*, product_types(base_code,name,default_pcs), vendors(code,name), purities(purity_label,melting)").eq("lot_id", lotId).is("deleted_at", null).order("sublot_no"),
      ]);
      const { data: tg } = (subs ?? []).length ? await db.from("sublot_targets").select("*").in("sublot_id", subs.map((s: any) => s.id)) : { data: [] };
      return { lot, lt, subs: (subs ?? []).map((s: any) => ({ ...s, target: (tg ?? []).find((t: any) => t.sublot_id === s.id) })) };
    },
  });
  const [open, setOpen] = useState(false);

  const lot = data?.lot;
  const subs = data?.subs ?? [];
  const lt = data?.lt;
  const usedPcs = subs.reduce((a: number, s: any) => a + (s.target?.declared_pieces ?? 0), 0);
  const usedNet = subs.reduce((a: number, s: any) => a + Number(s.target?.declared_net_weight ?? 0), 0);

  const issue = async (id: string, no: number) => {
    const { error } = await db.from("sublots").update({ status: "issued" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Sublot ${no} sent to staff`); refetch();
  };

  return (
    <AppShell title={lot ? `Lot ${lot.lot_no}` : "Lot"} back="/manager/lots">
      {lot && (
        <section className="mb-4 space-y-3 rounded-2xl border-2 bg-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="num text-2xl font-extrabold">{lot.lot_no}</span>
            <span className="rounded bg-muted px-2 py-0.5 font-bold">{lot.branches.branch_code} · {lot.branches.branch_name}</span>
            <span className="text-sm text-muted-foreground">Received {lot.received_date}</span>
          </div>
          {lt && (
            <div className="grid gap-2 sm:grid-cols-3">
              <Meter label="Gross weight" total={`${fmt3(lt.total_gross_weight)} g`} />
              <Meter label="Net weight in sublots" used={usedNet} total={Number(lt.total_net_weight)} fmt={(n) => `${fmt3(n)} g`} />
              <Meter label="Pieces in sublots" used={usedPcs} total={lt.total_pcs} fmt={String} />
            </div>
          )}
          {lot.notes && <p className="text-sm"><b>Notes:</b> {lot.notes}</p>}
        </section>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xl font-extrabold">Sublots</h2>
        {isMgr && !open && <Button className="h-12" onClick={() => setOpen(true)}><Plus className="mr-1 h-5 w-5" />Add sublot</Button>}
      </div>

      {isMgr && open && m && lot && (
        <SublotForm m={m} lot={lot} lotId={lotId} subs={subs} remaining={lt ? { pcs: lt.total_pcs - usedPcs, net: Number(lt.total_net_weight) - usedNet } : null}
          onClose={() => setOpen(false)} onSaved={() => { setOpen(false); refetch(); }} />
      )}

      <div className="space-y-2">
        {subs.length === 0 && !open && (
          <div className="rounded-2xl border-2 border-dashed p-8 text-center">
            <p className="mb-1 text-lg font-semibold">No sublots yet.</p>
            <p className="mb-3 text-sm text-muted-foreground">One sublot = one product type (e.g. all the rings in this packet).</p>
            {isMgr && <Button className="h-14 px-6 text-lg" onClick={() => setOpen(true)}><Plus className="mr-1 h-5 w-5" />Add the first sublot</Button>}
          </div>
        )}
        {subs.map((s: any) => (
          <div key={s.id} className="rounded-xl border-2 bg-card p-4">
            <Link to="/manager/sublot/$id" params={{ id: s.id }} className="flex flex-wrap items-center gap-x-3 gap-y-1 hover:text-primary">
              <span className="text-lg font-extrabold">#{s.sublot_no}</span>
              <span className="font-semibold">{s.product_types.base_code} · {s.product_types.name}</span>
              <StatusBadge status={s.status} />
              {s.target && s.target.removed_tags > 0 && <span className="rounded bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground">ITEMS REMOVED</span>}
              <ChevronRight className="ml-auto h-5 w-5" />
            </Link>
            <div className="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {s.target && <span className="font-semibold text-foreground">{s.target.declared_tags} tags · {s.target.declared_pieces} pcs · {fmt3(s.target.declared_net_weight)} g</span>}
              <span>{s.vendors ? `${s.vendors.code} · ${s.vendors.name}` : "No vendor"}</span>
              <span>{s.purities?.purity_label ?? "—"}</span>
              <span>Wastage {s.wastage_pct ?? "—"}%</span>
              <span>Making {s.making_value ?? "—"} {makingLabel(s.making_type).toLowerCase()}</span>
            </div>
            {isMgr && s.status === "draft" && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-warning/15 p-2">
                <span className="text-sm">Draft — staff can't see it yet.</span>
                <Button className="ml-auto h-11" onClick={() => issue(s.id, s.sublot_no)}>Send to staff</Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </AppShell>
  );
}

function Meter({ label, used, total, fmt }: { label: string; used?: number; total: number | string; fmt?: (n: number) => string }) {
  if (used == null || typeof total === "string") return (
    <div className="rounded-xl bg-secondary p-3"><div className="text-xs font-bold uppercase text-muted-foreground">{label}</div><div className="num text-xl font-bold">{total}</div></div>
  );
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const over = used > total + 0.0005;
  const left = total - used;
  return (
    <div className="rounded-xl bg-secondary p-3">
      <div className="text-xs font-bold uppercase text-muted-foreground">{label}</div>
      <div className="num text-xl font-bold">{fmt!(used)} <span className="text-sm font-semibold text-muted-foreground">of {fmt!(total)}</span></div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full", over ? "bg-destructive" : "bg-success")} style={{ width: `${pct}%` }} /></div>
      <div className={cn("num mt-1 text-xs font-semibold", over ? "text-destructive" : "text-muted-foreground")}>{over ? `Over by ${fmt!(-left)}` : Math.abs(left) < 0.0005 ? "All allocated ✓" : `${fmt!(left)} left`}</div>
    </div>
  );
}

function SublotForm({ m: m0, lot, lotId, subs, remaining, onClose, onSaved }: {
  m: any; lot: any; lotId: string; subs: any[]; remaining: { pcs: number; net: number } | null; onClose: () => void; onSaved: () => void;
}) {
  // Only this lot's branch's product types; pieces pre-fill only when a product has exactly one allowed pcs.
  const m = { ...m0, productTypes: m0.productTypes.filter((p: any) => p.branch_id === lot?.branch_id) };
  const fixedPcs = (p: any): number | null => (p?.allowed_pcs?.length === 1 ? p.allowed_pcs[0] : null);
  const last = subs[subs.length - 1];
  const [f, setF] = useState<any>({});
  const [piecesTouched, setPiecesTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const pt = m.productTypes.find((p: any) => p.id === f.product_type_id);
  const suggested = fixedPcs(pt) && Number(f.tags) > 0 ? String(Number(f.tags) * fixedPcs(pt)!) : "";
  const showSuggest = piecesTouched && suggested && suggested !== f.pieces;
  const purity = m.purities.find((p: any) => p.id === f.purity_id);

  // pieces pre-fill as tags × pcs/tag until the manager types their own value
  const set = (patch: any) => {
    const next = { ...f, ...patch };
    const p = m.productTypes.find((x: any) => x.id === next.product_type_id);
    const fp = fixedPcs(p);
    const sug = fp && Number(next.tags) > 0 ? String(Number(next.tags) * fp) : "";
    setF(piecesTouched || !fp ? next : { ...next, pieces: sug });
  };
  const copyLast = () => {
    if (!last) return;
    setF({ ...f, vendor_id: last.vendor_id, purity_id: last.purity_id, wastage_pct: last.wastage_pct ?? "", making_value: last.making_value ?? "", making_type: last.making_type });
    toast.success(`Copied vendor, purity and charges from sublot #${last.sublot_no}`);
  };

  const sections = [
    { k: "Product", ok: !!f.product_type_id },
    { k: "Quantity", ok: Number(f.tags) > 0 && Number(f.pieces) > 0 && Number(f.net) > 0 },
    { k: "Vendor & purity", ok: !!f.vendor_id && !!f.purity_id },
    { k: "Charges", ok: f.wastage_pct !== undefined && f.wastage_pct !== "" && f.making_value !== undefined && f.making_value !== "" && !!f.making_type },
  ];
  const ready = sections.every((s) => s.ok);

  const save = async () => {
    if (!ready) return toast.error("Finish the sections that aren't ticked yet");
    if (showSuggest && !confirm(`Pieces is ${f.pieces}, but ${f.tags} tags × ${fixedPcs(pt)} pcs = ${suggested}. Keep ${f.pieces}?`)) return;
    if (remaining && (Number(f.pieces) > remaining.pcs || Number(f.net) > remaining.net + 0.0005) &&
      !confirm("This sublot goes over what's left of the lot's pieces or net weight. Save anyway?")) return;
    setBusy(true);
    try {
      const next = subs.reduce((a: number, s: any) => Math.max(a, s.sublot_no), 0) + 1;
      const { data: s, error } = await db.from("sublots").insert({
        lot_id: lotId, sublot_no: next, product_type_id: f.product_type_id,
        vendor_id: f.vendor_id, purity_id: f.purity_id, melting: purity?.melting,
        wastage_pct: Number(f.wastage_pct), making_value: Number(f.making_value), making_type: f.making_type,
      }).select().single();
      if (error) throw error;
      const { error: e2 } = await db.from("sublot_targets").insert({ sublot_id: s.id, declared_tags: Number(f.tags), declared_pieces: Number(f.pieces), declared_net_weight: Number(f.net) });
      if (e2) throw e2;
      toast.success(`Sublot ${next} saved as a draft`);
      onSaved();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const Section = ({ i, title, hint, children }: { i: number; title: string; hint?: string; children: React.ReactNode }) => (
    <section className="space-y-3 rounded-xl border bg-background p-4">
      <div className="flex items-center gap-2">
        <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold", sections[i].ok ? "bg-success text-success-foreground" : "bg-muted")}>
          {sections[i].ok ? <Check className="h-4 w-4" /> : i + 1}
        </span>
        <h3 className="text-lg font-bold">{title}</h3>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );

  return (
    <div className="mb-4 space-y-3 rounded-2xl border-2 border-primary bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-2xl font-extrabold">New sublot</h2>
          <p className="text-sm text-muted-foreground">Four short sections. Each gets a green tick when it's done.</p>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-2 hover:bg-accent"><X className="h-6 w-6" /></button>
      </div>

      {Section({ i: 0, title: "What product?", hint: "One product type per sublot", children: (
        m.productTypes.length === 0 ? <p className="text-destructive">Branch {lot?.branches?.branch_code} · {lot?.branches?.branch_name} has no product types yet. Add them in Master data first.</p> :
        <Choice value={f.product_type_id} onChange={(v) => set({ product_type_id: v })}
          options={m.productTypes.map((p: any) => ({ v: p.id, label: `${p.base_code} · ${p.name}`, sub: `${(p.allowed_pcs ?? [p.default_pcs]).join(" / ")} piece(s) per tag` }))} />
      ) })}

      {Section({ i: 1, title: "How many, how heavy?", children: (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Tags (compartments)" hint="How many price tags / tray spots">
              <Input className="num h-14 text-xl" inputMode="numeric" value={f.tags ?? ""} onChange={(e) => set({ tags: e.target.value.replace(/\D/g, "") })} placeholder="0" />
            </Field>
            <Field label="Pieces (HUIDs)" hint={!pt ? "Pick a product first" : fixedPcs(pt) ? `Filled in as tags × ${fixedPcs(pt)} — change it if needed` : `Pcs per tag varies (${pt.allowed_pcs.join(", ")}) — type the total from the packet`}>
              <Input className="num h-14 text-xl" inputMode="numeric" value={f.pieces ?? ""} onChange={(e) => { setPiecesTouched(true); setF({ ...f, pieces: e.target.value.replace(/\D/g, "") }); }} placeholder="0" />
              {showSuggest && <button type="button" className="text-left text-xs font-semibold underline" onClick={() => { setF({ ...f, pieces: suggested }); setPiecesTouched(false); }}>Use {f.tags} × {fixedPcs(pt)} = {suggested}?</button>}PLACEHOLDERcs} = {suggested}?</button>}
            </Field>
            <Field label="Declared net weight (g)" hint="Never shown to staff">
              <Input className="num h-14 text-xl" inputMode="decimal" value={f.net ?? ""} onChange={(e) => setF({ ...f, net: e.target.value })} placeholder="0.000" />
            </Field>
          </div>
          {remaining && <p className="num text-xs text-muted-foreground">Left in this lot: {remaining.pcs} pieces · {fmt3(remaining.net)} g net</p>}
        </>
      ) })}

      {Section({ i: 2, title: "Vendor & purity", children: (
        <>
          {last && <Button type="button" variant="outline" className="h-11" onClick={copyLast}><Copy className="mr-1 h-4 w-4" />Same as sublot #{last.sublot_no}</Button>}
          <Field label="Vendor">
            {m.vendors.length === 0 ? <p className="text-sm text-destructive">Add vendors in Master data first.</p> :
              m.vendors.length > 8
                ? <select className="h-14 w-full rounded-md border border-input bg-background px-3 text-lg" value={f.vendor_id ?? ""} onChange={(e) => setF({ ...f, vendor_id: e.target.value })}>
                    <option value="">Choose vendor…</option>{m.vendors.map((v: any) => <option key={v.id} value={v.id}>{v.code} · {v.name}</option>)}
                  </select>
                : <Choice value={f.vendor_id} onChange={(v) => setF({ ...f, vendor_id: v })} options={m.vendors.map((v: any) => ({ v: v.id, label: v.code, sub: v.name }))} />}
          </Field>
          <Field label="Purity" hint="Melting is set automatically">
            <Choice value={f.purity_id} onChange={(v) => setF({ ...f, purity_id: v })}
              options={m.purities.map((p: any) => ({ v: p.id, label: p.purity_label, sub: `${Number(p.melting).toFixed(2)} · ${p.metal}` }))} />
          </Field>
        </>
      ) })}

      {Section({ i: 3, title: "Wastage & making charges", children: (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Wastage %"><Input className="num h-14 text-xl" inputMode="decimal" value={f.wastage_pct ?? ""} onChange={(e) => setF({ ...f, wastage_pct: e.target.value })} placeholder="0" /></Field>
          <Field label="Making value"><Input className="num h-14 text-xl" inputMode="decimal" value={f.making_value ?? ""} onChange={(e) => setF({ ...f, making_value: e.target.value })} placeholder="0" /></Field>
          <div className="sm:col-span-2">
            <Field label="Making is charged…"><Choice value={f.making_type} onChange={(v) => setF({ ...f, making_type: v })} options={MAKING.map((x) => ({ ...x }))} /></Field>
          </div>
        </div>
      ) })}

      <div className="sticky bottom-2 flex gap-2 rounded-xl bg-card/95 p-1 backdrop-blur">
        <Button variant="outline" className="h-14 flex-1" onClick={onClose}>Cancel</Button>
        <Button className="h-14 flex-[2] text-lg" disabled={busy || !ready} onClick={() => void save()}>
          {ready ? "Save sublot" : `${sections.filter((s) => s.ok).length} of 4 sections done`}
        </Button>
      </div>
    </div>
  );
}
