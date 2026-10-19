/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactNode } from "react";
import type { useStation } from "@/lib/station";
import type { Item } from "@/lib/types";
import { TrayGrid, type CellState } from "../TrayGrid";

export type Station = ReturnType<typeof useStation>;
export type Snap = NonNullable<Station["snap"]>;
export type StepKey = "load" | "weigh" | "huid" | "finish";
export interface StepProps { snap: Snap; run: Station["run"]; refresh: Station["refresh"]; locked: boolean; go: (s: StepKey) => void }

export const pad = (n: number) => String(n).padStart(2, "0");
export const huidsDone = (snap: Snap, i: Item) => (snap.itemHuids[i.id]?.length ?? 0) === i.pcs;
export const sortedItems = (snap: Snap) => [...snap.items].sort((a, b) => a.compartment_no - b.compartment_no);

export function Grid({ snap, stateOf, selected, onTap, sub, editMode, onMove }: { snap: Snap; stateOf: (n: number) => CellState; selected?: number | null; onTap: (n: number) => void; sub?: (n: number) => ReactNode; editMode?: boolean; onMove?: (a: number, b: number) => void }) {
  return <TrayGrid rows={snap.tray.rows} columns={snap.tray.columns} trayCode={snap.tray.tray_code} stateOf={stateOf} selected={selected} onTap={onTap} sub={sub} editMode={editMode} onMove={onMove} />;
}
