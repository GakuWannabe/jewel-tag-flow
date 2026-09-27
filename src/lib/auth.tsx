import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { db } from "./db";
import type { Role } from "./types";

interface AuthState {
  ready: boolean;
  session: Session | null;
  userId: string | null;
  name: string;
  roles: Role[];
  has: (...r: Role[]) => boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [name, setName] = useState("");

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) { setRoles([]); setName(""); return; }
    // cache for offline restarts
    const cached = typeof localStorage !== "undefined" ? localStorage.getItem(`tl-me-${uid}`) : null;
    if (cached) { const c = JSON.parse(cached); setRoles(c.roles); setName(c.name); }
    Promise.all([
      db.from("user_roles").select("role").eq("user_id", uid),
      db.from("profiles").select("name").eq("id", uid).maybeSingle(),
    ]).then(([r, p]: any[]) => {
      if (r.error) return;
      const rs = (r.data ?? []).map((x: { role: Role }) => x.role);
      setRoles(rs); setName(p.data?.name ?? "");
      localStorage.setItem(`tl-me-${uid}`, JSON.stringify({ roles: rs, name: p.data?.name ?? "" }));
    });
  }, [session?.user.id]);

  const value: AuthState = {
    ready, session, userId: session?.user.id ?? null, name, roles,
    has: (...r) => r.some((x) => roles.includes(x)),
    signOut: async () => { await supabase.auth.signOut(); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside provider");
  return c;
}
