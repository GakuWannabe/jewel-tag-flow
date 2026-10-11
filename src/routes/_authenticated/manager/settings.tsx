import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db, errMsg } from "@/lib/db";
import { saveSetting, sha256Hex, useSettings, type MapRow } from "@/lib/settings";

export const Route = createFileRoute("/_authenticated/manager/settings")({
  head: () => ({ meta: [{ title: "Settings — Tagging Line" }, { name: "description", content: "Tolerance, ageing, photo naming, export mapping and bot keys." }] }),
  component: SettingsPage,
});

export const INTERNAL_FIELDS = [
  "gross_weight", "less_weight", "net_weight", "narration", "pcs", "purity_label", "melting", "making_value", "making_type",
  "wastage_pct", "vendor_code", "huids", "cat_a", "cat_b", "cat_c", "stone_pcs", "photo_filename", "imgyesno", "size",
];

function SettingsPage() {
  const qc = useQueryClient();
  const { data: s } = useSettings();
  const [tol, setTol] = useState(""); const [age, setAge] = useState(""); const [tpl, setTpl] = useState("");
  const [map, setMap] = useState<MapRow[]>([]);
  useEffect(() => { if (s) { setTol(String(s.recon_tolerance_per_10)); setAge(String(s.ageing_minutes)); setTpl(s.photo_name_template); setMap(s.export_mapping); } }, [s]);

  const save = async (k: string, v: unknown) => {
    try { await saveSetting(k, v); toast.success("Saved"); qc.invalidateQueries({ queryKey: ["settings"] }); } catch (e) { toast.error(errMsg(e)); }
  };

  const { data: bots = [], refetch } = useQuery({ queryKey: ["bots"], queryFn: async () => (await db.from("bot_clients").select("*").order("created_at")).data ?? [] });
  const [botName, setBotName] = useState("");
  const [kind, setKind] = useState<"bot" | "photo">("photo");

  return (
    <AppShell title="Settings" back="/app">
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Reconciliation tolerance">
          <Label>Grams allowed per 10 pieces</Label>
          <div className="flex gap-2"><Input className="num h-12" inputMode="decimal" value={tol} onChange={(e) => setTol(e.target.value)} /><Button className="h-12" onClick={() => save("recon_tolerance_per_10", Number(tol))}>Save</Button></div>
        </Card>
        <Card title="WIP ageing threshold">
          <Label>Minutes at one station before highlighting</Label>
          <div className="flex gap-2"><Input className="num h-12" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} /><Button className="h-12" onClick={() => save("ageing_minutes", Number(age))}>Save</Button></div>
        </Card>
        <Card title="ERP photo filename">
          <Label>Tokens: {"{COMPCODE} {IC} {ser_no}"}</Label>
          <div className="flex gap-2"><Input className="num h-12" value={tpl} onChange={(e) => setTpl(e.target.value)} /><Button className="h-12" onClick={() => save("photo_name_template", tpl)}>Save</Button></div>
          <p className="num text-xs text-muted-foreground">e.g. {tpl.replace("{COMPCODE}", "A").replace("{IC}", "WKC").replace("{ser_no}", "66")}</p>
        </Card>
      </div>

      <Card title="Export field mapping (internal field → ERP sheet column)" className="mt-4">
        <p className="text-sm text-muted-foreground">Only mapped columns are written. Every other column is copied exactly as exported by the ERP.</p>
        <div className="space-y-1">
          {map.map((m, i) => (
            <div key={i} className="flex gap-2">
              <select className="h-10 flex-1 rounded-md border bg-background px-2" value={m.field} onChange={(e) => setMap(map.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}>
                {INTERNAL_FIELDS.map((f) => <option key={f}>{f}</option>)}
              </select>
              <Input className="num h-10 flex-1" value={m.column} onChange={(e) => setMap(map.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)))} />
              <Button variant="ghost" onClick={() => setMap(map.filter((_, j) => j !== i))}>✕</Button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setMap([...map, { field: "narration", column: "" }])}>Add row</Button>
          <Button onClick={() => save("export_mapping", map.filter((m) => m.column.trim()))}>Save mapping</Button>
        </div>
      </Card>

      <Card title="Device keys — photo app & ERP bot" className="mt-4">
        <p className="text-sm text-muted-foreground">Each device sends its key in the <code>x-api-key</code> header. A photo key only works on the photo app endpoints, a bot key only on the ERP bot endpoints. Keys are shown once.</p>
        <div className="flex gap-2">
          <select className="h-12 rounded-md border bg-background px-2" value={kind} onChange={(e) => setKind(e.target.value as "bot" | "photo")}><option value="photo">Photo app</option><option value="bot">ERP bot</option></select>
          <Input className="h-12" placeholder="Device name (e.g. Photo phone 1)" value={botName} onChange={(e) => setBotName(e.target.value)} />
          <Button className="h-12" disabled={!botName.trim()} onClick={async () => {
            const key = "tlk_" + [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
            const { error } = await db.from("bot_clients").insert({ name: botName.trim(), kind, key_hash: await sha256Hex(key), key_hint: key.slice(-4) });
            if (error) return toast.error(error.message);
            setBotName(""); refetch();
            prompt("Copy this API key now — it will not be shown again:", key);
          }}>Create key</Button>
        </div>
        {bots.map((b: any) => (
          <div key={b.id} className="flex items-center justify-between rounded border p-2">
            <span><span className="mr-2 rounded bg-muted px-2 py-0.5 text-xs font-bold uppercase">{b.kind === "photo" ? "Photo app" : "ERP bot"}</span><b>{b.name}</b> <span className="num text-muted-foreground">…{b.key_hint}</span></span>
            <Button size="sm" variant={b.active ? "destructive" : "default"} onClick={async () => { await db.from("bot_clients").update({ active: !b.active }).eq("id", b.id); refetch(); }}>{b.active ? "Revoke" : "Re-enable"}</Button>
          </div>
        ))}
      </Card>
    </AppShell>
  );
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={`space-y-2 rounded-lg border bg-card p-4 ${className}`}><h2 className="font-bold">{title}</h2>{children}</section>;
}
