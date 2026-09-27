import type { PoolRow } from "./types";

export interface Suggestion { rows: PoolRow[]; sum: number; diff: number; spread: number }

const CONFUSABLE = /[0O1I5S8B2Z]/;
export const hasConfusable = (h: string) => CONFUSABLE.test(h);
export const normHuid = (h: string) => h.trim().toUpperCase();
export const validHuid = (h: string) => /^[A-Z0-9]{6}$/.test(h);

/** Top-N weight matches. pcs=1: closest single piece. pcs=2: pairs ranked by sum closeness then similarity. */
export function suggestHuids(pool: PoolRow[], net: number, pcs: number, n = 3): Suggestion[] {
  const free = pool.filter((p) => p.piece_weight != null);
  if (!(net > 0) || !free.length) return [];
  if (pcs === 1) {
    return free
      .map((r) => ({ rows: [r], sum: Number(r.piece_weight), diff: Math.abs(Number(r.piece_weight) - net), spread: 0 }))
      .sort((a, b) => a.diff - b.diff)
      .slice(0, n);
  }
  const out: Suggestion[] = [];
  const w = free.map((r) => Number(r.piece_weight));
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      const sum = w[i] + w[j];
      out.push({ rows: [free[i], free[j]], sum, diff: Math.abs(sum - net), spread: Math.abs(w[i] - w[j]) });
    }
  }
  // closeness of sum first; similarity as the tie-breaker (weighted so a near-identical pair wins close contests)
  out.sort((a, b) => a.diff + a.spread * 0.25 - (b.diff + b.spread * 0.25));
  return out.slice(0, n);
}
