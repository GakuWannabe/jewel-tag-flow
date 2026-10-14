-- 1. Product types per branch
ALTER TABLE public.product_types ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
UPDATE public.product_types SET branch_id = (SELECT id FROM public.branches WHERE branch_code = 'W') WHERE branch_id IS NULL;
ALTER TABLE public.product_types ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE public.product_types DROP CONSTRAINT IF EXISTS product_types_base_code_key;
ALTER TABLE public.product_types ADD CONSTRAINT product_types_branch_base_code_key UNIQUE (branch_id, base_code);

-- 2. Variable pieces per tag
ALTER TABLE public.product_types ADD COLUMN IF NOT EXISTS allowed_pcs integer[] NOT NULL DEFAULT '{1}';
UPDATE public.product_types SET allowed_pcs = ARRAY[default_pcs];
ALTER TABLE public.product_types ADD CONSTRAINT product_types_allowed_pcs_check
  CHECK (array_length(allowed_pcs, 1) >= 1 AND 1 <= ALL(allowed_pcs));
ALTER TABLE public.product_types DROP CONSTRAINT IF EXISTS product_types_default_pcs_check;
ALTER TABLE public.product_types DROP CONSTRAINT IF EXISTS product_types_huid_pieces_per_tag_check;
ALTER TABLE public.product_types ADD CONSTRAINT product_types_default_pcs_min CHECK (default_pcs >= 1);
COMMENT ON COLUMN public.product_types.huid_pieces_per_tag IS 'DEPRECATED: HUID count per tag is items.pcs; kept in sync with default_pcs by trigger';
COMMENT ON COLUMN public.product_types.default_pcs IS 'Derived: always allowed_pcs[1], maintained by trigger';

CREATE OR REPLACE FUNCTION public._product_types_sync_pcs()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
begin
  new.default_pcs := new.allowed_pcs[1];
  new.huid_pieces_per_tag := new.allowed_pcs[1];
  return new;
end $$;
DROP TRIGGER IF EXISTS product_types_sync_pcs ON public.product_types;
CREATE TRIGGER product_types_sync_pcs BEFORE INSERT OR UPDATE ON public.product_types
  FOR EACH ROW EXECUTE FUNCTION public._product_types_sync_pcs();

-- 3. Real deletes of master data (FKs still block referenced rows)
GRANT DELETE ON public.branches, public.vendors, public.product_types, public.purities, public.trays TO authenticated;
CREATE POLICY "manager deletes" ON public.branches FOR DELETE TO authenticated USING (public.is_mgr());
CREATE POLICY "manager deletes" ON public.vendors FOR DELETE TO authenticated USING (public.is_mgr());
CREATE POLICY "manager deletes" ON public.product_types FOR DELETE TO authenticated USING (public.is_mgr());
CREATE POLICY "manager deletes" ON public.purities FOR DELETE TO authenticated USING (public.is_mgr());
CREATE POLICY "manager deletes" ON public.trays FOR DELETE TO authenticated USING (public.is_mgr());