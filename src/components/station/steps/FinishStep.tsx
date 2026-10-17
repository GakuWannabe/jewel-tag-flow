/* eslint-disable @typescript-eslint/no-explicit-any */
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { db, rpc, errMsg } from "@/lib/db";
import { cn } from "@/lib/utils";
import { huidsDone, type StepProps, type StepKey } from "./shared";

/* ---------------- FINISH ---------------- */
export function FinishStep({ snap, run, locked, go }: StepProps) {
  const nav = useNavigate();
  const items = snap.items;
  const weighed = items.filter((i) => i.gross_weight != null).length;
  const matched = items.filter((i) => huidsDone(snap, i)).length;
  const holds = items.filter((i) => i.hold_flag).length;
  const ready = items.length > 0 && weighed === items.length && matched === items.length;
  const closed = snap.session.status !== "empty" && snap.session.status !== "loaded";

  // Other open trays on this sublot decide the primary button's label.
  const { data: others } = useQuery({
    queryKey: ["other-sessions", snap.sublot.id, snap.session.id],
    queryFn: async () => (await db.from("tray_sessions").select("id").eq("sublot_id", snap.sublot.id).neq("id", snap.session.id).neq("status", "cleared")).data ?? [],
  });
  const moreTrays = (others?.length ?? 0) > 0;

  const Row = ({ label, v, ok, to }: { label: string; v: string; ok: boolean; to: StepKey }) => (
    <button type="button" onClick={() => go(to)} className={cn("flex w-full items-center justify-between rounded-lg border-2 p-4 text-left text-lg", ok ? "border-success" : "border-warning")}>
      <span className="font-semibold">{label}</span><span className="num font-bold">{v} {ok ? "✓" : "→"}</span>
    </button>
  );
  const closeSublot = async () => {
    if (!confirm(`Close sublot ${snap.sublot.lot_no} #${snap.sublot.sublot_no}? All trays must be finished.`)) return;
    try {
      const pass = await rpc<boolean>("close_sublot", { p_sublot: snap.sublot.id });
      if (pass) toast.success("Check passed — sealed and sent to tagging"); else toast.error("Check failed — call manager.", { duration: 20000 });
      void nav({ to: "/station" });
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div className="mx-auto max-w-xl space-y-3">
      <Row label="Loaded" v={`${snap.loadedCount}`} ok={items.length > 0} to="load" />
      <Row label="Weighed" v={`${weighed} / ${items.length}`} ok={items.length > 0 && weighed === items.length} to="weigh" />
      <Row label="HUIDs matched" v={`${matched} / ${items.length}`} ok={items.length > 0 && matched === items.length} to="weigh" />
      <Row label="Total net weight" v={`${snap.totalWeight.toFixed(3)} g`} ok={weighed === items.length && items.length > 0} to="weigh" />
      {holds > 0 && <p className="rounded-lg bg-destructive p-3 font-bold text-destructive-foreground">{holds} product(s) on hold — manager will review.</p>}
      {!locked && (
        <Button className="h-16 w-full text-xl" disabled={!ready && !closed} onClick={async () => {
          if (!closed) await run("close_tray_session", { p_session: snap.session.id }, `Close tray ${snap.tray.tray_code}`);
          if (moreTrays) void nav({ to: "/station" });
          else await closeSublot();
        }}>
          {ready || closed ? (moreTrays ? "Next tray →" : "Finish sublot") : "Complete the steps above first"}
        </Button>
      )}
      {closed && <p className="rounded-lg bg-success p-4 text-center text-lg font-bold text-success-foreground">Tray {snap.tray.tray_code} is finished.</p>}
      <Button variant="outline" className="h-14 w-full" onClick={() => nav({ to: "/station" })}>Back to station</Button>
    </div>
  );
}
