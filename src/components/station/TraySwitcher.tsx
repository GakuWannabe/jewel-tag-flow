/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/db";
import { onFlushed, useSync } from "@/lib/offline";
import type { Snap, StepKey } from "./steps/shared";

export function useTraySessions(snap: Snap) {
  const { queue } = useSync();
  const query = useQuery({
    queryKey: ["sublot-tray-progress", snap.sublot.id],
    queryFn: async () => {
      const [sessions, items, huids] = await Promise.all([
        db.from("tray_sessions").select("id,status,trays(tray_code)").eq("sublot_id", snap.sublot.id).neq("status", "cleared"),
        db.from("items").select("id,tray_session_id,compartment_no,gross_weight,pcs").eq("sublot_id", snap.sublot.id).is("deleted_at", null),
        db.from("item_huids").select("item_id,items!inner(sublot_id)").eq("items.sublot_id", snap.sublot.id).is("removed_at", null),
      ]);
      for (const result of [sessions, items, huids]) if (result.error) throw result.error;
      return { sessions: sessions.data ?? [], items: items.data ?? [], huids: huids.data ?? [] };
    },
    refetchInterval: 5000,
  });
  const refetch = query.refetch;
  useEffect(() => {
    const kick = () => { void refetch(); };
    const ch = db.channel(`tray-progress-${snap.sublot.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: `sublot_id=eq.${snap.sublot.id}` }, kick)
      .on("postgres_changes", { event: "*", schema: "public", table: "tray_sessions", filter: `sublot_id=eq.${snap.sublot.id}` }, kick)
      .on("postgres_changes", { event: "*", schema: "public", table: "item_huids" }, kick).subscribe();
    const stop = onFlushed(kick);
    return () => { stop(); void db.removeChannel(ch); };
  }, [snap.sublot.id, refetch]);
  const counts = new Map<string, number>();
  for (const h of query.data?.huids ?? []) counts.set(h.item_id, (counts.get(h.item_id) ?? 0) + 1);
  let rows: any[] = (query.data?.items ?? []).map((i: any) => ({ ...i }));
  const statuses = new Map<string, string>();
  for (const op of queue) {
    const a = op.args as any;
    if (op.fn === "save_weight") rows = rows.map((i) => i.id === a.p_item ? { ...i, gross_weight: a.p_gross, pcs: a.p_pcs } : i);
    if (op.fn === "assign_item_huids") counts.set(a.p_item, a.p_huids.length);
    if (op.fn === "unassign_item_huids") counts.set(a.p_item, 0);
    if (op.fn === "close_tray_session") statuses.set(a.p_session, "weighed");
    if (op.fn === "set_compartment") {
      const existing = rows.find((i) => i.tray_session_id === a.p_session && i.compartment_no === a.p_compartment);
      if (a.p_occupied && !existing) rows.push({ id: a.p_item_id, tray_session_id: a.p_session, compartment_no: a.p_compartment, gross_weight: null, pcs: 1 });
      if (!a.p_occupied && existing?.gross_weight == null) rows = rows.filter((i) => i !== existing);
    }
  }
  const sessions = (query.data?.sessions ?? []).map((s: any) => {
    const own = s.id === snap.session.id;
    const items = own ? snap.items : rows.filter((i) => i.tray_session_id === s.id);
    const status = own ? snap.session.status : statuses.get(s.id) ?? s.status;
    const weighed = items.filter((i: any) => i.gross_weight != null).length;
    const matched = items.filter((i: any) => (own ? snap.itemHuids[i.id]?.length ?? 0 : counts.get(i.id) ?? 0) === i.pcs).length;
    const finished = !["empty", "loaded"].includes(status) && items.length > 0 && weighed === items.length && matched === items.length;
    return { id: s.id as string, code: s.trays.tray_code as string, status: status as string, total: items.length, weighed, matched, finished };
  }).sort((a: any, b: any) => a.code.localeCompare(b.code));
  return { ...query, sessions };
}

export function TraySwitcher({ snap, step }: { snap: Snap; step: StepKey }) {
  const nav = useNavigate();
  const { sessions, isError } = useTraySessions(snap);
  return (
    <label className="flex flex-wrap items-center gap-3 font-bold">
      <span>Tray</span>
      <select aria-label="Switch tray" className="h-12 min-w-0 flex-1 rounded-md border-2 bg-background px-3 text-lg" value={snap.session.id}
        onChange={(e) => void nav({ to: "/station/$sessionId", params: { sessionId: e.target.value }, search: { step } })}>
        {!sessions.length && <option value={snap.session.id}>{snap.tray.tray_code}</option>}
        {sessions.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.weighed}/{s.total} weighed{s.finished ? " ✓" : ""}</option>)}
      </select>
      {isError && <span className="text-sm text-destructive">Tray list unavailable</span>}
    </label>
  );
}