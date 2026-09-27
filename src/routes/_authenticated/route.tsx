import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // getSession works offline from local storage — staff must keep working without wifi
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/" });
    return { user: data.session.user };
  },
  component: () => <Outlet />,
});
