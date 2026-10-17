/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Move } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Legend } from "../TrayGrid";
import { enqueue } from "@/lib/offline";
import { rpc, errMsg, fmt3 } from "@/lib/db";
import { pad, Grid, type StepProps } from "./shared";

/* ---------------- LOAD ---------------- */
export function LoadStep({ snap, run, refresh, locked, go }: StepProps) {
  const [edit, setEdit] = useState(false);
  const [pending, setPending] = useState<{ from: number; to: number } | null>(null);
  const byComp = new Map(snap.items.map((i) => [i.compartment_no, i]));
  const canLoad = !locked && ["empty", "loaded"].includes(snap.session.status);

  const tap = (n: number) => {
    if (!canLoad) return;
    const item = byComp.get(n);
    if (item?.ser_no != null) return toast.error("This tag already has a tag number — a manager must unseal first");
    if (item?.gross_weight != null) {
      // weighed: clearing needs a reason (logged)
      const reason = prompt(`Clear ${snap.tray.tray_code}-${pad(n)} (gross ${fmt3(Number(item.gross_weight))} g)? Its HUIDs go back to the list.\n\nReason (required):`);
      if (!reason?.trim()) return;
      void (async () => {
        try { await rpc("correct_item", { p_item: item.id, p_reason: reason.trim() }); toast.success(`Compartment ${pad(n)} cleared`); await refresh(); }
        catch (err) { toast.error(errMsg(err)); }
      })();
      return;
    }
    // loaded but not weighed: one tap clears it, no dialog
    void run("set_compartment", { p_session: snap.session.id, p_compartment: n, p_occupied: !item, p_item_id: item?.id ?? crypto.randomUUID() }, `Compartment ${n}`);
  };
  const doMove = () => {
    if (!pending) return;
    const it = byComp.get(pending.from);
    if (it) void run("move_item", { p_item: it.id, p_to: pending.to }, `Move ${pending.from}→${pending.to}`, it.id);
    setPending(null);
  };
  const target = pending ? byComp.get(pending.to) : null;
  const anyWeighed = snap.items.some((i) => i.gross_weight != null);
  const fillAll = () => {
    if (!canLoad || anyWeighed) return;
    const total = snap.tray.rows * snap.tray.columns;
    const ops = [];
    for (let n = 1; n <= total; n++) if (!byComp.has(n))
      ops.push({ fn: "set_compartment", args: { p_session: snap.session.id, p_compartment: n, p_occupied: true, p_item_id: crypto.randomUUID() }, label: `Compartment ${n}`, sublotId: snap.sublot.id });
    void enqueue(ops); // one write — never loses compartments
    toast.success("Every compartment marked — tap the empty ones to clear them");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="num rounded-lg bg-card px-3 py-2 text-lg font-bold">{snap.loadedCount} in this tray</span>
        <div className="ml-auto flex gap-2">
          {canLoad && <Button variant="outline" className="h-11" disabled={anyWeighed || edit} onClick={fillAll}>Fill whole tray</Button>}
          {!locked && <Button variant={edit ? "default" : "outline"} className="h-11" onClick={() => setEdit(!edit)}><Move className="mr-1 h-4 w-4" />{edit ? "Done editing" : "Edit"}</Button>}
        </div>
      </div>
      <p className="rounded-lg bg-muted p-3 text-base font-semibold">
        {edit ? "Drag a product to another compartment (or tap it, then tap the new spot)." : canLoad ? "Tap every compartment that has a product in it. Tap again to clear it." : "Loading is finished for this tray. Use Edit to move a product."}
      </p>
      <Grid snap={snap} stateOf={(n) => (byComp.has(n) ? "loaded" : "empty")} onTap={tap} editMode={edit} onMove={(from, to) => setPending({ from, to })} />
      <Legend only={["empty", "loaded"]} />
      {!locked && (
        <Link to="/station" search={{ sublot: snap.sublot.id }} className="block rounded-xl border-2 border-dashed p-4 text-center text-lg font-bold">Load another tray →</Link>
      )}
      <Button className="h-16 w-full text-xl" disabled={!snap.items.length} onClick={() => go("weigh")}>Next: Weighing →</Button>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move product?</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              Move the product from compartment <b>{pending && pad(pending.from)}</b> to <b>{pending && pad(pending.to)}</b>.
              {target && <> The product in {pending && pad(pending.to)} will move to {pending && pad(pending.from)}.</>}
              {" "}Make sure you move it in the real tray too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-12">Cancel</AlertDialogCancel>
            <AlertDialogAction className="h-12" onClick={doMove}>Yes, move it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
