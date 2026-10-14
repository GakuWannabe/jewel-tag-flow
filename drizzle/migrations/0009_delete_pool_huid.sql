CREATE TABLE public.huid_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  huid_pool_id uuid NOT NULL REFERENCES public.huid_pool(id),
  sublot_id uuid NOT NULL REFERENCES public.sublots(id),
  huid text NOT NULL,
  reason text NOT NULL,
  deleted_by uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.huid_deletions TO authenticated;
GRANT ALL ON public.huid_deletions TO service_role;
ALTER TABLE public.huid_deletions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mgr/aud read huid deletions" ON public.huid_deletions FOR SELECT TO authenticated USING (public.is_mgr_or_aud());

CREATE OR REPLACE FUNCTION public.delete_pool_huid(p_huid_pool_id uuid, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare r record; v_status sublot_status;
begin
  if not public.is_mgr() then raise exception 'Managers only'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'Reason required'; end if;
  select * into r from public.huid_pool where id=p_huid_pool_id and deleted_at is null for update;
  if not found then raise exception 'HUID not found'; end if;
  if r.assigned_item_id is not null then raise exception 'HUID % is assigned to an item — correct the item or unassign its HUIDs first', r.huid; end if;
  select status into v_status from public.sublots where id=r.sublot_id;
  if v_status in ('sealed','photography','ready_to_export','exported','closed') then raise exception 'Sublot is sealed — unseal first'; end if;
  update public.huid_pool set deleted_at=now(), deleted_by=auth.uid(), delete_reason=trim(p_reason) where id=r.id;
  insert into public.huid_deletions(huid_pool_id, sublot_id, huid, reason, deleted_by)
  values (r.id, r.sublot_id, r.huid, trim(p_reason), auth.uid());
end $$;
REVOKE ALL ON FUNCTION public.delete_pool_huid(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_pool_huid(uuid, text) TO authenticated;