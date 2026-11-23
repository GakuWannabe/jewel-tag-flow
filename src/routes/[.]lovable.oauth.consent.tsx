import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type OAuthResult = { data: any; error: { message: string } | null };
const oauth = (supabase.auth as unknown as { oauth: {
  getAuthorizationDetails: (id: string) => Promise<OAuthResult>;
  approveAuthorization: (id: string) => Promise<OAuthResult>;
  denyAuthorization: (id: string) => Promise<OAuthResult>;
} }).oauth;

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  head: () => ({ meta: [{ title: "Connect an assistant — Tagging Line" }, { name: "description", content: "Approve or deny an assistant's access to Tagging Line." }] }),
  validateSearch: (s: Record<string, unknown>) => ({ authorization_id: typeof s["authorization_id"] === "string" ? s["authorization_id"] : "" }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("This connection link is missing its authorization id.");
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/", search: { next: location.pathname + location.searchStr } });
  },
  loaderDeps: ({ search }) => ({ id: search.authorization_id }),
  loader: async ({ deps }) => {
    const { data, error } = await oauth.getAuthorizationDetails(deps.id);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <div className="max-w-sm rounded-xl bg-card p-6 text-center">
        <h1 className="text-xl font-bold">Could not load this connection request</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error instanceof Error ? error.message : String(error)}</p>
      </div>
    </main>
  ),
});

function Consent() {
  const d = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const client = d?.client?.name ?? "An assistant";
  const decide = async (approve: boolean) => {
    setBusy(true); setErr(null);
    const { data, error } = approve ? await oauth.approveAuthorization(authorization_id) : await oauth.denyAuthorization(authorization_id);
    const target = data?.redirect_url ?? data?.redirect_to;
    if (error || !target) { setBusy(false); setErr(error?.message ?? "No redirect returned."); return; }
    window.location.href = target;
  };
  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl bg-card p-6 shadow-2xl">
        <h1 className="text-2xl font-extrabold">Connect {client} to Tagging Line</h1>
        <p>This lets {client} use this app as you, read-only.</p>
        {d?.redirect_uri && <p className="num break-all text-xs text-muted-foreground">{d.redirect_uri}</p>}
        <p className="text-sm text-muted-foreground">Shares your basic profile. It cannot see anything your account cannot see.</p>
        {err && <p role="alert" className="text-sm font-medium text-destructive">{err}</p>}
        <Button className="h-14 w-full text-lg font-bold" disabled={busy} onClick={() => decide(true)}>Approve</Button>
        <Button variant="outline" className="h-14 w-full" disabled={busy} onClick={() => decide(false)}>Cancel connection</Button>
      </div>
    </main>
  );
}
