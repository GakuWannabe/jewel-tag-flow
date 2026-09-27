export type Role = "manager" | "staff" | "photo" | "auditor";
export type SublotStatus =
  | "draft" | "issued" | "loading" | "weighing" | "photography" | "ready_to_seal"
  | "sealed" | "exported" | "closed" | "halted";
export type HoldFlag = "damaged" | "wrong_item" | "re_photo" | "weight_disputed";

export interface Tray {
  id: string; tray_code: string; tray_type: string; rows: number; columns: number;
  compartment_count: number; active: boolean; suitable_product_types: string[];
}
export interface ProductType { id: string; base_code: string; name: string; default_pcs: number; huid_pieces_per_tag: number; active: boolean }
export interface Branch { id: string; branch_code: string; branch_name: string; active: boolean }
export interface Vendor { id: string; code: string; name: string; active: boolean }
export interface Purity { id: string; melting: number; purity_label: string; metal: string; active: boolean }

export interface Item {
  id: string; tray_session_id: string; compartment_no: number; sublot_id: string; sequence: number | null;
  gross_weight: number | null; less_weight: number; net_weight: number | null; pcs: number; narration: string | null;
  compcode: string | null; type: string | null; ic: string | null; ser_no: number | null; actual_ser_no: number | null;
  photo_filename: string | null; photo_url: string | null; source_photo_name: string | null;
  hold_flag: HoldFlag | null; hold_note: string | null; deleted_at: string | null;
  weighed_at: string | null; photo_matched_at: string | null;
}
export interface PoolRow { id: string; sublot_id: string; huid: string; piece_weight: number | null; assigned_item_id: string | null; deleted_at: string | null }

export const HOLD_LABEL: Record<HoldFlag, string> = {
  damaged: "Damaged", wrong_item: "Wrong item", re_photo: "Re-photo", weight_disputed: "Weight disputed",
};
