import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type CellState = "empty" | "loaded" | "weighed" | "huid" | "photo" | "hold";

const TONE: Record<CellState, string> = {
  empty: "bg-st-empty text-muted-foreground border-dashed",
  loaded: "bg-st-loaded text-accent-foreground",
  weighed: "bg-st-weighed text-foreground",
  huid: "bg-st-huid text-success-foreground",
  photo: "bg-st-photo text-destructive-foreground",
  hold: "bg-st-hold text-destructive-foreground",
};
export const STATE_LABEL: Record<CellState, string> = {
  empty: "Empty", loaded: "Awaiting weight", weighed: "Weighed", huid: "HUID done", photo: "Photographed", hold: "On hold",
};

/**
 * Renders at the tray's REAL rows x columns. Compartment 1 is top-left when the
 * tray letter (printed on the front edge) faces the user, so the letter is drawn
 * at the BOTTOM of the grid. Numbering is row-major.
 *
 * Edit mode: drag a filled compartment onto another (or tap one, then tap the target)
 * and `onMove(from, to)` fires.
 */
export function TrayGrid({ rows, columns, trayCode, stateOf, selected, onTap, sub, editMode, onMove, tone }: {
  rows: number; columns: number; trayCode: string;
  stateOf: (n: number) => CellState; selected?: number | null; onTap: (n: number) => void;
  sub?: (n: number) => string | null;
  editMode?: boolean; onMove?: (from: number, to: number) => void;
  tone?: (n: number) => string | null;
}) {
  const cells = Array.from({ length: rows * columns }, (_, i) => i + 1);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const moved = useRef(false);

  const cellAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest("[data-comp]") as HTMLElement | null;
    return el ? Number(el.dataset.comp) : null;
  };

  const down = (n: number, e: React.PointerEvent) => {
    if (!editMode) return;
    if (drag != null && drag !== n) return; // second tap handled on up
    if (stateOf(n) === "empty") return;
    moved.current = false;
    setDrag(n);
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!editMode || drag == null) return;
    const c = cellAt(e.clientX, e.clientY);
    if (c !== over) { setOver(c); if (c !== drag) moved.current = true; }
  };
  const up = (n: number, e: React.PointerEvent) => {
    if (!editMode) return onTap(n);
    if (drag == null) return;
    const target = moved.current ? cellAt(e.clientX, e.clientY) : n;
    if (target != null && target !== drag) {
      onMove?.(drag, target);
      setDrag(null); setOver(null);
    } else if (moved.current) { setDrag(null); setOver(null); }
    // plain tap on source keeps it picked; next tap on a target completes the move
  };

  return (
    <div className="rounded-xl border-4 border-primary bg-secondary p-2" style={{ touchAction: editMode ? "none" : undefined }} onPointerMove={move}>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {cells.map((n) => {
          const st = stateOf(n);
          const extra = tone?.(n);
          return (
            <button
              key={n}
              data-comp={n}
              type="button"
              onPointerDown={(e) => down(n, e)}
              onPointerUp={(e) => up(n, e)}
              className={cn(
                "relative flex min-h-16 select-none flex-col items-center justify-center rounded-lg border-2 border-border font-bold transition-transform active:scale-95",
                extra ?? TONE[st],
                selected === n && "ring-4 ring-ring ring-offset-2",
                editMode && st !== "empty" && "cursor-grab",
                drag === n && "scale-95 opacity-60 ring-4 ring-primary",
                editMode && drag != null && over === n && n !== drag && "ring-4 ring-warning ring-offset-2",
              )}
            >
              <span className="num text-xl leading-none">{String(n).padStart(2, "0")}</span>
              {sub?.(n) && <span className="num mt-0.5 text-[11px] font-semibold leading-none">{sub(n)}</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-2 rounded-md bg-primary py-1 text-center text-2xl font-extrabold tracking-[0.5em] text-primary-foreground">{trayCode}</div>
    </div>
  );
}

export function Legend({ only }: { only?: CellState[] }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {(only ?? (Object.keys(STATE_LABEL) as CellState[])).map((s) => (
        <span key={s} className="flex items-center gap-1"><span className={cn("h-4 w-4 rounded border", TONE[s])} />{STATE_LABEL[s]}</span>
      ))}
    </div>
  );
}
