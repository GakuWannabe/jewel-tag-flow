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
 */
export function TrayGrid({ rows, columns, trayCode, stateOf, selected, onTap, sub }: {
  rows: number; columns: number; trayCode: string;
  stateOf: (n: number) => CellState; selected?: number | null; onTap: (n: number) => void;
  sub?: (n: number) => string | null;
}) {
  const cells = Array.from({ length: rows * columns }, (_, i) => i + 1);
  return (
    <div className="rounded-xl border-4 border-primary bg-secondary p-2">
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {cells.map((n) => {
          const st = stateOf(n);
          return (
            <button
              key={n}
              type="button"
              onClick={() => onTap(n)}
              className={cn(
                "relative flex min-h-14 flex-col items-center justify-center rounded-lg border-2 border-border font-bold transition-transform active:scale-95",
                TONE[st],
                selected === n && "ring-4 ring-ring ring-offset-2",
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

export function Legend() {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {(Object.keys(STATE_LABEL) as CellState[]).map((s) => (
        <span key={s} className="flex items-center gap-1"><span className={cn("h-4 w-4 rounded border", TONE[s])} />{STATE_LABEL[s]}</span>
      ))}
    </div>
  );
}
