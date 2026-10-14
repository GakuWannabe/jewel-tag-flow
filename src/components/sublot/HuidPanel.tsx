import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { db, rpc, errMsg, fmt3 } from "@/lib/db";
import { parseHuids, type HuidRow } from "@/lib/imports";

export function HuidPanel({ sublot, expectedPieces, canEdit, onDone }: { sublot: any; expectedPieces?: number; canEdit: boolean; onDone: () => void }) {
  const [rows, setRows] = useState<HuidRow[] | null>(null);
  const [dupes, setDupes] = useState<any[]>([]);
  const [confirmText, setConfirmText] = useState("");
  const { data: pool = [], refetch } = useQuery({
    queryKey: ["pool-admin", sublot.id],
    queryFn: async () => (await db.rpc("huid_pool_admin", { p_sublot: sublot.id })).data ?? [],
  });
  const assignedIds = [...new Set(pool.filter((p: any) => p.assigned_item_id).map((p: any) => p.assigned_item_id))];
  const { data: locs = {} } = useQuery({
    queryKey: ["pool-locs", sublot.id, assignedIds.join(",")],
    enabled: assignedIds.length > 0,
    queryFn: async () => {
      const { data } = await db.from("items").select("id,compartment_no,tray_sessions(trays(tray_code))").in("id", assignedIds);
      const m: Record<string, string> = {};
      for (const i of data ?? []) m[i.id] = `${i.tray_sessions?.trays?.tray_code ?? "?"}-${String(i.compartment_no).padStart(2, "0")}`;
      return m;
    },
  });

  const load = async (f: File) => {
    try {
      const r = await parseHuids(f);
      setRows(r.rows); setConfirmText("");
      const found = await rpc<any[]>("check_huids", { p_huids: r.rows.map((x) => x.huid) });
      setDupes(found ?? []);
    } catch (e) { toast.error(errMsg(e)); }
  };

  const del = async (p: any) => {
    const r = prompt(`Delete HUID ${p.huid} from the pool?\nIt is logged permanently and can be re-imported later.\n\nReason (required):`);
    if (!r?.trim()) return;
    try { await rpc("delete_pool_huid", { p_huid_pool_id: p.id, p_reason: r }); toast.success(`${p.huid} deleted`); refetch(); onDone(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const bad = rows?.filter((r) => r.error) ?? [];
  const total = rows?.reduce((a, r) => a + (r.weight ?? 0), 0) ?? 0;
  const poolTotal = pool.reduce((a: number, r: any) => a + Number(r.piece_weight ?? 0), 0);
  const allCount = pool.length + (rows?.length ?? 0);
  const countOff = expectedPieces != null && allCount !== expectedPieces;
  const sorted = [...pool].sort((a: any, b: any) => (a.assigned_item_id ? 1 : 0) - (b.assigned_item_id ? 1 : 0));

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card p-3 text-sm">
        <b>Pool:</b> {pool.length} pieces · <span className="num">{fmt3(poolTotal)} g</span> · {pool.filter((p: any) => !p.assigned_item_id).length} unassigned
        {expectedPieces != null && <> · expected <b>{expectedPieces}</b> (declared pieces){pool.length !== expectedPieces && pool.length > 0 && <span className="ml-2 rounded bg-warning px-1 font-bold text-warning-foreground">MISMATCH</span>}</>}
      </div>
      {pool.length > 0 && (
        <div className="max-h-80 overflow-auto rounded-lg border bg-card">
          <table className="num w-full text-sm">
            <tbody>{sorted.map((p: any) => (
              <tr key={p.id} className={`border-t ${p.assigned_item_id ? "" : "bg-warning/30 font-bold"}`}>
                <td className="p-2">{p.huid}</td>
                <td className="p-2">{fmt3(p.piece_weight)} g</td>
                <td className="p-2 font-sans">{p.assigned_item_id ? <>On {locs[p.assigned_item_id] ?? "item"}</> : <span className="text-warning-foreground">Not assigned — blocks close</span>}</td>
                <td className="p-2 text-right">{!p.assigned_item_id && canEdit && <Button size="sm" variant="destructive" onClick={() => void del(p)}>Delete</Button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <label className="block cursor-pointer rounded-lg border-2 border-dashed border-input p-6 text-center font-semibold">
          Choose hallmarking list (.xlsx / .csv — columns HUID, weight)
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} />
        </label>
      )}
      {rows && (
        <div className="space-y-2 rounded-lg border bg-card p-4">
          <p className="num text-lg font-bold">{rows.length} pieces · {fmt3(total)} g</p>
          {countOff && (
            <div className="space-y-2 rounded bg-destructive p-3 text-destructive-foreground">
              <p className="font-semibold">
                This list has {allCount} pieces but {expectedPieces} were declared.{" "}
                {allCount > expectedPieces! ? "Importing a surplus HUID will block this sublot from closing until it is deleted." : "The sublot cannot close until the missing HUIDs are imported."}
              </p>
              <label className="block text-sm">Type <b>CONFIRM</b> to import anyway
                <input className="mt-1 h-11 w-full rounded border bg-background px-2 text-foreground" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
              </label>
            </div>
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
          <Button className="h-12 w-full" disabled={bad.length > 0 || dupes.length > 0 || (countOff && confirmText.trim() !== "CONFIRM")} onClick={async () => {
            try {
              const n = await rpc<number>("import_huids", { p_sublot: sublot.id, p_rows: rows.map((r) => ({ huid: r.huid, weight: r.weight })) });
              toast.success(`${n} HUIDs added`); setRows(null); setConfirmText(""); refetch(); onDone();
            } catch (e) { toast.error(errMsg(e)); }
          }}>Add {rows.length} HUIDs to pool</Button>
        </div>
      )}
    </div>
  );
}
