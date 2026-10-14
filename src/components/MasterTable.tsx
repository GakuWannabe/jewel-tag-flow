import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import { db, errMsg } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export interface Lookup { table: string; match: string; fk: string; rel: string }
export interface Col { key: string; label: string; type?: "text" | "number" | "bool" | "intlist"; required?: boolean; default?: number; example?: string; lookup?: Lookup }
export interface Ref { table: string; col: string; label: string }
export interface MasterConfig {
  table: string; title: string; cols: Col[]; conflictKey: string; order: string;
  transform?: (row: Record<string, unknown>) => Record<string, unknown>;
  refs?: Ref[];
  duplicate?: string[];
  select?: string;
  filterCol?: string;
}

const blank = (v: unknown) => v == null || String(v).trim() === "";

function coerce(col: Col, v: unknown) {
  if (col.type === "number") return blank(v) ? (col.default ?? null) : Number(v);
  if (col.type === "intlist") return blank(v) ? null : (Array.isArray(v) ? v : String(v).split(/[\s,;]+/).filter(Boolean)).map(Number);
  if (col.type === "bool") return v === true || String(v).toLowerCase() === "true" || v === "1" || String(v).toLowerCase() === "yes";
  return v == null ? null : String(v).trim();
}

function cellError(c: Col, v: unknown): string | null {
  if (c.type === "intlist") {
    if (blank(v)) return c.required ? "is empty" : null;
    const xs = String(v).split(/[\s,;]+/).filter(Boolean);
    if (!xs.length || xs.some((x) => !/^\d+$/.test(x) || Number(x) < 1)) return `"${v}" must be whole numbers ≥ 1, comma-separated`;
    return null;
  }
  if (c.type === "number") {
    if (blank(v)) return c.default == null && c.required ? "is empty" : null;
    return Number.isNaN(Number(v)) ? `"${v}" is not a number` : null;
  }
  if (c.required && c.type !== "bool" && blank(v)) return "is empty";
  return null;
}

const display = (c: Col, row: Record<string, unknown>) =>
  c.lookup ? String((row[c.lookup.rel] as Record<string, unknown> | null)?.[c.lookup.match] ?? "")
    : c.type === "intlist" ? (Array.isArray(row[c.key]) ? (row[c.key] as number[]).join(",") : "")
    : String(row[c.key] ?? "");

function exampleFor(c: Col) {
  if (c.example != null) return c.example;
  if (c.type === "bool") return "true";
  if (c.type === "number") return String(c.default ?? 1);
  return c.label;
}

