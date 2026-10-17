-- Fix create_coins_sublot: net_weight is GENERATED ALWAYS AS (gross_weight - less_weight) STORED
-- and can never be inserted into; drop it from the column and SELECT lists.
CREATE OR REPLACE FUNCTION public.create_coins_sublot(p_lot uuid, p_product_type uuid, p_qty integer, p_weight numeric,
  p_vendor uuid, p_purity uuid, p_melting numeric, p_wastage numeric, p_making_value numeric, p_making_type making_type)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_no int; bc text; bcode text;
BEGIN
  IF NOT public.is_mgr() THEN RAISE EXCEPTION 'managers only'; END IF;
  IF p_qty < 1 OR p_weight <= 0 THEN RAISE EXCEPTION 'Quantity and weight must be positive'; END IF;
  SELECT b.branch_code INTO bc FROM lots l JOIN branches b ON b.id = l.branch_id WHERE l.id = p_lot;
  SELECT base_code INTO bcode FROM product_types WHERE id = p_product_type;
  SELECT COALESCE(max(sublot_no), 0) + 1 INTO v_no FROM sublots WHERE lot_id = p_lot;
  INSERT INTO sublots (lot_id, sublot_no, product_type_id, status, lot_type, vendor_id, purity_id, melting, wastage_pct, making_value, making_type, sealed_at, sealed_by)
  VALUES (p_lot, v_no, p_product_type, 'sealed', 'coins', p_vendor, p_purity, p_melting, p_wastage, p_making_value, p_making_type, now(), auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO sublot_targets (sublot_id, declared_tags, declared_pieces, declared_net_weight)
  VALUES (v_id, p_qty, p_qty, p_qty * p_weight);
  INSERT INTO items (tray_session_id, compartment_no, sublot_id, sequence, gross_weight, less_weight, pcs, compcode, type, ic, weighed_by, weighed_at)
  SELECT NULL, g, v_id, g, p_weight, 0, 1, 'A', bc, bc || bcode, auth.uid(), now()
  FROM generate_series(1, p_qty) AS g;
  RETURN v_id;
END $$;

-- Coins have no tray: items may exist without a tray session.
ALTER TABLE public.items ALTER COLUMN tray_session_id DROP NOT NULL;
