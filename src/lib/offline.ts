// Offline-tolerant write queue. Every staff write is an RPC call recorded in
// IndexedDB first, then replayed in order. A refresh never loses queued work.
import { get, set } from "idb-keyval";
import { useSyncExternalStore } from "react";
import { db } from "./db";

export interface Op {
  id: string;
  fn: string;
  args: Record<string, unknown>;
  label: string;
  sublotId?: string;
  itemId?: string;
  createdAt: number;
}
export interface Conflict { op: Op; error: string; at: number }

type Status = "online" | "syncing" | "offline";
interface State { queue: Op[]; status: Status; conflicts: Conflict[]; loaded: boolean }

let state: State = { queue: [], status: "online", conflicts: [], loaded: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const setState = (p: Partial<State>) => { state = { ...state, ...p }; emit(); };
const QKEY = "tl-queue-v1";
const CKEY = "tl-conflicts-v1";

let started = false;
let flushing = false;
const afterFlush = new Set<() => void>();

export function onFlushed(cb: () => void) { afterFlush.add(cb); return () => { afterFlush.delete(cb); }; }

function isNetworkError(msg: string) {
  return (typeof navigator !== "undefined" && !navigator.onLine) || /failed to fetch|network|load failed|timeout|fetch/i.test(msg);
}

export async function startSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  const [q, c] = await Promise.all([get<Op[]>(QKEY), get<Conflict[]>(CKEY)]);
  setState({ queue: q ?? [], conflicts: c ?? [], loaded: true, status: navigator.onLine ? "online" : "offline" });
  window.addEventListener("online", () => { setState({ status: "online" }); void flush(); });
  window.addEventListener("offline", () => setState({ status: "offline" }));
  setInterval(() => { if (state.queue.length) void flush(); }, 8000);
  void flush();
}

export async function enqueue(op: Omit<Op, "id" | "createdAt">) {
  const full: Op = { ...op, id: crypto.randomUUID(), createdAt: Date.now() };
  const queue = [...state.queue, full];
  await set(QKEY, queue);
  setState({ queue });
  void flush();
}

export async function flush() {
  if (flushing || !state.queue.length) return;
  if (!navigator.onLine) { setState({ status: "offline" }); return; }
  flushing = true;
  setState({ status: "syncing" });
  try {
    while (state.queue.length) {
      const op = state.queue[0];
      const { error } = await db.rpc(op.fn, op.args);
      if (error) {
        const msg = String(error.message ?? error);
        if (isNetworkError(msg)) { setState({ status: "offline" }); return; }
        // business conflict: drop op, keep it on record and report it loudly
        const conflicts = [...state.conflicts, { op, error: msg, at: Date.now() }];
        await set(CKEY, conflicts);
        setState({ conflicts });
        await db.from("sync_conflicts").insert({ sublot_id: op.sublotId ?? null, item_id: op.itemId ?? null, op, error: msg });
      }
      const queue = state.queue.slice(1);
      await set(QKEY, queue);
      setState({ queue });
    }
    setState({ status: "online" });
    afterFlush.forEach((f) => f());
  } finally {
    flushing = false;
  }
}

export async function dismissConflicts() { await set(CKEY, []); setState({ conflicts: [] }); }

export function useSync() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
    () => state,
  );
}

// Local snapshot cache so a station screen reopens offline after a refresh.
export const snapGet = <T,>(k: string) => get<T>(`tl-snap-${k}`);
export const snapSet = (k: string, v: unknown) => set(`tl-snap-${k}`, v);
