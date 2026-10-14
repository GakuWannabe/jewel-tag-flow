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
    refs: [{ table: "lots", col: "branch_id", label: "lots" }],
    cols: [{ key: "branch_code", label: "Code", required: true, example: "W" }, { key: "branch_name", label: "Name", required: true, example: "BZ" }, { key: "active", label: "Active", type: "bool" }],
    transform: (r) => ({ ...r, branch_code: r.branch_code ? String(r.branch_code).toUpperCase() : r.branch_code }) },
  { table: "vendors", title: "Vendors", conflictKey: "code", order: "code",
    refs: [{ table: "sublots", col: "vendor_id", label: "sublots" }, { table: "lots", col: "vendor_id", label: "lots" }],
    cols: [{ key: "code", label: "Code", required: true, example: "V001" }, { key: "name", label: "Name", required: true, example: "Example Vendor" }, { key: "active", label: "Active", type: "bool" }] },
  { table: "product_types", title: "Product types", conflictKey: "branch_id,base_code", order: "base_code",
    select: "*, branches(branch_code)", filterCol: "branch_code",
    refs: [{ table: "sublots", col: "product_type_id", label: "sublots" }],
    cols: [{ key: "branch_code", label: "Branch", required: true, example: "W", lookup: { table: "branches", match: "branch_code", fk: "branch_id", rel: "branches" } },
      { key: "base_code", label: "Base code", required: true, example: "KC" }, { key: "name", label: "Name", required: true, example: "Bangle" },
      { key: "allowed_pcs", label: "Allowed pcs", type: "intlist", required: true, example: "2,4,6" }, { key: "active", label: "Active", type: "bool" }],
    transform: (r) => ({ ...r, base_code: r.base_code ? String(r.base_code).toUpperCase() : r.base_code }) },
  { table: "purities", title: "Purities", conflictKey: "purity_label", order: "purity_label",
    refs: [{ table: "sublots", col: "purity_id", label: "sublots" }, { table: "lots", col: "purity_id", label: "lots" }],
    cols: [{ key: "melting", label: "Melting", type: "number", required: true, example: "91.66" }, { key: "purity_label", label: "Purity label", required: true, example: "916" }, { key: "metal", label: "Metal", required: true, example: "GOLD" }, { key: "active", label: "Active", type: "bool" }] },
  { table: "trays", title: "Trays", conflictKey: "tray_code", order: "tray_code",
    refs: [{ table: "tray_sessions", col: "tray_id", label: "tray sessions" }],
    duplicate: ["tray_type", "rows", "columns"],
    cols: [{ key: "tray_code", label: "Letter", required: true, example: "C" }, { key: "tray_type", label: "Type", required: true, example: "SMALL_18" }, { key: "rows", label: "Rows", type: "number", required: true, example: "6" }, { key: "columns", label: "Columns", type: "number", required: true, example: "3" }, { key: "active", label: "Active", type: "bool" }],
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
