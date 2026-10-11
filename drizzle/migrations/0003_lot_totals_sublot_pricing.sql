ALTER TABLE public.sublots ADD COLUMN vendor_id uuid REFERENCES public.vendors(id);
ALTER TABLE public.sublots ADD COLUMN purity_id uuid REFERENCES public.purities(id);
ALTER TABLE public.sublots ADD COLUMN melting numeric;
ALTER TABLE public.sublots ADD COLUMN wastage_pct numeric;
ALTER TABLE public.sublots ADD COLUMN making_value numeric;
ALTER TABLE public.sublots ADD COLUMN making_type making_type;

UPDATE public.sublots s SET vendor_id=l.vendor_id, purity_id=l.purity_id, melting=l.melting, wastage_pct=l.wastage_pct, making_value=l.making_value, making_type=l.making_type
FROM public.lots l WHERE l.id=s.lot_id AND s.vendor_id IS NULL;

ALTER TABLE public.lots ALTER COLUMN vendor_id DROP NOT NULL;
ALTER TABLE public.lots ALTER COLUMN purity_id DROP NOT NULL;
ALTER TABLE public.lots ALTER COLUMN melting DROP NOT NULL;
ALTER TABLE public.lots ALTER COLUMN wastage_pct DROP NOT NULL;
ALTER TABLE public.lots ALTER COLUMN making_value DROP NOT NULL;
ALTER TABLE public.lots ALTER COLUMN making_type DROP NOT NULL;
COMMENT ON COLUMN public.lots.vendor_id IS 'DEPRECATED: moved to sublots.vendor_id';
COMMENT ON COLUMN public.lots.purity_id IS 'DEPRECATED: moved to sublots.purity_id';
COMMENT ON COLUMN public.lots.melting IS 'DEPRECATED: moved to sublots.melting';
COMMENT ON COLUMN public.lots.wastage_pct IS 'DEPRECATED: moved to sublots.wastage_pct';
COMMENT ON COLUMN public.lots.making_value IS 'DEPRECATED: moved to sublots.making_value';
COMMENT ON COLUMN public.lots.making_type IS 'DEPRECATED: moved to sublots.making_type';

-- Lot-level declared totals: manager/auditor only (staff must never see declared weights/pieces)
CREATE TABLE public.lot_targets (
  lot_id uuid PRIMARY KEY REFERENCES public.lots(id) ON DELETE CASCADE,
  total_gross_weight numeric NOT NULL,
  total_net_weight numeric NOT NULL,
  total_pcs integer NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.lot_targets TO authenticated;
GRANT ALL ON public.lot_targets TO service_role;
ALTER TABLE public.lot_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mgr/aud read" ON public.lot_targets FOR SELECT TO authenticated USING (public.is_mgr_or_aud());
CREATE POLICY "mgr insert" ON public.lot_targets FOR INSERT TO authenticated WITH CHECK (public.is_mgr());
CREATE POLICY "mgr update" ON public.lot_targets FOR UPDATE TO authenticated USING (public.is_mgr()) WITH CHECK (public.is_mgr());