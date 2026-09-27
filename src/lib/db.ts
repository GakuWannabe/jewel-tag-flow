import { supabase } from "@/integrations/supabase/client";

// Loosely-typed handle: the schema is large and evolving; row shapes live in src/lib/types.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as any;

export const USERNAME_DOMAIN = "staff.taggingline.app";
export const usernameToEmail = (u: string) => `${u.trim().toLowerCase()}@${USERNAME_DOMAIN}`;

export function errMsg(e: unknown): string {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  const m = (e as { message?: string }).message;
  return m ?? String(e);
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const fmt3 = (n: number | null | undefined) =>
  n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toFixed(3);
