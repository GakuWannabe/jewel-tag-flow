import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { db, rpc, errMsg } from "@/lib/db";
import { parseTagSlots, type SlotParse } from "@/lib/imports";

export function TagSlotPanel({ sublot, branch, baseCode, declaredPcs, canEdit, onDone }: {
  sublot: any; branch: string; baseCode: string; declaredPcs?: number; canEdit: boolean; onDone: () => void;
}) {
  const [p, setP] = useState<SlotParse | null>(null);
  const { data: current = [], refetch } = useQuery({
    queryKey: ["slots", sublot.id],
    queryFn: async () => (await db.from("tag_slots").select("ser_no,assigned_item_id,compcode,ic").eq("sublot_id", sublot.id).is("superseded_at", null).order("ser_no")).data ?? [],
  });

  const commit = async () => {
    if (!p) return;
    try {
      const n = await rpc<number>("import_tag_slots", { p_sublot: sublot.id, p_headers: p.headers, p_rows: p.rows });
      toast.success(`${n} tag slots imported`); setP(null); refetch(); onDone();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const sers = current.map((c: any) => c.ser_no);
  return (
    <div className="space-y-3">
      <div className="flex gap-2 rounded-lg border-2 border-warning bg-warning/20 p-3 font-semibold">
        <AlertTriangle className="h-6 w-6 shrink-0" />
        Re-export this list from the ERP immediately before starting the batch. Numbers consumed by other terminals since export will cause a mismatch.
      </div>
      <p className="text-sm">Expected: type <b>{branch}</b>, IC <b className="num">{branch}{baseCode}</b></p>
      {current.length > 0 && (
        <div className="rounded-lg border bg-card p-3 text-sm">
          <b>Current list:</b> {current.length} slots · <span className="num">{Math.min(...sers)}–{Math.max(...sers)}</span>
          {" · "}{current.filter((c: any) => c.assigned_item_id).length} assigned · imported {sublot.slots_imported_at ? new Date(sublot.slots_imported_at).toLocaleString() : ""}
        </div>
      )}
      {canEdit && (
        <label className="block cursor-pointer rounded-lg border-2 border-dashed border-input p-6 text-center font-semibold">
          Choose ERP tag slot sheet (.xlsx / .xls / .csv)
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            try { setP(await parseTagSlots(f, { branch, baseCode })); } catch (err) { toast.error(errMsg(err)); }
            e.target.value = "";
          }} />
        </label>
      )}
      {p && (
        <div className="space-y-2 rounded-lg border bg-card p-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat k="Available slots" v={p.count} />
            <Stat k="Min ser_no" v={p.min} />
            <Stat k="Max ser_no" v={p.max} />
          </div>
          <p className="text-sm"><b>Gaps ({p.gaps.length}):</b> <span className="num">{p.gaps.length ? p.gaps.join(", ") : "none"}</span></p>
          <p className="text-xs text-muted-foreground">{p.headers.length} columns in file; only COMPCODE, type, IC, ser_no, cmd are read. The full row is kept for the export.</p>
          {declaredPcs != null && p.count < declaredPcs && (
            <p className="rounded bg-warning p-2 font-semibold text-warning-foreground">Warning: {p.count} slots available but {declaredPcs} pcs declared.</p>
          )}
          {p.errors.length > 0 ? (
            <div className="rounded bg-destructive p-3 text-destructive-foreground"><b>File rejected:</b><ul className="list-disc pl-5">{p.errors.slice(0, 10).map((e) => <li key={e}>{e}</li>)}</ul></div>
          ) : (
            <Button className="h-12 w-full" onClick={commit}>Import {p.count} slots{current.length ? " (replaces unassigned current list)" : ""}</Button>
          )}
        </div>
      )}
    </div>
  );
}

const Stat = ({ k, v }: { k: string; v: unknown }) => <div className="rounded bg-muted p-2"><div className="text-xs text-muted-foreground">{k}</div><div className="num text-2xl font-bold">{String(v)}</div></div>;
