import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

const MANAGER_ONLY = ["/manager/users", "/manager/settings"];

export const Route = createFileRoute("/_authenticated/manager")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) throw redirect({ to: "/" });
    let roles: string[] | null = null;
    const { data: rows, error } = await supabase.from("user_roles").select("role").eq("user_id", uid);
    if (!error) roles = (rows ?? []).map((r: { role: string }) => r.role);
    else {
      // offline: fall back to the roles cached at last sign-in (data reads are still RLS-protected)
      try { roles = JSON.parse(localStorage.getItem(`tl-me-${uid}`) ?? "null")?.roles ?? []; } catch { roles = []; }
    }
    const r = roles ?? [];
    const mgr = r.includes("manager");
    if (!mgr && !r.includes("auditor")) throw redirect({ to: "/app" });
    if (!mgr && MANAGER_ONLY.some((p) => location.pathname.startsWith(p))) throw redirect({ to: "/app" });
  },
  component: () => <Outlet />,
});
