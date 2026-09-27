import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import { db, errMsg } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export interface Col { key: string; label: string; type?: "text" | "number" | "bool"; required?: boolean }
export interface MasterConfig {
  table: string; title: string; cols: Col[]; conflictKey: string; order: string;
  transform?: (row: Record<string, unknown>) => Record<string, unknown>;
}

function coerce(col: Col, v: unknown) {
  if (col.type === "number") return v === "" || v == null ? null : Number(v);
  if (col.type === "bool") return v === true || String(v).toLowerCase() === "true" || v === "1" || String(v).toLowerCase() === "yes";
  return v == null ? null : String(v).trim();
}

export function MasterTable({ cfg, canEdit }: { cfg: MasterConfig; canEdit: boolean }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["master", cfg.table],
    queryFn: async () => {
      const { data, error } = await db.from(cfg.table).select("*").order(cfg.order);
      if (error) throw error;
      return data as Record<string, unknown>[];
    },
  });
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ["master", cfg.table] });

  const save = async (row: Record<string, unknown>, id?: string) => {
    let payload: Record<string, unknown> = {};
    for (const c of cfg.cols) if (row[c.key] !== undefined) payload[c.key] = coerce(c, row[c.key]);
    if (cfg.transform) payload = cfg.transform(payload);
    const q = id ? db.from(cfg.table).update(payload).eq("id", id) : db.from(cfg.table).insert(payload);
    const { error } = await q;
    if (error) { toast.error(error.message); return false; }
    toast.success("Saved"); refresh(); return true;
  };

  const importCsv = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      complete: async (res) => {
        try {
          const rows = res.data.map((r) => {
            let o: Record<string, unknown> = {};
            for (const c of cfg.cols) if (r[c.key] !== undefined) o[c.key] = coerce(c, r[c.key]);
            if (cfg.transform) o = cfg.transform(o);
            return o;
          });
          const { error } = await db.from(cfg.table).upsert(rows, { onConflict: cfg.conflictKey });
          if (error) throw error;
          toast.success(`Imported ${rows.length} rows`); refresh();
        } catch (e) { toast.error(errMsg(e)); }
      },
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">CSV headers: <code className="num">{cfg.cols.map((c) => c.key).join(",")}</code></p>
        {canEdit && (
          <label className="cursor-pointer rounded-md border-2 border-dashed border-input px-3 py-2 text-sm font-semibold">
            Import CSV
            <input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          </label>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>{cfg.cols.map((c) => <th key={c.key} className="px-2 py-2 font-semibold">{c.label}</th>)}{canEdit && <th />}</tr>
          </thead>
          <tbody>
            {data.map((row) => <Row key={String(row.id)} row={row} cols={cfg.cols} canEdit={canEdit} onSave={(r) => save(r, String(row.id))} />)}
            {canEdit && (
              <tr className="border-t-2 bg-secondary/50">
                {cfg.cols.map((c) => (
                  <td key={c.key} className="px-1 py-1">
                    {c.type === "bool" ? (
                      <Switch checked={draft[c.key] !== false} onCheckedChange={(v) => setDraft({ ...draft, [c.key]: v })} />
                    ) : (
                      <Input className="h-10" placeholder={c.label} inputMode={c.type === "number" ? "decimal" : undefined} value={String(draft[c.key] ?? "")} onChange={(e) => setDraft({ ...draft, [c.key]: e.target.value })} />
                    )}
                  </td>
                ))}
                <td className="px-1"><Button className="h-10" onClick={async () => { if (await save({ active: true, ...draft })) setDraft({}); }}>Add</Button></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ row, cols, canEdit, onSave }: { row: Record<string, unknown>; cols: Col[]; canEdit: boolean; onSave: (r: Record<string, unknown>) => Promise<boolean> }) {
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  return (
    <tr className="border-t">
      {cols.map((c) => (
        <td key={c.key} className="px-2 py-1.5">
          {edit ? (
            c.type === "bool" ? <Switch checked={!!edit[c.key]} onCheckedChange={(v) => setEdit({ ...edit, [c.key]: v })} />
              : <Input className="h-10" value={String(edit[c.key] ?? "")} onChange={(e) => setEdit({ ...edit, [c.key]: e.target.value })} />
          ) : c.type === "bool" ? (row[c.key] ? "Yes" : "No") : <span className={c.type === "number" ? "num" : ""}>{String(row[c.key] ?? "")}</span>}
        </td>
      ))}
      {canEdit && (
        <td className="whitespace-nowrap px-1">
          {edit ? (
            <>
              <Button size="sm" onClick={async () => { if (await onSave(edit)) setEdit(null); }}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            </>
          ) : <Button size="sm" variant="outline" onClick={() => setEdit({ ...row })}>Edit</Button>}
        </td>
      )}
    </tr>
  );
}
