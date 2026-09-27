import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import JSZip from "jszip";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { db, rpc, errMsg } from "@/lib/db";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/photo/$sublotId")({
  head: () => ({ meta: [{ title: "Shot list — Tagging Line" }, { name: "description", content: "Shot list and photo ZIP upload." }] }),
  component: PhotoSublot,
});

const pad2 = (n: number) => String(n).padStart(2, "0");
const NAME_RE = /^(.+)-([A-Za-z0-9]+)-(\d{1,3})\.jpe?g$/i;

interface Report { matched: { name: string; itemId: string; data: Uint8Array }[]; missing: string[]; extra: string[]; duplicates: string[] }

function PhotoSublot() {
  const { sublotId } = Route.useParams();
  const { has } = useAuth();
  const canUpload = has("photo", "manager");
  const [report, setReport] = useState<Report | null>(null);
  const [progress, setProgress] = useState("");
  const { data, refetch } = useQuery({
    queryKey: ["shot", sublotId],
    queryFn: async () => {
      const { data: s } = await db.from("sublots").select("id,sublot_no,status, lots(lot_no)").eq("id", sublotId).single();
      const { data: items } = await db.from("items").select("id,compartment_no,photo_url,source_photo_name,hold_flag, tray_sessions(trays(tray_code))").eq("sublot_id", sublotId).is("deleted_at", null);
      return { s, items: (items ?? []).map((i: any) => ({ ...i, tray: i.tray_sessions.trays.tray_code })) };
    },
  });
  if (!data?.s) return <AppShell title="Shot list" back="/photo"><p>Loading…</p></AppShell>;
  const lotNo: string = data.s.lots.lot_no;
  const items = [...data.items].sort((a: any, b: any) => a.tray.localeCompare(b.tray) || a.compartment_no - b.compartment_no);
  const trays = [...new Set(items.map((i: any) => i.tray))] as string[];
  const expectName = (i: any) => `${lotNo}-${i.tray}-${pad2(i.compartment_no)}.jpg`;
  const key = (tray: string, c: number) => `${tray.toUpperCase()}|${c}`;
  const byKey = new Map(items.map((i: any) => [key(i.tray, i.compartment_no), i]));
  const canWrite = canUpload && ["photography", "ready_to_seal"].includes(data.s.status);

  const analyse = async (files: { name: string; data: Uint8Array }[]) => {
    const r: Report = { matched: [], missing: [], extra: [], duplicates: [] };
    const seen = new Set<string>();
    for (const f of files) {
      const base = f.name.split("/").pop()!;
      const m = base.match(NAME_RE);
      const it: any = m && m[1].toUpperCase() === lotNo.toUpperCase() ? byKey.get(key(m[2], Number(m[3]))) : null;
      if (!it) { r.extra.push(base); continue; }
      if (seen.has(it.id)) { r.duplicates.push(base); continue; }
      seen.add(it.id);
      r.matched.push({ name: base, itemId: it.id, data: f.data });
    }
    return r;
  };

  const onZip = async (file: File) => {
    try {
      const zip = await JSZip.loadAsync(file);
      const files: { name: string; data: Uint8Array }[] = [];
      for (const e of Object.values(zip.files)) {
        if (e.dir || e.name.startsWith("__MACOSX") || e.name.split("/").pop()!.startsWith(".")) continue;
        files.push({ name: e.name, data: await e.async("uint8array") });
      }
      const r = await analyse(files);
      const matchedIds = new Set(r.matched.map((m) => m.itemId));
      r.missing = items.filter((i: any) => !matchedIds.has(i.id) && !i.photo_url).map(expectName);
      setReport(r);
    } catch (e) { toast.error(errMsg(e)); }
  };

  const onSingles = async (list: FileList) => {
    const files = await Promise.all([...list].map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    const r = await analyse(files);
    r.missing = [];
    setReport(r);
  };

  const upload = async () => {
    if (!report) return;
    let n = 0;
    try {
      for (const m of report.matched) {
        const path = `${sublotId}/${m.name}`;
        // stored as-is: raw bytes, no re-compression
        const { error } = await db.storage.from("photos").upload(path, new Blob([m.data as BlobPart], { type: "image/jpeg" }), { upsert: true, contentType: "image/jpeg" });
        if (error) throw new Error(`${m.name}: ${error.message}`);
        await rpc("match_photo", { p_item: m.itemId, p_path: path, p_name: m.name });
        setProgress(`${++n}/${report.matched.length}`);
      }
      const st = await rpc<string>("refresh_photo_status", { p_sublot: sublotId });
      toast.success(`${n} photos stored${st === "ready_to_seal" ? " — all photos matched, ready to seal" : ""}`);
      setReport(null); refetch();
    } catch (e) { toast.error(errMsg(e)); } finally { setProgress(""); }
  };

  const done = items.filter((i: any) => i.photo_url).length;
  return (
    <AppShell title={`Shot list ${lotNo} #${data.s.sublot_no}`} back="/photo" actions={<Button variant="secondary" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /></Button>}>
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
        <span className="num text-xl font-bold">{lotNo}</span>
        <span>Trays: <b>{trays.join(", ")}</b></span>
        <span>Expected photos: <b className="num">{items.length}</b></span>
        <span>Matched: <b className="num">{done}</b></span>
        <StatusBadge status={data.s.status} />
      </div>
      <p className="mb-3 text-sm">One photo per occupied compartment, in tray order, named <code className="num">{lotNo}-A-07.jpg</code> (lot-tray-compartment, 2 digits).</p>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        {trays.map((t) => (
          <div key={t} className="rounded-lg border bg-card p-3">
            <h3 className="mb-2 text-2xl font-extrabold">Tray {t}</h3>
            <div className="flex flex-wrap gap-1.5">
              {items.filter((i: any) => i.tray === t).map((i: any) => (
                <span key={i.id} title={expectName(i)} className={`num rounded px-2 py-1 text-lg font-bold ${i.photo_url ? "bg-st-photo text-destructive-foreground" : i.hold_flag ? "bg-st-hold text-destructive-foreground" : "bg-muted"}`}>{pad2(i.compartment_no)}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
      {canWrite && (
        <div className="no-print grid gap-2 sm:grid-cols-2">
          <label className="cursor-pointer rounded-lg border-2 border-dashed border-input p-6 text-center font-semibold">
            Upload ZIP of photos
            <input type="file" accept=".zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onZip(f); e.target.value = ""; }} />
          </label>
          <label className="cursor-pointer rounded-lg border-2 border-dashed border-input p-6 text-center font-semibold">
            Replace individual photos
            <input type="file" accept=".jpg,.jpeg" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) void onSingles(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
      )}
      {report && (
        <div className="no-print mt-4 space-y-2 rounded-lg border bg-card p-4">
          <div className="grid grid-cols-4 gap-2 text-center">
            <Stat k="Matched" v={report.matched.length} tone="bg-success text-success-foreground" />
            <Stat k="Missing" v={report.missing.length} tone={report.missing.length ? "bg-destructive text-destructive-foreground" : "bg-muted"} />
            <Stat k="Extra" v={report.extra.length} tone={report.extra.length ? "bg-warning text-warning-foreground" : "bg-muted"} />
            <Stat k="Duplicates" v={report.duplicates.length} tone={report.duplicates.length ? "bg-warning text-warning-foreground" : "bg-muted"} />
          </div>
          {report.missing.length > 0 && <p className="num text-sm"><b className="font-sans">Missing:</b> {report.missing.join(", ")}</p>}
          {report.extra.length > 0 && <p className="num text-sm"><b className="font-sans">Unmatched files:</b> {report.extra.join(", ")}</p>}
          {report.duplicates.length > 0 && <p className="num text-sm"><b className="font-sans">Duplicates (ignored):</b> {report.duplicates.join(", ")}</p>}
          <Button className="h-14 w-full" disabled={!report.matched.length || !!progress} onClick={() => void upload()}>
            {progress ? `Uploading ${progress}` : `Store ${report.matched.length} matched photos`}
          </Button>
        </div>
      )}
    </AppShell>
  );
}

const Stat = ({ k, v, tone }: { k: string; v: number; tone: string }) => <div className={`rounded p-2 ${tone}`}><div className="text-xs">{k}</div><div className="num text-2xl font-bold">{v}</div></div>;
