/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "./db";
import { enqueue, onFlushed, snapGet, snapSet, useSync, type Op } from "./offline";
import type { Item, PoolRow } from "./types";

export interface Snap {
  session: { id: string; status: string; station: string; sublot_id: string };
  tray: { tray_code: string; rows: number; columns: number; compartment_count: number };
  sublot: { id: string; status: string; sublot_no: number; lot_no: string; base_code: string; product_name: string; default_pcs: number };
  items: Item[];
  pool: PoolRow[];
  itemHuids: Record<string, string[]>;
  sublotGross: number[]; // gross weights of OTHER sessions' items, for the running average
  fetchedAt: number;
}

async function fetchSnap(sessionId: string): Promise<Snap> {
  const { data: s, error } = await db
    .from("tray_sessions")
    .select("id,status,station,sublot_id, trays(tray_code,rows,columns,compartment_count), sublots(id,status,sublot_no, lots(lot_no), product_types(base_code,name,default_pcs))")
    .eq("id", sessionId)
    .single();
  if (error) throw new Error(error.message);
  const [items, pool, ih, others] = await Promise.all([
    db.from("items").select("*").eq("tray_session_id", sessionId).is("deleted_at", null),
    db.from("huid_pool").select("id,sublot_id,huid,piece_weight,assigned_item_id,deleted_at").eq("sublot_id", s.sublot_id).is("deleted_at", null),
    db.from("item_huids").select("item_id,position,huid_pool(huid), items!inner(sublot_id)").is("removed_at", null).eq("items.sublot_id", s.sublot_id),
    db.from("items").select("gross_weight").eq("sublot_id", s.sublot_id).neq("tray_session_id", sessionId).is("deleted_at", null).not("gross_weight", "is", null),
  ]);
  const itemHuids: Record<string, string[]> = {};
  for (const r of (ih.data ?? []).sort((a: any, b: any) => a.position - b.position)) (itemHuids[r.item_id] ??= []).push(r.huid_pool.huid);
  return {
    session: { id: s.id, status: s.status, station: s.station, sublot_id: s.sublot_id },
    tray: s.trays,
    sublot: {
      id: s.sublots.id, status: s.sublots.status, sublot_no: s.sublots.sublot_no, lot_no: s.sublots.lots.lot_no,
      base_code: s.sublots.product_types.base_code, product_name: s.sublots.product_types.name, default_pcs: s.sublots.product_types.default_pcs,
    },
    items: items.data ?? [],
    pool: pool.data ?? [],
    itemHuids,
    sublotGross: (others.data ?? []).map((x: any) => Number(x.gross_weight)),
    fetchedAt: Date.now(),
  };
}

/** Apply a queued op to a snapshot so the screen reflects unsynced work. */
export function applyOp(snap: Snap, op: Op): Snap {
  const a = op.args as any;
  const s: Snap = { ...snap, items: [...snap.items], pool: [...snap.pool], itemHuids: { ...snap.itemHuids }, session: { ...snap.session } };
  switch (op.fn) {
    case "set_compartment": {
      if (a.p_session !== s.session.id) return snap;
      const ex = s.items.find((i) => i.compartment_no === a.p_compartment);
      if (a.p_occupied && !ex) {
        s.items.push({
          id: a.p_item_id, tray_session_id: a.p_session, compartment_no: a.p_compartment, sublot_id: s.sublot.id, sequence: null,
          gross_weight: null, less_weight: 0, net_weight: null, pcs: s.sublot.default_pcs, narration: null, compcode: null, type: null,
          ic: null, ser_no: null, actual_ser_no: null, photo_filename: null, photo_url: null, source_photo_name: null,
          hold_flag: null, hold_note: null, deleted_at: null, weighed_at: null, photo_matched_at: null,
        });
      } else if (!a.p_occupied && ex && ex.gross_weight == null) {
        s.items = s.items.filter((i) => i !== ex);
      }
      s.session.status = s.items.length ? "loaded" : "empty";
      return s;
    }
    case "start_weighing": s.session.station = "weighing"; return s;
    case "save_weight":
      s.items = s.items.map((i) => i.id === a.p_item ? { ...i, gross_weight: a.p_gross, less_weight: a.p_less, net_weight: +(a.p_gross - a.p_less).toFixed(3), pcs: a.p_pcs, narration: a.p_narration } : i);
      return s;
    case "unassign_item_huids": {
      s.pool = s.pool.map((p) => (p.assigned_item_id === a.p_item ? { ...p, assigned_item_id: null } : p));
      delete s.itemHuids[a.p_item];
      return s;
    }
    case "assign_item_huids": {
      s.pool = s.pool.map((p) => (p.assigned_item_id === a.p_item ? { ...p, assigned_item_id: null } : p));
      for (const h of a.p_huids as string[]) {
        const row = s.pool.find((p) => p.huid === h);
        if (row) s.pool = s.pool.map((p) => (p.huid === h ? { ...p, assigned_item_id: a.p_item } : p));
        else s.pool.push({ id: `local-${h}`, sublot_id: s.sublot.id, huid: h, piece_weight: null, assigned_item_id: a.p_item, deleted_at: null });
      }
      s.itemHuids[a.p_item] = a.p_huids;
      return s;
    }
    case "set_hold":
      s.items = s.items.map((i) => (i.id === a.p_item ? { ...i, hold_flag: a.p_flag, hold_note: a.p_note } : i));
      return s;
    case "close_tray_session": s.session.status = "weighed"; return s;
    default: return snap;
  }
}

export function useStation(sessionId: string) {
  const [base, setBase] = useState<Snap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { queue } = useSync();

  const refresh = useCallback(async () => {
    try {
      const fresh = await fetchSnap(sessionId);
      setBase(fresh); setError(null);
      await snapSet(sessionId, fresh);
    } catch (e) {
      const cached = await snapGet<Snap>(sessionId);
      if (cached) setBase((b) => b ?? cached);
      else setError((e as Error).message);
    }
  }, [sessionId]);

  useEffect(() => {
    snapGet<Snap>(sessionId).then((c) => { if (c) setBase((b) => b ?? c); });
    void refresh();
    return onFlushed(() => void refresh());
  }, [sessionId, refresh]);

  const snap = useMemo(() => {
    if (!base) return null;
    // anything still queued has not reached the server yet — overlay it
    return queue.reduce(applyOp, base);
  }, [base, queue]);

  const run = useCallback(
    (fn: string, args: Record<string, unknown>, label: string, itemId?: string) =>
      enqueue({ fn, args, label, sublotId: base?.sublot.id, itemId }),
    [base?.sublot.id],
  );

  return { snap, error, refresh, run };
}
