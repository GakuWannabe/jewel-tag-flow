import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { db, rpc, errMsg } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

const sel = "h-12 w-full rounded-md border border-input bg-background px-3";

function Lots() {
  const { has } = useAuth();
  const { data: m } = useMasters();
  const { data: lots = [], refetch } = useQuery({
    queryKey: ["lots"],
    queryFn: async () => (await db.from("lots").select("*, branches(branch_code,branch_name), vendors(code,name), purities(purity_label), sublots(id,status)").is("deleted_at", null).order("created_at", { ascending: false })).data ?? [],
  });
  const [open, setOpen] = useState(false);
  const [del, setDel] = useState<any>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<any>({ making_type: "per_gram", received_date: new Date().toISOString().slice(0, 10), wastage_pct: "0", making_value: "0" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pur = m?.purities.find((p: any) => p.id === f.purity_id);
    const { error } = await db.from("lots").insert({
      lot_no: f.lot_no.trim().toUpperCase(), branch_id: f.branch_id, vendor_id: f.vendor_id, purity_id: f.purity_id, melting: pur?.melting,
      wastage_pct: Number(f.wastage_pct), making_value: Number(f.making_value), making_type: f.making_type, received_date: f.received_date, notes: f.notes || null,
    });
    if (error) return toast.error(error.message.includes("duplicate") ? "Lot number already exists" : error.message);
    toast.success("Lot created"); setOpen(false); refetch();
  };

  return (
    <AppShell title="Lots" back="/app" actions={has("manager") ? <Button variant="secondary" onClick={() => setOpen(!open)}>{open ? "Close" : "+ New lot"}</Button> : null}>
      {open && m && (
        <form onSubmit={submit} className="mb-4 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><Label>Lot number (as on packet)</Label><Input className="num h-12 uppercase" value={f.lot_no ?? ""} onChange={(e) => setF({ ...f, lot_no: e.target.value })} required /></div>
          <div><Label>Branch</Label><select className={sel} value={f.branch_id ?? ""} onChange={(e) => setF({ ...f, branch_id: e.target.value })} required><option value="">—</option>{m.branches.map((b: any) => <option key={b.id} value={b.id}>{b.branch_code} · {b.branch_name}</option>)}</select></div>
          <div><Label>Vendor</Label><select className={sel} value={f.vendor_id ?? ""} onChange={(e) => setF({ ...f, vendor_id: e.target.value })} required><option value="">—</option>{m.vendors.map((v: any) => <option key={v.id} value={v.id}>{v.code} · {v.name}</option>)}</select>{m.vendors.length === 0 && <p className="text-xs text-destructive">Add vendors in Master data first.</p>}</div>
          <div><Label>Purity</Label><select className={sel} value={f.purity_id ?? ""} onChange={(e) => setF({ ...f, purity_id: e.target.value })} required><option value="">—</option>{m.purities.map((p: any) => <option key={p.id} value={p.id}>{p.purity_label} · {Number(p.melting).toFixed(2)} · {p.metal}</option>)}</select></div>
          <div><Label>Wastage %</Label><Input className="num h-12" inputMode="decimal" value={f.wastage_pct} onChange={(e) => setF({ ...f, wastage_pct: e.target.value })} /></div>
          <div><Label>Making value</Label><Input className="num h-12" inputMode="decimal" value={f.making_value} onChange={(e) => setF({ ...f, making_value: e.target.value })} /></div>
          <div><Label>Making type</Label><select className={sel} value={f.making_type} onChange={(e) => setF({ ...f, making_type: e.target.value })}><option value="percentage">Percentage</option><option value="per_gram">Per gram</option><option value="per_piece">Per piece</option></select></div>
          <div><Label>Received</Label><Input type="date" className="h-12" value={f.received_date} onChange={(e) => setF({ ...f, received_date: e.target.value })} /></div>
          <div className="sm:col-span-2 lg:col-span-3"><Label>Notes</Label><Textarea value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
          <Button type="submit" className="h-12 self-end">Create lot</Button>
        </form>
      )}
      {lots.length > 0 && <p className="mb-2 text-sm text-muted-foreground">Tap a lot to add sublots and issue them to staff.</p>}
      <div className="space-y-2">
        {lots.map((l: any) => (
          <div key={l.id} className="flex items-stretch gap-2">
            <Link to="/manager/lots/$lotId" params={{ lotId: l.id }} className="flex flex-1 items-center gap-4 rounded-lg border bg-card p-4 hover:border-primary">
              <div className="num text-xl font-bold">{l.lot_no}</div>
              <div className="flex-1 text-sm text-muted-foreground">{l.branches?.branch_name} · {l.vendors?.name} · {l.purities?.purity_label} · {l.received_date}</div>
              <div className="text-sm font-semibold">{l.sublots?.length ?? 0} sublot(s) · Open →</div>
            </Link>
            {has("manager") && (
              <button type="button" aria-label={`Delete lot ${l.lot_no}`} onClick={() => { setDel(l); setTyped(""); }}
                className="flex w-14 items-center justify-center rounded-lg border bg-card text-destructive hover:bg-destructive hover:text-destructive-foreground">
                <Trash2 className="h-5 w-5" />
              </button>
            )}
          </div>
        ))}
        {lots.length === 0 && <p className="text-muted-foreground">No lots yet.</p>}
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
                const photos = await rpc<string[]>("delete_lot", { p_lot: del.id, p_confirm: typed });
                if (photos?.length) await db.storage.from("photos").remove(photos).catch(() => null);
                toast.success(`Lot ${del.lot_no} deleted`); setDel(null); refetch();
              } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
            }}>Delete forever</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
