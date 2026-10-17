
-- Tag numbers are no longer imported; the bot reports the ERP-issued number per item.
DROP FUNCTION IF EXISTS public.import_tag_slots(uuid, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.import_tag_numbers(uuid, integer[]);
DROP FUNCTION IF EXISTS public.clear_tag_slots(uuid, integer);
COMMENT ON TABLE public.tag_slots IS 'DEPRECATED: tag numbers are no longer imported; the bot reports ser_no per item. Table retained, unused by the app.';
COMMENT ON COLUMN public.sublots.tags_continued IS 'DEPRECATED: tag slots removed; the bot reports ser_no per item';

-- Coins sublots have no trays: items may exist without a tray session.
ALTER TABLE public.items ALTER COLUMN tray_session_id DROP NOT NULL;

ALTER TABLE public.sublots ADD COLUMN lot_type text NOT NULL DEFAULT 'tray';
ALTER TABLE public.sublots ADD CONSTRAINT sublots_lot_type_check CHECK (lot_type IN ('tray','coins'));
ALTER TABLE public.lots ADD COLUMN closed_at timestamptz;

-- items.ser_no is written only by the bot result handler (service role).
CREATE OR REPLACE FUNCTION public._guard_ser_no() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ser_no IS DISTINCT FROM OLD.ser_no AND NOT public._is_service() THEN
    RAISE EXCEPTION 'ser_no is written only by the tagging bot';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER _ser_no_guard BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public._guard_ser_no();

-- Manager variance overrides: immutable audit rows.
CREATE TABLE public.variance_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sublot_id uuid REFERENCES public.sublots(id) ON DELETE SET NULL,
  overridden_by uuid DEFAULT auth.uid(),
  reason text NOT NULL CHECK (length(trim(reason)) >= 10),
  declared_snapshot jsonb,
  actual_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.variance_overrides TO authenticated;
GRANT ALL ON public.variance_overrides TO service_role;
ALTER TABLE public.variance_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY variance_overrides_mgr ON public.variance_overrides FOR ALL TO authenticated
  USING (public.is_mgr()) WITH CHECK (public.is_mgr());
CREATE TRIGGER _no_edit_variance_overrides BEFORE UPDATE OR DELETE ON public.variance_overrides
  FOR EACH ROW EXECUTE FUNCTION public._block_removal_edits();

-- Seal no longer assigns tag slots: sequence + compcode/type/ic only; ser_no stays null until the bot reports it.
CREATE OR REPLACE FUNCTION public._do_seal(p_sublot uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int; bc text; bcode text;
BEGIN
  SELECT b.branch_code INTO bc FROM sublots s JOIN lots l ON l.id = s.lot_id JOIN branches b ON b.id = l.branch_id WHERE s.id = p_sublot;
  SELECT pt.base_code INTO bcode FROM sublots s JOIN product_types pt ON pt.id = s.product_type_id WHERE s.id = p_sublot;
  WITH ordered AS (
    SELECT i.id, row_number() OVER (ORDER BY COALESCE(t.tray_code, ''), i.compartment_no) AS seq
    FROM items i
    LEFT JOIN tray_sessions ts ON ts.id = i.tray_session_id
    LEFT JOIN trays t ON t.id = ts.tray_id
    WHERE i.sublot_id = p_sublot AND i.deleted_at IS NULL
  )
  UPDATE items i SET sequence = o.seq, compcode = 'A', type = bc, ic = bc || bcode, ser_no = NULL, photo_filename = NULL, updated_at = now()
  FROM ordered o WHERE i.id = o.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE sublots SET status = 'sealed', sealed_at = now(), sealed_by = auth.uid(), updated_at = now() WHERE id = p_sublot;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public._seal_blocker(p_sublot uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE h int; pf int; bad int; ok boolean;
BEGIN
  SELECT count(*) INTO h FROM items WHERE sublot_id = p_sublot AND deleted_at IS NULL AND hold_flag IS NOT NULL;
  IF h > 0 THEN RETURN 'Open holds: ' || h; END IF;
  SELECT count(*) INTO pf FROM huid_pool WHERE sublot_id = p_sublot AND deleted_at IS NULL AND assigned_item_id IS NULL;
  IF pf > 0 THEN RETURN 'HUIDs not assigned: ' || pf; END IF;
  SELECT count(*) INTO bad FROM items i WHERE i.sublot_id = p_sublot AND i.deleted_at IS NULL
    AND (SELECT count(*) FROM item_huids ih WHERE ih.item_id = i.id AND ih.removed_at IS NULL) <> i.pcs;
  IF bad > 0 THEN RETURN 'Items missing HUIDs: ' || bad; END IF;
  SELECT EXISTS (SELECT 1 FROM reconciliations WHERE sublot_id = p_sublot AND passed) INTO ok;
  IF NOT ok THEN RETURN 'Reconciliation has not passed'; END IF;
  RETURN NULL;
END $$;

-- Reconciliation: on PASS, seal inline (no tag-slot check); on FAIL, halt as before.
CREATE OR REPLACE FUNCTION public.close_sublot(p_sublot uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t sublot_targets; et int; ep int; en numeric; hr int; tol numeric; pass boolean; s_status sublot_status;
BEGIN
  SELECT status INTO s_status FROM sublots WHERE id = p_sublot AND deleted_at IS NULL;
  IF s_status IS NULL THEN RAISE EXCEPTION 'Sublot not found'; END IF;
  IF s_status NOT IN ('issued','loading','weighing','halted') THEN RAISE EXCEPTION 'Sublot is % — cannot close', s_status; END IF;
  SELECT * INTO t FROM sublot_targets WHERE sublot_id = p_sublot;
  SELECT count(*), COALESCE(sum(i.pcs),0), COALESCE(sum(i.net_weight),0) INTO et, ep, en
    FROM items i WHERE i.sublot_id = p_sublot AND i.deleted_at IS NULL;
  SELECT count(*) INTO hr FROM huid_pool WHERE sublot_id = p_sublot AND deleted_at IS NULL AND assigned_item_id IS NULL;
  tol := (COALESCE(t.declared_pieces,0) / 10.0) * 0.050;
  pass := et = (t.declared_tags - t.removed_tags)
      AND ep = (t.declared_pieces - t.removed_pieces)
      AND abs(en - (t.declared_net_weight - t.removed_net_weight)) <= tol
      AND hr = 0;
  INSERT INTO reconciliations (sublot_id, passed, entered_pcs, target_pcs, entered_net, target_net, tolerance, huids_remaining, entered_tags, target_tags)
  VALUES (p_sublot, pass, ep, t.declared_pieces - t.removed_pieces, en, t.declared_net_weight - t.removed_net_weight, tol, hr, et, t.declared_tags - t.removed_tags);
  IF pass THEN
    PERFORM public._do_seal(p_sublot);
    RETURN true;
  END IF;
  UPDATE sublots SET status = 'halted', halt_reason = 'reconciliation_failed', updated_at = now() WHERE id = p_sublot;
  RETURN false;
END $$;

-- Unseal: clear bot-reported numbers and filenames; sequence stays (physical order unchanged).
CREATE OR REPLACE FUNCTION public.unseal_sublot(p_sublot uuid, p_reason text) RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s sublots; n int;
BEGIN
  IF NOT public.is_mgr() THEN RAISE EXCEPTION 'managers only'; END IF;
  IF length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'Reason required'; END IF;
  SELECT * INTO s FROM sublots WHERE id = p_sublot AND deleted_at IS NULL;
  IF s IS NULL THEN RAISE EXCEPTION 'Sublot not found'; END IF;
  IF s.status NOT IN ('sealed','photography','ready_to_export') THEN RAISE EXCEPTION 'Only a sealed sublot can be unsealed (it is %)', s.status; END IF;
  UPDATE items SET ser_no = NULL, actual_ser_no = NULL, photo_filename = NULL, updated_at = now()
    WHERE sublot_id = p_sublot AND deleted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE sublots SET status = 'ready_to_seal', sealed_at = NULL, sealed_by = NULL, halt_reason = NULL, updated_at = now() WHERE id = p_sublot;
  INSERT INTO sublot_unseals (sublot_id, reason, from_status, items, unsealed_by) VALUES (p_sublot, trim(p_reason), s.status, n, auth.uid());
  RETURN ARRAY['cleared ' || n || ' tag numbers'];
END $$;

-- Manager accepts a failed reconciliation and releases the sublot to tagging.
CREATE OR REPLACE FUNCTION public.override_variance(p_sublot uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t sublot_targets; et int; ep int; en numeric; hr int;
BEGIN
  IF NOT public.is_mgr() THEN RAISE EXCEPTION 'managers only'; END IF;
  IF length(trim(p_reason)) < 10 THEN RAISE EXCEPTION 'Reason must be at least 10 characters'; END IF;
  PERFORM 1 FROM sublots WHERE id = p_sublot AND status = 'halted' AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a halted sublot can be overridden'; END IF;
  SELECT * INTO t FROM sublot_targets WHERE sublot_id = p_sublot;
  SELECT count(*), COALESCE(sum(i.pcs),0), COALESCE(sum(i.net_weight),0) INTO et, ep, en
    FROM items i WHERE i.sublot_id = p_sublot AND i.deleted_at IS NULL;
  SELECT count(*) INTO hr FROM huid_pool WHERE sublot_id = p_sublot AND deleted_at IS NULL AND assigned_item_id IS NULL;
  INSERT INTO variance_overrides (sublot_id, reason, declared_snapshot, actual_snapshot)
  VALUES (p_sublot, trim(p_reason),
    jsonb_build_object('tags', t.declared_tags, 'pieces', t.declared_pieces, 'net_weight', t.declared_net_weight,
      'removed_tags', t.removed_tags, 'removed_pieces', t.removed_pieces, 'removed_net_weight', t.removed_net_weight),
    jsonb_build_object('tags', et, 'pieces', ep, 'net_weight', en, 'huids_remaining', hr));
  PERFORM public._do_seal(p_sublot);
END $$;

-- Auto-allocated lot numbers: next sequential per branch, safe under two managers at once.
CREATE OR REPLACE FUNCTION public.create_lot_auto(p_branch uuid, p_received date, p_notes text, p_gross numeric, p_net numeric, p_pcs integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_no text; v_id uuid;
BEGIN
  IF NOT public.is_mgr() THEN RAISE EXCEPTION 'managers only'; END IF;
  LOOP
    SELECT 'L' || (COALESCE(max(NULLIF(regexp_replace(lot_no, '^L', ''), '')::bigint), 0) + 1)::text INTO v_no
      FROM lots WHERE branch_id = p_branch AND lot_no ~ '^L?[0-9]+$';
    BEGIN
      INSERT INTO lots (lot_no, branch_id, received_date, notes) VALUES (v_no, p_branch, p_received, p_notes) RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN CONTINUE;
    END;
  END LOOP;
  INSERT INTO lot_targets (lot_id, total_gross_weight, total_net_weight, total_pcs) VALUES (v_id, p_gross, p_net, p_pcs);
  RETURN v_id;
END $$;

-- Coins sublot: identical pieces, no trays or photography; goes straight to tagging.
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
  INSERT INTO items (tray_session_id, compartment_no, sublot_id, sequence, gross_weight, less_weight, net_weight, pcs, compcode, type, ic, weighed_by, weighed_at)
  SELECT NULL, g, v_id, g, p_weight, 0, p_weight, 1, 'A', bc, bc || bcode, auth.uid(), now()
  FROM generate_series(1, p_qty) AS g;
  RETURN v_id;
END $$;
