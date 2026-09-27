import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DOMAIN = "staff.taggingline.app";
const roleEnum = z.enum(["manager", "staff", "photo", "auditor"]);
const username = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{2,30}$/, "Username: 2-30 letters/digits");
const pin = z.string().regex(/^\d{6,8}$/, "PIN must be 6-8 digits");

export const needsBootstrap = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count } = await supabaseAdmin.from("user_roles").select("id", { count: "exact", head: true }).eq("role", "manager");
  return { needed: (count ?? 0) === 0 };
});

export const bootstrapManager = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ name: z.string().trim().min(1).max(80), username, pin }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin.from("user_roles").select("id", { count: "exact", head: true }).eq("role", "manager");
    if ((count ?? 0) > 0) throw new Error("Setup already completed");
    return createUserInternal(supabaseAdmin, { ...data, roles: ["manager"] });
  });

export const createAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ name: z.string().trim().min(1).max(80), username, pin, roles: z.array(roleEnum).min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "manager" });
    if (!ok) throw new Error("Manager only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return createUserInternal(supabaseAdmin, data);
  });

export const updateAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), pin: pin.optional(), roles: z.array(roleEnum).optional(), active: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "manager" });
    if (!ok) throw new Error("Manager only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.pin) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.id, { password: data.pin });
      if (error) throw new Error(error.message);
    }
    if (data.active !== undefined) {
      await supabaseAdmin.from("profiles").update({ active: data.active }).eq("id", data.id);
      await supabaseAdmin.auth.admin.updateUserById(data.id, { ban_duration: data.active ? "none" : "876000h" });
    }
    if (data.roles) {
      if (data.id === context.userId && !data.roles.includes("manager")) throw new Error("You cannot remove your own manager role");
      await supabaseAdmin.from("user_roles").delete().eq("user_id", data.id);
      await supabaseAdmin.from("user_roles").insert(data.roles.map((role) => ({ user_id: data.id, role })));
    }
    return { ok: true };
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createUserInternal(admin: any, d: { name: string; username: string; pin: string; roles: string[] }) {
  const { data: created, error } = await admin.auth.admin.createUser({
    email: `${d.username}@${DOMAIN}`,
    password: d.pin,
    email_confirm: true,
    user_metadata: { name: d.name, username: d.username },
  });
  if (error) throw new Error(error.message.includes("already") ? "Username already taken" : error.message);
  const id = created.user.id as string;
  const { error: pErr } = await admin.from("profiles").insert({ id, name: d.name, username: d.username });
  if (pErr) throw new Error(pErr.message);
  await admin.from("user_roles").insert(d.roles.map((role) => ({ user_id: id, role })));
  return { id };
}
