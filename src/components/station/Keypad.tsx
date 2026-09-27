import { Delete } from "lucide-react";

/** Large on-screen numeric keypad for gloved, one-handed use. Enforces max 3 decimals. */
export function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const press = (k: string) => {
    if (k === "del") return onChange(value.slice(0, -1));
    if (k === "clr") return onChange("");
    if (k === ".") return value.includes(".") ? undefined : onChange((value || "0") + ".");
    const [, dec] = value.split(".");
    if (dec !== undefined && dec.length >= 3) return;
    if (value === "0" && k !== ".") return onChange(k);
    if (value.replace(".", "").length >= 8) return;
    onChange(value + k);
  };
  const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "del"];
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => press(k)}
          className="num flex h-16 items-center justify-center rounded-lg border-2 border-border bg-card text-3xl font-bold active:bg-accent"
        >
          {k === "del" ? <Delete className="h-8 w-8" /> : k}
        </button>
      ))}
      <button type="button" onClick={() => press("clr")} className="col-span-3 h-11 rounded-lg bg-muted text-sm font-bold">CLEAR</button>
    </div>
  );
}
