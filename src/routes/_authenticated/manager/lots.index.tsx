/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, X, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { db, errMsg, fmt3 } from "@/lib/db";
import { useServerFn } from "@tanstack/react-start";
import { deleteLot } from "@/lib/photos.functions";
import { useAuth } from "@/lib/auth";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/manager/lots/")({
  head: () => ({ meta: [{ title: "Lots — Tagging Line" }, { name: "description", content: "Create lots and sublots." }] }),
  component: Lots,
});

export function useMasters() {
  return useQuery({
    queryKey: ["masters-all"],
    queryFn: async () => {
      const [b, v, p, pt, t] = await Promise.all([
        db.from("branches").select("*").eq("active", true).order("branch_code"),
        db.from("vendors").select("*").eq("active", true).order("code"),
        db.from("purities").select("*").eq("active", true).order("purity_label"),
        db.from("product_types").select("*").eq("active", true).order("base_code"),
        db.from("trays").select("*").eq("active", true).order("tray_code"),
      ]);
      return { branches: b.data ?? [], vendors: v.data ?? [], purities: p.data ?? [], productTypes: pt.data ?? [], trays: t.data ?? [] };
    },
  });
}

/** Big labelled field with a hint underneath — used across the lot and sublot forms. */
export function Field({ n, label, hint, children }: { n?: number; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-2 text-base font-bold">
        {n != null && <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">{n}</span>}
        {label}
      </span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Row of large tap buttons instead of a dropdown. */
export function Choice<T extends string>({ value, options, onChange }: { value: T | undefined; options: { v: T; label: string; sub?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)}
          className={cn("min-h-12 rounded-xl border-2 px-4 py-2 text-left transition-colors",
            value === o.v ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary")}>
          <div className="font-bold">{o.label}</div>
          {o.sub && <div className={cn("text-xs", value === o.v ? "opacity-80" : "text-muted-foreground")}>{o.sub}</div>}
        </button>
      ))}
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function Lots() {
  const { has } = useAuth();
  const isMgr = has("manager");
  const nav = useNavigate();
  const { data: m } = useMasters();
  const { data, refetch } = useQuery({
    queryKey: ["lots"],
    queryFn: async () => {
      const [l, t] = await Promise.all([
        db.from("lots").select("*, branches(branch_code,branch_name), sublots(id,status)").is("deleted_at", null).order("created_at", { ascending: false }),
        db.from("lot_targets").select("*"),
      ]);
      return { lots: l.data ?? [], targets: t.data ?? [] };
    },
  });
  const lots = data?.lots ?? [];
  const [open, setOpen] = useState(false);
  const [del, setDel] = useState<any>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const removeLot = useServerFn(deleteLot);
  const blank = { received_date: today() };
  const [f, setF] = useState<any>(blank);

  const gross = Number(f.gross), net = Number(f.net), pcs = Number(f.pcs);
  const netTooHigh = f.gross && f.net && net > gross;
  const ready = f.lot_no?.trim() && f.branch_id && gross > 0 && net > 0 && !netTooHigh && Number.isInteger(pcs) && pcs > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      const { data: lot, error } = await db.from("lots").insert({
        lot_no: f.lot_no.trim().toUpperCase(), branch_id: f.branch_id, received_date: f.received_date, notes: f.notes || null,
      }).select("id").single();
      if (error) throw new Error(error.message.includes("duplicate") ? "That lot number already exists for this branch" : error.message);
      const { error: e2 } = await db.from("lot_targets").insert({ lot_id: lot.id, total_gross_weight: gross, total_net_weight: net, total_pcs: pcs });
      if (e2) throw e2;
      toast.success("Lot created — now add its sublots");
      setF(blank); setOpen(false);
      void nav({ to: "/manager/lots/$lotId", params: { lotId: lot.id } });
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };

  return (
    <AppShell title="Lots" back="/app" actions={isMgr && !open ? <Button variant="secondary" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />New lot</Button> : null}>
      {open && m && (
        <form onSubmit={submit} className="mb-5 space-y-5 rounded-2xl border-2 border-primary bg-card p-4 sm:p-6">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-2xl font-extrabold">New lot</h2>
              <p className="text-sm text-muted-foreground">Just the packet basics. Vendor, purity and making charges go on each sublot next.</p>
            </div>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-accent"><X className="h-6 w-6" /></button>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field n={1} label="Lot number" hint="Exactly as written on the packet">
              <Input autoFocus className="num h-14 text-xl uppercase" value={f.lot_no ?? ""} onChange={(e) => setF({ ...f, lot_no: e.target.value })} placeholder="L2609047" />
            </Field>
            <Field n={2} label="Received on">
              <Input type="date" className="h-14 text-lg" value={f.received_date} onChange={(e) => setF({ ...f, received_date: e.target.value })} />
            </Field>
          </div>

          <Field n={3} label="Branch" hint="Which showroom this stock is for">
            <Choice value={f.branch_id} onChange={(v) => setF({ ...f, branch_id: v })}
              options={m.branches.map((b: any) => ({ v: b.id, label: b.branch_code, sub: b.branch_name }))} />
          </Field>

          <div className="rounded-xl bg-secondary p-4">
            <div className="mb-3 flex items-center gap-2 text-base font-bold"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">4</span>Packet totals</div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Total gross weight (g)"><Input className="num h-14 text-xl" inputMode="decimal" value={f.gross ?? ""} onChange={(e) => setF({ ...f, gross: e.target.value })} placeholder="0.000" /></Field>
              <Field label="Total net weight (g)"><Input className={cn("num h-14 text-xl", netTooHigh && "border-destructive")} inputMode="decimal" value={f.net ?? ""} onChange={(e) => setF({ ...f, net: e.target.value })} placeholder="0.000" /></Field>
              <Field label="Total pieces"><Input className="num h-14 text-xl" inputMode="numeric" value={f.pcs ?? ""} onChange={(e) => setF({ ...f, pcs: e.target.value.replace(/\D/g, "") })} placeholder="0" /></Field>
            </div>
            {netTooHigh && <p className="mt-2 text-sm font-semibold text-destructive">Net weight can't be more than gross weight.</p>}
            <p className="mt-2 text-xs text-muted-foreground">Only managers and auditors can ever see these totals.</p>
          </div>

          <Field label="Notes (optional)"><Textarea value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>

          <Button type="submit" className="h-14 w-full text-lg" disabled={!ready || busy}>{ready ? "Create lot & add sublots →" : "Fill in steps 1–4 to continue"}</Button>
        </form>
      )}

      {lots.length > 0 && !open && <p className="mb-2 text-sm text-muted-foreground">Tap a lot to add sublots and send them to staff.</p>}
      <div className="space-y-2">
        {lots.map((l: any) => {
          const t = data?.targets.find((x: any) => x.lot_id === l.id);
          return (
            <div key={l.id} className="flex items-stretch gap-2">
              <Link to="/manager/lots/$lotId" params={{ lotId: l.id }} className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border-2 bg-card p-4 transition-colors hover:border-primary active:bg-accent">
                <div className="num text-xl font-bold">{l.lot_no}</div>
                <span className="rounded bg-muted px-2 py-0.5 text-sm font-bold">{l.branches?.branch_code}</span>
                <div className="text-sm text-muted-foreground">{l.received_date}</div>
                {t && <div className="num text-sm">{t.total_pcs} pcs · {fmt3(t.total_net_weight)} g net</div>}
                <div className="ml-auto flex items-center gap-1 text-sm font-semibold">{l.sublots?.length ?? 0} sublot{l.sublots?.length === 1 ? "" : "s"}<ChevronRight className="h-5 w-5" /></div>
              </Link>
              {isMgr && (
                <button type="button" aria-label={`Delete lot ${l.lot_no}`} onClick={() => { setDel(l); setTyped(""); }}
                  className="flex w-14 items-center justify-center rounded-xl border-2 bg-card text-destructive hover:bg-destructive hover:text-destructive-foreground">
                  <Trash2 className="h-5 w-5" />
                </button>
              )}
            </div>
          );
        })}
        {lots.length === 0 && !open && (
          <div className="rounded-2xl border-2 border-dashed p-8 text-center">
            <p className="mb-3 text-lg font-semibold">No lots yet.</p>
            {isMgr && <Button className="h-14 px-6 text-lg" onClick={() => setOpen(true)}><Plus className="mr-1 h-5 w-5" />Create your first lot</Button>}
          </div>
        )}
      </div>

      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete lot {del?.lot_no}?</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              This erases the lot, all its sublots, weights, HUIDs, tag numbers and photos for good. It cannot be undone. Its trays become free.
              <br /><br />Type <b>DELETE</b> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input autoFocus className="h-12 text-lg" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" />
          <AlertDialogFooter>
            <AlertDialogCancel className="h-12">Cancel</AlertDialogCancel>
            <Button variant="destructive" className="h-12" disabled={typed !== "DELETE" || busy} onClick={async () => {
              setBusy(true);
              try {
                await removeLot({ data: { lotId: del.id, confirm: typed } });
                toast.success(`Lot ${del.lot_no} deleted`); setDel(null); refetch();
              } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
            }}>Delete forever</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
