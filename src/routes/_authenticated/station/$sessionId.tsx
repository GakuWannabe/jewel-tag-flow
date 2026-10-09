import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useStation } from "@/lib/station";
import { LoadStep, WeighStep, MatchStep, FinishStep, huidsDone, type StepKey, type Snap } from "@/components/station/steps-tray";
import { TagStep, HuidListStep } from "@/components/station/steps-input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/station/$sessionId")({
  head: () => ({ meta: [{ title: "Tray — Tagging Line" }, { name: "description", content: "Step by step: tag numbers, loading, weighing and HUIDs." }] }),
  component: SessionScreen,
});

const STEPS: { key: StepKey; label: string }[] = [
  { key: "tags", label: "Tag numbers" },
  { key: "load", label: "Load tray" },
  { key: "weigh", label: "Weigh" },
  { key: "huids", label: "HUID list" },
  { key: "match", label: "Match HUIDs" },
  { key: "finish", label: "Finish" },
];

function doneMap(s: Snap): Record<StepKey, boolean> {
  const n = s.items.length;
  return {
    tags: s.tagNumbers.length > 0,
    load: n > 0,
    weigh: n > 0 && s.items.every((i) => i.gross_weight != null),
    huids: s.pool.length > 0,
    match: n > 0 && s.items.every((i) => huidsDone(s, i)),
    finish: !["empty", "loaded"].includes(s.session.status),
  };
}

function SessionScreen() {
  const { sessionId } = Route.useParams();
  const { snap, error, run, refresh } = useStation(sessionId);
  const [step, setStep] = useState<StepKey | null>(null);

  useEffect(() => {
    if (snap && step == null) {
      const d = doneMap(snap);
      setStep(STEPS.find((s) => !d[s.key])?.key ?? "finish");
    }
  }, [snap, step]);

  if (error && !snap) return <AppShell title="Tray" back="/station"><p className="text-destructive">{error}</p></AppShell>;
  if (!snap || !step) return <AppShell title="Tray" back="/station"><p>Loading…</p></AppShell>;

  const locked = !["issued", "loading", "weighing"].includes(snap.sublot.status);
  const done = doneMap(snap);
  const go = (s: StepKey) => { setStep(s); window.scrollTo({ top: 0 }); };
  const props = { snap, run, refresh, locked, go };
  const idx = STEPS.findIndex((s) => s.key === step);

  return (
    <AppShell title={`${snap.sublot.lot_no} #${snap.sublot.sublot_no} · Tray ${snap.tray.tray_code}`} back="/station">
      {locked && <div className="mb-3 rounded-lg bg-destructive p-4 text-center text-lg font-bold text-destructive-foreground">{snap.sublot.status === "halted" ? "Reconciliation failed — call manager." : `Sublot is ${snap.sublot.status.replace(/_/g, " ")} — read only.`}</div>}

      <nav className="-mx-3 mb-4 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <ol className="flex min-w-max gap-2">
          {STEPS.map((s, i) => (
            <li key={s.key}>
              <button type="button" onClick={() => go(s.key)}
                className={cn("flex h-14 items-center gap-2 rounded-xl border-2 px-3 text-left font-bold",
                  step === s.key ? "border-primary bg-primary text-primary-foreground" : done[s.key] ? "border-success bg-card" : "border-border bg-card text-muted-foreground")}>
                <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-sm",
                  step === s.key ? "bg-primary-foreground text-primary" : done[s.key] ? "bg-success text-success-foreground" : "bg-muted")}>
                  {done[s.key] && step !== s.key ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                {s.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <h2 className="mb-3 text-2xl font-extrabold">Step {idx + 1}: {STEPS[idx].label}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{snap.sublot.product_name} ({snap.sublot.branch_code}{snap.sublot.base_code}) · changes by other staff on this sublot appear live.</p>

      {step === "tags" && <TagStep {...props} />}
      {step === "load" && <LoadStep {...props} />}
      {step === "weigh" && <WeighStep {...props} />}
      {step === "huids" && <HuidListStep {...props} />}
      {step === "match" && <MatchStep {...props} />}
      {step === "finish" && <FinishStep {...props} />}
    </AppShell>
  );
}
