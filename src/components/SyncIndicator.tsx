import { useSync, dismissConflicts, flush } from "@/lib/offline";
import { Wifi, WifiOff, RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export function SyncIndicator() {
  const { status, queue, conflicts } = useSync();
  const n = queue.length;
  const label = status === "offline" ? `Offline${n ? ` · ${n} pending` : ""}` : status === "syncing" || n ? `Syncing (${n} pending)` : "Online";
  return (
    <div className="flex items-center gap-2">
      {conflicts.length > 0 && (
        <button
          onClick={() => { if (confirm(conflicts.map((c) => `${c.op.label}: ${c.error}`).join("\n") + "\n\nDismiss? (manager has been notified)")) void dismissConflicts(); }}
          className="flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-xs font-bold text-destructive-foreground animate-pulse"
        >
          <AlertTriangle className="h-4 w-4" /> {conflicts.length} sync conflict{conflicts.length > 1 ? "s" : ""}
        </button>
      )}
      <button
        onClick={() => void flush()}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold",
          status === "offline" ? "bg-destructive text-destructive-foreground" : n ? "bg-warning text-warning-foreground" : "bg-success text-success-foreground",
        )}
      >
        {status === "offline" ? <WifiOff className="h-4 w-4" /> : n ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
        {label}
      </button>
    </div>
  );
}
