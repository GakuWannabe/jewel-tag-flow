import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { db, errMsg } from "@/lib/db";
import { createAppUser, updateAppUser } from "@/lib/users.functions";
import type { Role } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/manager/users")({
  head: () => ({ meta: [{ title: "Users — Tagging Line" }, { name: "description", content: "Manage staff, roles and PINs." }] }),
  component: Users,
});

const ROLES: Role[] = ["manager", "staff", "photo", "auditor"];

function Users() {
  const qc = useQueryClient();
  const create = useServerFn(createAppUser);
  const update = useServerFn(updateAppUser);
  const { data = [] } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const [p, r] = await Promise.all([db.from("profiles").select("*").order("name"), db.from("user_roles").select("*")]);
      return (p.data ?? []).map((u: any) => ({ ...u, roles: (r.data ?? []).filter((x: any) => x.user_id === u.id).map((x: any) => x.role) }));
    },
  });
  const [form, setForm] = useState({ name: "", username: "", pin: "", roles: ["staff"] as Role[] });
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });

  const toggle = (list: Role[], r: Role) => (list.includes(r) ? list.filter((x) => x !== r) : [...list, r]);

  return (
    <AppShell title="Users" back="/app">
      <form
        className="mb-6 grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-5"
        onSubmit={async (e) => {
          e.preventDefault();
          try { await create({ data: form }); toast.success("User created"); setForm({ name: "", username: "", pin: "", roles: ["staff"] }); refresh(); }
          catch (err) { toast.error(errMsg(err)); }
        }}
      >
        <Input className="h-12" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <Input className="h-12" placeholder="Username" autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
        <Input className="num h-12" placeholder="PIN (6-8 digits)" inputMode="numeric" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })} required />
        <div className="flex flex-wrap items-center gap-3">
          {ROLES.map((r) => (
            <label key={r} className="flex items-center gap-1 text-sm"><Checkbox checked={form.roles.includes(r)} onCheckedChange={() => setForm({ ...form, roles: toggle(form.roles, r) })} />{r}</label>
          ))}
        </div>
        <Button className="h-12" type="submit">Add user</Button>
      </form>
      <div className="space-y-2">
        {data.map((u: any) => (
          <div key={u.id} className={`flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 ${u.active ? "" : "opacity-50"}`}>
            <div className="min-w-40 flex-1"><div className="font-bold">{u.name}</div><div className="text-sm text-muted-foreground">@{u.username}</div></div>
            <div className="flex flex-wrap gap-3">
              {ROLES.map((r) => (
                <label key={r} className="flex items-center gap-1 text-sm">
                  <Checkbox checked={u.roles.includes(r)} onCheckedChange={async () => {
                    try { await update({ data: { id: u.id, roles: toggle(u.roles, r) } }); refresh(); } catch (e) { toast.error(errMsg(e)); }
                  }} />{r}
                </label>
              ))}
            </div>
            <Button variant="outline" onClick={async () => {
              const pin = prompt("New PIN (6-8 digits)");
              if (!pin) return;
              try { await update({ data: { id: u.id, pin } }); toast.success("PIN reset"); } catch (e) { toast.error(errMsg(e)); }
            }}>Reset PIN</Button>
            <Button variant={u.active ? "destructive" : "default"} onClick={async () => {
              try { await update({ data: { id: u.id, active: !u.active } }); refresh(); } catch (e) { toast.error(errMsg(e)); }
            }}>{u.active ? "Deactivate" : "Reactivate"}</Button>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
