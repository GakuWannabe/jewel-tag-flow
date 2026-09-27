import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { usernameToEmail, errMsg } from "@/lib/db";
import { needsBootstrap, bootstrapManager } from "@/lib/users.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tagging Line — Shreedevi Jewellers" },
      { name: "description", content: "Assembly-line jewellery tagging: tray loading, weighing, HUID matching, photos and ERP export." },
      { property: "og:title", content: "Tagging Line — Shreedevi Jewellers" },
      { property: "og:description", content: "Assembly-line jewellery tagging workflow for the tagging department." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Login,
});

function Login() {
  const { session, ready } = useAuth();
  const nav = useNavigate();
  const check = useServerFn(needsBootstrap);
  const boot = useServerFn(bootstrapManager);
  const [setup, setSetup] = useState(false);
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (ready && session) void nav({ to: "/app" }); }, [ready, session, nav]);
  useEffect(() => { check().then((r) => setSetup(r.needed)).catch(() => {}); }, [check]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (setup) await boot({ data: { name, username, pin } });
      const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password: pin });
      if (error) throw new Error(error.message === "Invalid login credentials" ? "Wrong username or PIN" : error.message);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-xl bg-card p-6 shadow-2xl">
        <div>
          <p className="text-xs font-bold tracking-[0.3em] text-muted-foreground">SHREEDEVI JEWELLERS</p>
          <h1 className="text-3xl font-extrabold tracking-tight">Tagging Line</h1>
          {setup && <p className="mt-2 rounded bg-accent p-2 text-sm font-medium text-accent-foreground">First run: create the manager account.</p>}
        </div>
        {setup && (
          <div className="space-y-1.5">
            <Label>Your name</Label>
            <Input className="h-14 text-lg" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        )}
        <div className="space-y-1.5">
          <Label>Username</Label>
          <Input className="h-14 text-lg" autoCapitalize="none" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>PIN</Label>
          <Input className="num h-14 text-2xl tracking-[0.4em]" type="password" inputMode="numeric" pattern="\d{6,8}" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} required />
          <p className="text-xs text-muted-foreground">6 to 8 digits</p>
        </div>
        <Button type="submit" disabled={busy} className="h-14 w-full text-lg font-bold">
          {setup ? "Create & sign in" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
