/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { db, rpc, errMsg } from "@/lib/db";
import { Button } from "@/components/ui/button";

const status = (i: any) => (i.photo_url ? "done" : i.photo_skipped_at ? "skipped" : "pending");

export function PhotoPanel({ sublot, isMgr, onChange }: { sublot: any; isMgr: boolean; onChange: () => void }) {
  const id = sublot.id;
  const { data, refetch } = useQuery({
    queryKey: ["photo-panel", id],
    queryFn: async () => {
      const [it, ph] = await Promise.all([
        db.from("items").select("id,sequence,compartment_no,ser_no,photo_filename,photo_url,photo_skipped_at,photo_skip_reason,photo_delivered_at, tray_sessions(trays(tray_code))").eq("sublot_id", id).is("deleted_at", null).order("sequence"),
        db.from("user_roles").select("user_id, profiles:user_id(name)").eq("role", "photo"),
      ]);
      return { items: it.data ?? [], photographers: ph.data ?? [] };
    },
  });
  // live progress while the photo app uploads
  useEffect(() => {
    const ch = db.channel(`photos-${id}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "items", filter: `sublot_id=eq.${id}` }, () => void refetch()).subscribe();
    return () => { void db.removeChannel(ch); };
  }, [id, refetch]);

  const sealedLike = ["sealed", "photography", "ready_to_export", "exported"].includes(sublot.status);
  if (!sealedLike) return <p className="rounded-lg border bg-card p-4 text-muted-foreground">Photography starts after the sublot is sealed — tag numbers are needed to name each photo.</p>;
  const items = data?.items ?? [];
  const done = items.filter((i: any) => status(i) === "done").length;
  const gaps = items.filter((i: any) => status(i) === "skipped");
  const delivered = items.filter((i: any) => i.photo_delivered_at).length;
  const withPhoto = items.filter((i: any) => i.photo_url).length;

  const assign = async (uid: string) => {
    try { await rpc("assign_photographer", { p_sublot: id, p_user: uid || null }); toast.success("Sent to photography"); onChange(); refetch(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div className="space-y-3">
      <section className="space-y-2 rounded-lg border bg-card p-4">
        <h3 className="font-bold">Photographer</h3>
        {isMgr && sublot.status !== "exported" ? (
          <div className="flex flex-wrap gap-2">
            <select className="h-12 flex-1 rounded-md border bg-background px-3" defaultValue={sublot.photographer_id ?? ""} onChange={(e) => void assign(e.target.value)}>
              <option value="">— choose photographer —</option>
              {(data?.photographers ?? []).map((p: any) => <option key={p.user_id} value={p.user_id}>{p.profiles?.name ?? p.user_id}</option>)}
            </select>
            {sublot.status !== "photography" && <Button className="h-12" onClick={() => void assign(sublot.photographer_id ?? "")}>{sublot.status === "ready_to_export" ? "Send back for re-shoot" : "Send to photography"}</Button>}
          </div>
        ) : <p>{(data?.photographers ?? []).find((p: any) => p.user_id === sublot.photographer_id)?.profiles?.name ?? "—"}</p>}
        <p className="text-xs text-muted-foreground">The photo app picks up sublots in photography with its device key (Settings → device keys).</p>
      </section>

      <section className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Stat k="Done" v={`${done} / ${items.length}`} tone="bg-success text-success-foreground" />
        <Stat k="Skipped (gaps)" v={String(gaps.length)} tone={gaps.length ? "bg-destructive text-destructive-foreground" : "bg-muted"} />
        <Stat k="Pending" v={String(items.length - done - gaps.length)} tone="bg-muted" />
        <Stat k="Delivered to ERP" v={withPhoto ? `${delivered} / ${withPhoto}` : "—"} tone={withPhoto && delivered === withPhoto ? "bg-primary text-primary-foreground" : "bg-muted"} />
      </section>
      {withPhoto > 0 && delivered === withPhoto && <p className="rounded-lg bg-primary p-3 font-bold text-primary-foreground">✓ All photos delivered to the ERP — stored copies removed.</p>}

      {gaps.length > 0 && (
        <section className="space-y-2 rounded-lg border-2 border-destructive bg-card p-4">
          <h3 className="font-bold text-destructive">PHOTO GAPS</h3>
          <p className="text-sm text-muted-foreground">Clear a gap by sending the sublot back for a re-shoot, or unseal it and remove the item.</p>
          <table className="num w-full text-sm"><tbody>{gaps.map((i: any) => (
            <tr key={i.id} className="border-t"><td className="p-1">#{i.sequence}</td><td>{i.tray_sessions?.trays?.tray_code}-{String(i.compartment_no).padStart(2, "0")}</td><td>{i.photo_filename}</td>
              <td className="font-sans">{i.photo_skip_reason}</td><td className="font-sans text-xs">{new Date(i.photo_skipped_at).toLocaleString()}</td></tr>
          ))}</tbody></table>
        </section>
      )}

      <section className="overflow-x-auto rounded-lg border bg-card">
        <table className="num w-full text-sm">
          <thead className="bg-muted text-left font-sans"><tr><th className="p-2">Seq</th><th>Pos</th><th>Tag</th><th>Filename</th><th>Status</th></tr></thead>
          <tbody>{items.map((i: any) => (
            <tr key={i.id} className="border-t"><td className="p-2">{i.sequence}</td><td>{i.tray_sessions?.trays?.tray_code}-{String(i.compartment_no).padStart(2, "0")}</td><td>{i.ser_no}</td><td>{i.photo_filename}</td>
              <td className={`font-sans font-bold ${status(i) === "done" ? "text-success" : status(i) === "skipped" ? "text-destructive" : "text-muted-foreground"}`}>{status(i)}{i.photo_delivered_at ? " · in ERP" : ""}</td></tr>
          ))}</tbody>
        </table>
      </section>
    </div>
  );
}

const Stat = ({ k, v, tone }: { k: string; v: string; tone: string }) => <div className={`rounded-lg p-3 ${tone}`}><div className="text-xs">{k}</div><div className="num text-2xl font-bold">{v}</div></div>;
