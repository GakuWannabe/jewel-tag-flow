import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useStation } from "@/lib/station";
import { LoadStep } from "@/components/station/steps/LoadStep";
import { WeighStep } from "@/components/station/steps/WeighStep";
import { FinishStep } from "@/components/station/steps/FinishStep";
import { HuidStep } from "@/components/station/steps/HuidStep";
import { Button } from "@/components/ui/button";
import { huidsDone, type StepKey, type Snap } from "@/components/station/steps/shared";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/station/$sessionId")({
  head: () => ({ meta: [{ title: "Tray — Tagging Line" }, { name: "description", content: "Load, weigh, assign HUIDs and finish a jewellery tray." }, { property: "og:title", content: "Tray — Tagging Line" }, { property: "og:description", content: "Four separate passes for jewellery tray work." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  validateSearch: (s: Record<string, unknown>): { step?: StepKey } =>
    s.step === "load" || s.step === "weigh" || s.step === "huid" || s.step === "finish" ? { step: s.step } : {},
  component: SessionScreen,
});

const STEPS: { key: StepKey; label: string }[] = [
  { key: "load", label: "Load tray" },
  { key: "weigh", label: "Weigh" },
  { key: "huid", label: "HUID" },
  { key: "finish", label: "Finish" },
];

export function doneMap(s: Snap): Record<StepKey, boolean> {
  const n = s.items.length;
  return {
    load: n > 0,
    weigh: n > 0 && s.items.every((i) => i.gross_weight != null),
    huid: n > 0 && s.items.every((i) => huidsDone(s, i)),
    finish: !["empty", "loaded"].includes(s.session.status),
  };
}

function SessionScreen() {
  const { sessionId } = Route.useParams();
  const { step: requestedStep } = Route.useSearch();
  return <SessionPass key={sessionId} sessionId={sessionId} requestedStep={requestedStep} />;
}

function SessionPass({ sessionId, requestedStep }: { sessionId: string; requestedStep?: StepKey }) {
  const navigate = Route.useNavigate();
  const { snap, error, run, refresh } = useStation(sessionId);
  const [step, setStep] = useState<StepKey | null>(requestedStep ?? null);
  const currentSnap = snap?.session.id === sessionId ? snap : null;

  useEffect(() => {
    if (currentSnap && step == null) {
      const d = doneMap(currentSnap);
      setStep(STEPS.find((s) => !d[s.key])?.key ?? "finish");
    }
  }, [currentSnap, step]);
  useEffect(() => { if (requestedStep) setStep(requestedStep); }, [requestedStep]);

  if (error && !snap) return <AppShell title="Tray" back="/station"><p className="text-destructive">{error}</p></AppShell>;
  if (!snap || !currentSnap || !step) return <AppShell title="Tray" back="/station"><p>Loading…</p></AppShell>;

  const locked = !["issued", "loading", "weighing"].includes(snap.sublot.status);
  const done = doneMap(snap);
  const go = (s: StepKey) => { setStep(s); void navigate({ search: { step: s }, replace: true }); window.scrollTo({ top: 0 }); };
  const props = { snap, run, refresh, locked, go };
  const idx = STEPS.findIndex((s) => s.key === step);

  return (
    <AppShell title={`${snap.sublot.lot_no} #${snap.sublot.sublot_no} · Tray ${snap.tray.tray_code}`} back="/station">
      {locked && <div className="mb-3 rounded-lg bg-destructive p-4 text-center text-lg font-bold text-destructive-foreground">{snap.sublot.status === "halted" ? "Reconciliation failed — call manager." : `Sublot is ${snap.sublot.status.replace(/_/g, " ")} — read only.`}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="num rounded-lg bg-card px-3 py-2 text-lg font-bold">{snap.loadedCount} loaded</span>
        <span className="num rounded-lg bg-card px-3 py-2 text-lg font-bold">{snap.totalWeight.toFixed(3)} g total</span>
      </div>

      <nav className="-mx-3 mb-4 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <ol className="flex min-w-max gap-2">
          {STEPS.map((s, i) => (
            <li key={s.key}>
              <Button variant="outline" type="button" onClick={() => go(s.key)}
                className={cn("flex h-14 items-center gap-2 rounded-xl border-2 px-3 text-left font-bold",
                  step === s.key ? "border-primary bg-primary text-primary-foreground" : done[s.key] ? "border-success bg-card" : "border-border bg-card text-muted-foreground")}>
                <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-sm",
                  step === s.key ? "bg-primary-foreground text-primary" : done[s.key] ? "bg-success text-success-foreground" : "bg-muted")}>
                  {done[s.key] && step !== s.key ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                {s.label}
              </Button>
            </li>
          ))}
        </ol>
      </nav>

      <h2 className="mb-3 text-2xl font-extrabold">Step {idx + 1}: {STEPS[idx].label}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{snap.sublot.product_name} ({snap.sublot.branch_code}{snap.sublot.base_code}) · changes by other staff on this sublot appear live.</p>

      {step === "load" && <LoadStep {...props} />}
      {step === "weigh" && <WeighStep {...props} />}
      {step === "huid" && <HuidStep {...props} />}
      {step === "finish" && <FinishStep {...props} />}
    </AppShell>
  );
}