export function MasterTable({ cfg, canEdit }: { cfg: MasterConfig; canEdit: boolean }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["master", cfg.table],
    queryFn: async () => {
      const { data, error } = await db.from(cfg.table).select(cfg.select ?? "*").order(cfg.order);
      if (error) throw error;
      return data as Record<string, unknown>[];
    },
  });
  const lookups = cfg.cols.filter((c) => c.lookup);
  const { data: lk = {} } = useQuery({
    queryKey: ["master-lookups", cfg.table],
    enabled: lookups.length > 0,
    queryFn: async () => {
      const out: Record<string, Map<string, string>> = {};
      for (const c of lookups) {
        const { data, error } = await db.from(c.lookup!.table).select(`id,${c.lookup!.match}`);
        if (error) throw error;
        out[c.key] = new Map((data ?? []).map((r: any) => [String(r[c.lookup!.match]).toUpperCase(), r.id]));
      }
      return out;
    },
  });
  const [filter, setFilter] = useState("");
  const filterCol = cfg.filterCol ? cfg.cols.find((c) => c.key === cfg.filterCol) : undefined;
  const filterValues = filterCol ? [...new Set(data.map((r) => display(filterCol, r)))].filter(Boolean).sort() : [];
  const shown = filterCol && filter ? data.filter((r) => display(filterCol, r) === filter) : data;

  /** Coerce + resolve lookups. Returns an error string (without row prefix) or the payload. */
  const build = (row: Record<string, unknown>): { payload?: Record<string, unknown>; error?: string } => {
    let payload: Record<string, unknown> = {};
    for (const c of cfg.cols) {
      if (row[c.key] === undefined) continue;
      if (c.lookup) {
        const code = String(row[c.key] ?? "").trim().toUpperCase();
        if (!code) { if (c.required) return { error: `${c.key} is empty` }; continue; }
        const id = lk[c.key]?.get(code);
        if (!id) return { error: `${c.key} "${code}" is not a known ${c.lookup.table.replace(/s$/, "")}` };
        payload[c.lookup.fk] = id;
        continue;
      }
      payload[c.key] = coerce(c, row[c.key]);
    }
    if (cfg.transform) payload = cfg.transform(payload);
    return { payload };
  };
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ["master", cfg.table] });

  const save = async (row: Record<string, unknown>, id?: string) => {
    for (const c of cfg.cols) { const e = row[c.key] !== undefined ? cellError(c, row[c.key]) : null; if (e) { toast.error(`${c.label} ${e}`); return false; } }
    const b = build(row);
    if (b.error) { toast.error(b.error); return false; }
    const payload = b.payload!;
    const q = id ? db.from(cfg.table).update(payload).eq("id", id) : db.from(cfg.table).insert(payload);
    const { error } = await q;
    if (error) { toast.error(error.message); return false; }
    toast.success("Saved"); refresh(); return true;
  };

  const downloadTemplate = () => {
    const csv = Papa.unparse({ fields: cfg.cols.map((c) => c.key), data: [cfg.cols.map(exampleFor)] });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${cfg.table}_template.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const importCsv = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      complete: async (res) => {
        try {
          const errors: string[] = [];
          const rows = res.data.map((r, i) => {
            const rowNo = i + 2; // row 1 is the header
            const src: Record<string, unknown> = {};
            let bad = false;
            for (const c of cfg.cols) {
              const v = r[c.key];
              const e = cellError(c, v);
              if (e) { errors.push(`Row ${rowNo}: ${c.key} ${e}`); bad = true; }
              if (v !== undefined || (c.type === "number" && c.default != null) || c.lookup) src[c.key] = v ?? "";
            }
            if (bad) return {};
            const b = build(src);
            if (b.error) { errors.push(`Row ${rowNo}: ${b.error}`); return {}; }
            return b.payload!;
          });
          if (!rows.length) errors.push("File has no data rows");
          if (errors.length) {
            toast.error(`Nothing imported. ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? ` (+${errors.length - 5} more)` : ""}`);
            return;
          }
          // single upsert statement = all rows or none
          const { error } = await db.from(cfg.table).upsert(rows, { onConflict: cfg.conflictKey });
          if (error) throw error;
          toast.success(`Imported ${rows.length} rows`); refresh();
        } catch (e) { toast.error(`Nothing imported. ${errMsg(e)}`); }
      },
    });
  };

  const remove = async (row: Record<string, unknown>) => {
    const id = String(row.id);
    const uses: string[] = [];
    for (const r of cfg.refs ?? []) {
      const { count, error } = await db.from(r.table).select("id", { count: "exact", head: true }).eq(r.col, id);
      if (error) { toast.error(error.message); return; }
      if (count) uses.push(`${count} ${r.label}`);
    }
    const name = String(row[cfg.conflictKey] ?? "");
    if (uses.length) {
      if (!row.active) { toast.info(`Used by ${uses.join(", ")} — already inactive.`); return; }
      if (window.confirm(`"${name}" is used by ${uses.join(", ")} and cannot be deleted.\n\nDeactivate it instead?`)) await save({ active: false }, id);
      return;
    }
    if (!window.confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
    const { data: del, error } = await db.from(cfg.table).delete().eq("id", id).select("id");
    if (error) { toast.error(error.message); return; }
    if (!del?.length) {
      if (window.confirm(`The database did not allow deleting "${name}".\n\nDeactivate it instead?`)) await save({ active: false }, id);
      return;
    }
    toast.success("Deleted"); refresh();
  };

  const duplicate = cfg.duplicate
    ? (row: Record<string, unknown>) => {
        const d: Record<string, unknown> = {};
        for (const k of cfg.duplicate!) d[k] = row[k];
        setDraft(d);
        toast.info("Copied into the add row — enter a new code.");
      }
    : undefined;

  return (
    <div className="space-y-3">
      {filterCol && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{filterCol.label}:</span>
          {["", ...filterValues].map((v) => (
            <Button key={v || "all"} size="sm" variant={filter === v ? "default" : "outline"} onClick={() => setFilter(v)}>{v || "All"}</Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">CSV headers: <code className="num">{cfg.cols.map((c) => c.key).join(",")}</code></p>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" className="h-10" onClick={downloadTemplate}>Download template</Button>
            <label className="cursor-pointer rounded-md border-2 border-dashed border-input px-3 py-2 text-sm font-semibold">
              Import CSV
              <input type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} />
            </label>
          </div>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>{cfg.cols.map((c) => <th key={c.key} className="px-2 py-2 font-semibold">{c.label}</th>)}{canEdit && <th />}</tr>
          </thead>
          <tbody>
            {shown.map((row) => <Row key={String(row.id)} row={row} cols={cfg.cols} canEdit={canEdit} onSave={(r) => save(r, String(row.id))} onDelete={() => remove(row)} onDuplicate={duplicate ? () => duplicate(row) : undefined} />)}
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

function Row({ row, cols, canEdit, onSave, onDelete, onDuplicate }: {
  row: Record<string, unknown>; cols: Col[]; canEdit: boolean;
  onSave: (r: Record<string, unknown>) => Promise<boolean>; onDelete: () => void; onDuplicate?: () => void;
}) {
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  return (
    <tr className="border-t">
      {cols.map((c) => (
        <td key={c.key} className="px-2 py-1.5">
          {edit ? (
            c.type === "bool" ? <Switch checked={!!edit[c.key]} onCheckedChange={(v) => setEdit({ ...edit, [c.key]: v })} />
              : <Input className="h-10" value={String(edit[c.key] ?? "")} onChange={(e) => setEdit({ ...edit, [c.key]: e.target.value })} />
          ) : c.type === "bool" ? (row[c.key] ? "Yes" : "No") : <span className={c.type === "number" || c.type === "intlist" ? "num" : ""}>{display(c, row)}</span>}
        </td>
      ))}
      {canEdit && (
        <td className="whitespace-nowrap px-1">
          {edit ? (
            <>
              <Button size="sm" onClick={async () => { if (await onSave(edit)) setEdit(null); }}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            </>
          ) : (
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => { const e: Record<string, unknown> = { ...row }; for (const c of cols) if (c.lookup || c.type === "intlist") e[c.key] = display(c, row); setEdit(e); }}>Edit</Button>
              {onDuplicate && <Button size="sm" variant="outline" onClick={onDuplicate}>Duplicate</Button>}
              <Button size="sm" variant="destructive" onClick={onDelete}>Delete</Button>
            </div>
          )}
        </td>
      )}
    </tr>
  );
}
