import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { MasterTable, type MasterConfig } from "@/components/MasterTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/manager/master")({
  head: () => ({ meta: [{ title: "Master data — Tagging Line" }, { name: "description", content: "Branches, vendors, product types, purities and trays." }] }),
  component: Master,
});

const CONFIGS: MasterConfig[] = [
  { table: "branches", title: "Branches", conflictKey: "branch_code", order: "branch_code",
    cols: [{ key: "branch_code", label: "Code" }, { key: "branch_name", label: "Name" }, { key: "active", label: "Active", type: "bool" }],
    transform: (r) => ({ ...r, branch_code: r.branch_code ? String(r.branch_code).toUpperCase() : r.branch_code }) },
  { table: "vendors", title: "Vendors", conflictKey: "code", order: "code",
    cols: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "active", label: "Active", type: "bool" }] },
  { table: "product_types", title: "Product types", conflictKey: "base_code", order: "base_code",
    cols: [{ key: "base_code", label: "Base code" }, { key: "name", label: "Name" }, { key: "default_pcs", label: "Default pcs", type: "number" }, { key: "huid_pieces_per_tag", label: "HUID/tag", type: "number" }, { key: "active", label: "Active", type: "bool" }],
    transform: (r) => ({ ...r, base_code: r.base_code ? String(r.base_code).toUpperCase() : r.base_code, ...(r.default_pcs != null ? { huid_pieces_per_tag: r.huid_pieces_per_tag ?? r.default_pcs } : {}) }) },
  { table: "purities", title: "Purities", conflictKey: "purity_label", order: "purity_label",
    cols: [{ key: "melting", label: "Melting", type: "number" }, { key: "purity_label", label: "Purity label" }, { key: "metal", label: "Metal" }, { key: "active", label: "Active", type: "bool" }] },
  { table: "trays", title: "Trays", conflictKey: "tray_code", order: "tray_code",
    cols: [{ key: "tray_code", label: "Letter" }, { key: "tray_type", label: "Type" }, { key: "rows", label: "Rows", type: "number" }, { key: "columns", label: "Columns", type: "number" }, { key: "active", label: "Active", type: "bool" }],
    transform: (r) => ({ ...r, ...(r.rows != null && r.columns != null ? { compartment_count: Number(r.rows) * Number(r.columns) } : {}) }) },
];

function Master() {
  const { has } = useAuth();
  const canEdit = has("manager");
  return (
    <AppShell title="Master data" back="/app">
      <Tabs defaultValue="branches">
        <TabsList className="mb-3 h-auto flex-wrap">
          {CONFIGS.map((c) => <TabsTrigger key={c.table} value={c.table} className="h-10 px-4">{c.title}</TabsTrigger>)}
        </TabsList>
        {CONFIGS.map((c) => (
          <TabsContent key={c.table} value={c.table}>
            {c.table === "trays" && <p className="mb-2 text-sm text-muted-foreground">Compartment count is rows × columns. Compartment 1 is top-left with the tray letter facing you; numbering runs row by row.</p>}
            <MasterTable cfg={c} canEdit={canEdit} />
          </TabsContent>
        ))}
      </Tabs>
    </AppShell>
  );
}
