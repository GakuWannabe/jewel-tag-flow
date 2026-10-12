import { useQuery } from "@tanstack/react-query";
import { db } from "./db";

export interface MapRow { field: string; column: string }
export interface Settings {
  recon_tolerance_per_10: number;
  ageing_minutes: number;
  photo_name_template: string;
  export_mapping: MapRow[];
  cors_origins: string[];
}
export const DEFAULT_TEMPLATE = "{COMPCODE}{IC}{ser_no}.jpg";

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async (): Promise<Settings> => {
      const { data } = await db.from("settings").select("key,value");
      const m = Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
      return {
        recon_tolerance_per_10: Number(m.recon_tolerance_per_10 ?? 0.05),
        ageing_minutes: Number(m.ageing_minutes ?? 30),
        photo_name_template: String(m.photo_name_template ?? DEFAULT_TEMPLATE),
        export_mapping: (m.export_mapping as MapRow[]) ?? [],
        cors_origins: Array.isArray(m.cors_origins) ? (m.cors_origins as string[]) : ["https://snap-jewel-stream.lovable.app", "http://localhost:5173"],
      };
    },
  });
}

export async function saveSetting(key: string, value: unknown) {
  const { error } = await db.from("settings").upsert({ key, value }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
