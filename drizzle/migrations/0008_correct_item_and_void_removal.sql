CREATE TABLE public.item_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.items(id),
  sublot_id uuid NOT NULL REFERENCES public.sublots(id),
  tray_code text, compartment_no integer,
  gross_weight numeric, less_weight numeric, net_weight numeric,
  pcs integer NOT NULL, huids text,
  reason text NOT NULL,
  corrected_by uuid NOT NULL DEFAULT auth.uid(),
  corrected_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.item_corrections TO authenticated;
GRANT ALL ON public.item_corrections TO service_role;
ALTER TABLE public.item_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mgr/aud read corrections" ON public.item_corrections FOR SELECT TO authenticated USING (public.is_mgr_or_aud());
CREATE TRIGGER item_corrections_immutable BEFORE UPDATE OR DELETE ON public.item_corrections FOR EACH ROW EXECUTE FUNCTION public._block_removal_edits();

CREATE TABLE public.removal_voids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  removal_id uuid NOT NULL UNIQUE REFERENCES public.item_removals(id),
  sublot_id uuid NOT NULL REFERENCES public.sublots(id),
  reason text NOT NULL,
  voided_by uuid NOT NULL DEFAULT auth.uid(),
  voided_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.removal_voids TO authenticated;
GRANT ALL ON public.removal_voids TO service_role;
ALTER TABLE public.removal_voids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mgr/aud read voids" ON public.removal_voids FOR SELECT TO authenticated USING (public.is_mgr_or_aud());
CREATE TRIGGER removal_voids_immutable BEFORE UPDATE OR DELETE ON public.removal_voids FOR EACH ROW EXECUTE FUNCTION public._block_removal_edits();

CREATE OR REPLACE FUNCTION public.correct_item(p_item uuid, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare it record; v_tray text; v_huids text; v_status text;
begin
  perform public._require_worker();
  if coalesce(trim(p_reason),'')='' then raise exception 'Reason required'; end if;
  select * into it from public.items where id=p_item and deleted_at is null;
  if not found then raise exception 'Item not found'; end if;
  if it.ser_no is not null then raise exception 'Item has a tag number — unseal first'; end if;
  select status::text into v_status from public.sublots where id=it.sublot_id;
  if v_status in ('sealed','photography','ready_to_export','exported','closed') then raise exception 'Sublot sealed'; end if;
  if not public.is_mgr() and v_status not in ('issued','loading','weighing') then raise exception 'Sublot is locked — call manager'; end if;
  select t.tray_code into v_tray from public.tray_sessions s join public.trays t on t.id=s.tray_id where s.id=it.tray_session_id;
  select string_agg(p.huid, ',' order by h.position) into v_huids from public.item_huids h join public.huid_pool p on p.id=h.huid_pool_id where h.item_id=p_item and h.removed_at is null;
  insert into public.item_corrections(item_id, sublot_id, tray_code, compartment_no, gross_weight, less_weight, net_weight, pcs, huids, reason, corrected_by)
    values (p_item, it.sublot_id, v_tray, it.compartment_no, it.gross_weight, it.less_weight, it.net_weight, it.pcs, v_huids, trim(p_reason), auth.uid());
  perform public.unassign_item_huids(p_item);
  update public.items set deleted_at=now(), deleted_by=auth.uid(), delete_reason='Marked in error: '||trim(p_reason), hold_flag=null where id=p_item;
  insert into public.hold_events(item_id, action, note) values (p_item, 'corrected', trim(p_reason));
end $function$;

CREATE OR REPLACE FUNCTION public.remove_item(p_item uuid, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare it record; v_tray text; v_huids text; v_status text;
begin
  if not public.is_mgr() then raise exception 'Manager only'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'Reason required'; end if;
  select * into it from public.items where id=p_item and deleted_at is null;
  if not found then raise exception 'Item not found'; end if;
  if it.ser_no is not null then raise exception 'Item has a tag number — unseal first'; end if;
  select status::text into v_status from public.sublots where id=it.sublot_id;
  if v_status in ('sealed','exported','closed') then raise exception 'Sublot sealed'; end if;
  select t.tray_code into v_tray from public.tray_sessions s join public.trays t on t.id=s.tray_id where s.id=it.tray_session_id;
  select string_agg(p.huid, ',' order by h.position) into v_huids from public.item_huids h join public.huid_pool p on p.id=h.huid_pool_id where h.item_id=p_item and h.removed_at is null;
  insert into public.item_removals(item_id, sublot_id, tray_code, compartment_no, gross_weight, less_weight, net_weight, pcs, huids, hold_flag, reason, removed_by)
    values (p_item, it.sublot_id, v_tray, it.compartment_no, it.gross_weight, it.less_weight, it.net_weight, it.pcs, v_huids, it.hold_flag::text, trim(p_reason), auth.uid());
  perform public.unassign_item_huids(p_item);
  update public.sublot_targets set removed_tags = removed_tags + 1, removed_pieces = removed_pieces + it.pcs,
    removed_net_weight = removed_net_weight + coalesce(it.net_weight,0), updated_by = auth.uid(), updated_at = now()
    where sublot_id = it.sublot_id;
  update public.items set deleted_at=now(), deleted_by=auth.uid(), delete_reason=p_reason, hold_flag=null where id=p_item;
  insert into public.hold_events(item_id, action, note) values (p_item, 'removed', p_reason);
end $function$;

CREATE OR REPLACE FUNCTION public.void_removal(p_removal uuid, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare r record; v_status text;
begin
  if not public.is_mgr() then raise exception 'Manager only'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'Reason required'; end if;
  select * into r from public.item_removals where id=p_removal;
  if not found then raise exception 'Removal not found'; end if;
  if exists (select 1 from public.removal_voids where removal_id=p_removal) then raise exception 'Already voided'; end if;
  select status::text into v_status from public.sublots where id=r.sublot_id;
  if v_status in ('sealed','photography','ready_to_export','exported','closed') then raise exception 'Sublot sealed — unseal first'; end if;
  insert into public.removal_voids(removal_id, sublot_id, reason, voided_by) values (p_removal, r.sublot_id, trim(p_reason), auth.uid());
  update public.sublot_targets set removed_tags = removed_tags - 1, removed_pieces = removed_pieces - r.pcs,
    removed_net_weight = removed_net_weight - coalesce(r.net_weight,0), updated_by = auth.uid(), updated_at = now()
    where sublot_id = r.sublot_id;
end $function$;

REVOKE ALL ON FUNCTION public.correct_item(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.void_removal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_item(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_removal(uuid, text) TO authenticated;