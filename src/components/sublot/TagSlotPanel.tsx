import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { db, rpc, errMsg } from "@/lib/db";
import { parseTagSlots, parseTagList, type SlotParse, type ManualSlotParse } from "@/lib/imports";
import { ERP_HEADERS } from "@/lib/erp-template";

const CONFIRM_WORD = "ASSUMED";

export function TagSlotPanel({ sublot, branch, baseCode, declaredTags, canEdit, onDone }: {
  sublot: any; branch: string; baseCode: string; declaredTags?: number; canEdit: boolean; onDone: () => void;
}) {
  const [p, setP] = useState<(SlotParse | ManualSlotParse) | null>(null);
  const [manual, setManual] = useState("");
  const [typed, setTyped] = useState("");
  const { data: current = [], refetch } = useQuery({
    queryKey: ["slots", sublot.id],
    queryFn: async () => (await db.from("tag_slots").select("ser_no,assigned_item_id,compcode,ic,assumed").eq("sublot_id", sublot.id).is("superseded_at", null).order("ser_no")).data ?? [],
  });

  const assumedCount = p && "assumedCount" in p ? p.assumedCount : 0;
  const commit = async () => {
    if (!p) return;
    if (assumedCount > 0 && typed !== CONFIRM_WORD) return toast.error(`Type ${CONFIRM_WORD} to confirm the assumed numbers`);
    try {
      const headers = p.headers.length ? p.headers : ERP_HEADERS;
      const n = await rpc<number>("import_tag_slots", { p_sublot: sublot.id, p_headers: headers, p_rows: p.rows });
      toast.success(`${n} tag slots imported`); setP(null); setTyped(""); setManual(""); refetch(); onDone();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const sers = current.map((c: any) => c.ser_no);
  const curAssumed = current.filter((c: any) => c.assumed);
  return (
    <div className="space-y-3">
      <div className="flex gap-2 rounded-lg border-2 border-warning bg-warning/20 p-3 font-semibold">
        <AlertTriangle className="h-6 w-6 shrink-0" />
        Re-export this list from the ERP immediately before starting the batch. Numbers consumed by other terminals since export will cause a mismatch.
      </div>
      <p className="text-sm">Expected: type <b>{branch}</b>, IC <b className="num">{branch}{baseCode}</b></p>
      {current.length > 0 && (
        <div className="space-y-2 rounded-lg border bg-card p-3 text-sm">
          <div>
            <b>Current list:</b> {current.length} slots · <span className="num">{Math.min(...sers)}–{Math.max(...sers)}</span>
            {" · "}{current.filter((c: any) => c.assigned_item_id).length} assigned · imported {sublot.slots_imported_at ? new Date(sublot.slots_imported_at).toLocaleString() : ""}
          </div>
          {curAssumed.length > 0 && (
            <p className="rounded bg-destructive p-2 font-semibold text-destructive-foreground">
              {curAssumed.length} ASSUMED numbers (not confirmed free by the ERP): <span className="num">{curAssumed.map((c: any) => c.ser_no).join(", ")}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-1">
            {current.map((c: any) => (
              <span key={c.ser_no} className={`num rounded px-1.5 py-0.5 text-xs ${c.assumed ? "border-2 border-destructive font-bold text-destructive" : "bg-muted"}`} title={c.assumed ? "Assumed free" : undefined}>
                {c.ser_no}{c.assumed ? "?" : ""}
              </span>
            ))}
          </div>
        </div>
      )}
      {canEdit && (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-input p-6 text-center font-semibold">
            Choose ERP tag slot sheet (.xlsx / .xls / .csv)
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              try { setTyped(""); setP(await parseTagSlots(f, { branch, baseCode })); } catch (err) { toast.error(errMsg(err)); }
              e.target.value = "";
            }} />
          </label>
          <div className="space-y-2 rounded-lg border-2 border-input p-3">
            <p className="font-semibold">Or type the numbers</p>
            <div className="flex gap-2 text-sm">
              <ReadOnly k="COMPCODE" v="A" /><ReadOnly k="type" v={branch} /><ReadOnly k="IC" v={`${branch}${baseCode}`} />
            </div>
            <Textarea className="num min-h-20" placeholder="66-79, 81-108, 110-128" value={manual} onChange={(e) => setManual(e.target.value)} />
            <Button variant="outline" className="h-11 w-full" disabled={!manual.trim()} onClick={() => { setTyped(""); setP(parseTagList(manual, { branch, baseCode, need: declaredTags })); }}>Check list</Button>
          </div>
        </div>
      )}
      {p && (
        <div className="space-y-2 rounded-lg border bg-card p-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat k="Available slots" v={p.count} />
            <Stat k="Min ser_no" v={p.min} />
            <Stat k="Max ser_no" v={p.max} />
          </div>
          <p className="text-sm"><b>Gaps ({p.gaps.length}):</b> <span className="num">{p.gaps.length ? p.gaps.join(", ") : "none"}</span></p>
          {p.headers.length > 0 && <p className="text-xs text-muted-foreground">{p.headers.length} columns in file; only COMPCODE, type, IC, ser_no, cmd are read. The full row is kept for the export.</p>}
          {declaredTags != null && p.count < declaredTags && (
            <p className="rounded bg-warning p-2 font-semibold text-warning-foreground">Warning: {p.count} slots available but {declaredTags} tags (compartments) declared.</p>
          )}
          {assumedCount > 0 && "givenMax" in p && (
            <div className="space-y-2 rounded border-2 border-destructive bg-destructive/10 p-3">
              <p className="font-bold text-destructive">
                {assumedCount} numbers beyond {p.givenMax} are assumed free. If the ERP has already used any, every tag after that point will be wrong.
              </p>
              <p className="num text-sm">Assumed: {p.rows.filter((r: any) => r.assumed).map((r) => r.ser_no).join(", ")}</p>
              <Input className="h-11" placeholder={`Type ${CONFIRM_WORD} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} />
            </div>
          )}
          {p.errors.length > 0 ? (
            <div className="rounded bg-destructive p-3 text-destructive-foreground"><b>List rejected:</b><ul className="list-disc pl-5">{p.errors.slice(0, 10).map((e) => <li key={e}>{e}</li>)}</ul></div>
          ) : (
            <Button className="h-12 w-full" disabled={assumedCount > 0 && typed !== CONFIRM_WORD} onClick={commit}>
              Import {p.count} slots{current.length ? " (replaces unassigned current list)" : ""}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

const ReadOnly = ({ k, v }: { k: string; v: string }) => <div className="flex-1 rounded bg-muted px-2 py-1"><div className="text-xs text-muted-foreground">{k}</div><div className="num font-bold">{v}</div></div>;
const Stat = ({ k, v }: { k: string; v: unknown }) => <div className="rounded bg-muted p-2"><div className="text-xs text-muted-foreground">{k}</div><div className="num text-2xl font-bold">{String(v)}</div></div>;
