import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { db, rpc, errMsg, fmt3 } from "@/lib/db";
import { parseHuids, type HuidRow } from "@/lib/imports";

export function HuidPanel({ sublot, expectedPieces, canEdit, onDone }: { sublot: any; expectedPieces?: number; canEdit: boolean; onDone: () => void }) {
  const [rows, setRows] = useState<HuidRow[] | null>(null);
  const [dupes, setDupes] = useState<any[]>([]);
  const { data: pool = [], refetch } = useQuery({
    queryKey: ["pool-admin", sublot.id],
    queryFn: async () => (await db.from("huid_pool").select("*").eq("sublot_id", sublot.id).is("deleted_at", null).order("huid")).data ?? [],
  });

  const load = async (f: File) => {
    try {
      const r = await parseHuids(f);
      setRows(r.rows);
      const found = await rpc<any[]>("check_huids", { p_huids: r.rows.map((x) => x.huid) });
      setDupes(found ?? []);
    } catch (e) { toast.error(errMsg(e)); }
  };

  const bad = rows?.filter((r) => r.error) ?? [];
  const total = rows?.reduce((a, r) => a + (r.weight ?? 0), 0) ?? 0;
  const poolTotal = pool.reduce((a: number, r: any) => a + Number(r.piece_weight ?? 0), 0);
  const allCount = pool.length + (rows?.length ?? 0);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card p-3 text-sm">
        <b>Pool:</b> {pool.length} pieces · <span className="num">{fmt3(poolTotal)} g</span> · {pool.filter((p: any) => !p.assigned_item_id).length} unassigned
        {expectedPieces != null && <> · expected <b>{expectedPieces}</b> (declared pieces){pool.length !== expectedPieces && pool.length > 0 && <span className="ml-2 rounded bg-warning px-1 font-bold text-warning-foreground">MISMATCH</span>}</>}
      </div>
      {canEdit && (
        <label className="block cursor-pointer rounded-lg border-2 border-dashed border-input p-6 text-center font-semibold">
          Choose hallmarking list (.xlsx / .csv — columns HUID, weight)
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} />
        </label>
      )}
      {rows && (
        <div className="space-y-2 rounded-lg border bg-card p-4">
          <p className="num text-lg font-bold">{rows.length} pieces · {fmt3(total)} g</p>
          {expectedPieces != null && allCount !== expectedPieces && (
            <p className="rounded bg-warning p-2 font-semibold text-warning-foreground">Piece count after import would be {allCount}; expected {expectedPieces}.</p>
          )}
          {dupes.length > 0 && (
            <div className="rounded bg-destructive p-3 text-destructive-foreground">
              <b>Blocked — HUIDs already in the database:</b>
              <ul className="num list-disc pl-5">{dupes.map((d) => <li key={d.huid}>{d.huid} → lot {d.lot_no} sublot {d.sublot_no}{d.tray_code ? `, tray ${d.tray_code}-${d.compartment_no}` : " (in pool)"}</li>)}</ul>
            </div>
          )}
          {bad.length > 0 && <div className="rounded bg-destructive p-3 text-destructive-foreground"><b>Invalid rows:</b> {bad.map((b) => `${b.huid || "(blank)"} (${b.error})`).join(", ")}</div>}
          <div className="max-h-64 overflow-auto">
            <table className="num w-full text-sm">
              <tbody>{rows.map((r) => (
                <tr key={r.huid + r.weight} className={r.error ? "bg-destructive/20" : r.confusable ? "bg-warning/30" : ""}>
                  <td className="px-2">{r.huid}</td><td className="px-2">{fmt3(r.weight)}</td>
                  <td className="px-2 text-xs">{r.confusable && !r.error ? "check 0/O 1/I 5/S 8/B 2/Z" : r.error}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Button className="h-12 w-full" disabled={bad.length > 0 || dupes.length > 0} onClick={async () => {
            try {
              const n = await rpc<number>("import_huids", { p_sublot: sublot.id, p_rows: rows.map((r) => ({ huid: r.huid, weight: r.weight })) });
              toast.success(`${n} HUIDs added`); setRows(null); refetch(); onDone();
            } catch (e) { toast.error(errMsg(e)); }
          }}>Add {rows.length} HUIDs to pool</Button>
        </div>
      )}
    </div>
  );
}
