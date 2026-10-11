import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ArrowLeft, LogOut } from "lucide-react";
import { SyncIndicator } from "./SyncIndicator";
import { useAuth } from "@/lib/auth";

export function AppShell({ title, back, children, actions }: { title: string; back?: string; children: ReactNode; actions?: ReactNode }) {
  const { name, signOut } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-30 flex items-center gap-2 border-b border-sidebar-border bg-sidebar px-3 py-2 text-sidebar-foreground">
        {back ? (
          <Link to={back} className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-sidebar-accent" aria-label="Back">
            <ArrowLeft className="h-6 w-6" />
          </Link>
        ) : (
          <Link to="/app" className="px-1 text-sm font-extrabold tracking-tight text-sidebar-primary">TAGGING LINE</Link>
        )}
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{title}</h1>
        {actions}
        <SyncIndicator />
        <button onClick={() => void signOut()} className="flex h-11 items-center gap-1 rounded-md px-2 text-xs hover:bg-sidebar-accent" title={`Sign out ${name}`}>
          <LogOut className="h-5 w-5" />
        </button>
      </header>
      <main className="mx-auto max-w-6xl p-3 sm:p-4">{children}</main>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    issued: "bg-info text-info-foreground",
    loading: "bg-st-loaded text-accent-foreground",
    weighing: "bg-st-weighed text-foreground",
    photography: "bg-st-photo text-destructive-foreground",
    ready_to_seal: "bg-success text-success-foreground",
    sealed: "bg-primary text-primary-foreground",
    ready_to_export: "bg-success text-success-foreground",
    exported: "bg-primary text-primary-foreground",
    closed: "bg-muted text-muted-foreground",
    halted: "bg-destructive text-destructive-foreground",
  };
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold uppercase ${tone[status] ?? "bg-muted"}`}>{status.replace(/_/g, " ")}</span>;
}
