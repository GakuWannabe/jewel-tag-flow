import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { db, rpc, errMsg, fmt3 } from "@/lib/db";
import { HOLD_LABEL, type HoldFlag } from "@/lib/types";

export function ItemsPanel({ sublotId, canEdit, onChange }: { sublotId: string; canEdit: boolean; onChange: () => void }) {
  const { data: items = [], refetch } = useQuery({
    queryKey: ["items-admin", sublotId],
    queryFn: async () => (await db.from("items").select("*, tray_sessions(opened_at, trays(tray_code)), item_huids(position, removed_at, huid_pool(huid))").eq("sublot_id", sublotId).is("deleted_at", null)).data ?? [],
  });
  const sorted = [...items].sort((a: any, b: any) =>
    (a.sequence ?? 1e9) - (b.sequence ?? 1e9) || a.tray_sessions.trays.tray_code.localeCompare(b.tray_sessions.trays.tray_code) || a.compartment_no - b.compartment_no);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); refetch(); onChange(); } catch (e) { toast.error(errMsg(e)); } };

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="num w-full text-sm">
        <thead className="bg-muted text-left font-sans">
          <tr><th className="p-2">Seq</th><th>Pos</th><th>Gross</th><th>Less</th><th>Net</th><th>Pcs</th><th>HUIDs</th><th>Photo</th><th>Tag</th><th>Hold</th><th /></tr>
        </thead>
        <tbody>
          {sorted.map((i: any) => (
            <tr key={i.id} className={`border-t ${i.hold_flag ? "bg-destructive/10" : ""}`}>
              <td className="p-2">{i.sequence ?? "—"}</td>
              <td>{i.tray_sessions.trays.tray_code}-{String(i.compartment_no).padStart(2, "0")}</td>
              <td>{fmt3(i.gross_weight)}</td><td>{fmt3(i.less_weight)}</td><td className="font-bold">{fmt3(i.net_weight)}</td><td>{i.pcs}</td>
              <td>{i.item_huids.filter((h: any) => !h.removed_at).map((h: any) => h.huid_pool.huid).join(", ")}</td>
              <td>{i.photo_url ? "✓" : "—"}</td>
              <td>{i.ser_no ? `${i.compcode}${i.ic}${i.ser_no}` : ""}</td>
              <td className="font-sans">{i.hold_flag ? <span title={i.hold_note ?? ""} className="font-bold text-destructive">{HOLD_LABEL[i.hold_flag as HoldFlag]}{i.hold_note ? `: ${i.hold_note}` : ""}</span> : ""}</td>
              <td className="whitespace-nowrap p-1 font-sans">
                {canEdit && i.hold_flag && <Button size="sm" onClick={() => act(() => rpc("clear_hold", { p_item: i.id, p_note: prompt("Note (optional)") ?? "" }))}>Clear hold</Button>}
                {canEdit && !i.ser_no && <Button size="sm" variant="destructive" className="ml-1" onClick={() => {
                  const r = prompt(`Remove ${i.tray_sessions.trays.tray_code}-${String(i.compartment_no).padStart(2, "0")} (${fmt3(i.net_weight)} g, ${i.pcs} pcs)?\nThis is logged permanently. Its HUIDs return to the pool; declared totals stay unchanged and the removal is recorded separately.\n\nReason (required):`);
                  if (r) void act(() => rpc("remove_item", { p_item: i.id, p_reason: r }));
                }}>Remove</Button>}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && <tr><td colSpan={11} className="p-4 text-center font-sans text-muted-foreground">No items yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
