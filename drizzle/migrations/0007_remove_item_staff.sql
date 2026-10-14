CREATE OR REPLACE FUNCTION public.remove_item(p_item uuid, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare it record; v_tray text; v_huids text; v_status text;
begin
  if not (public.is_mgr() or public.has_role(auth.uid(), 'staff')) then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'Reason required'; end if;
  select * into it from public.items where id=p_item and deleted_at is null;
  if not found then raise exception 'Item not found'; end if;
  if it.ser_no is not null then raise exception 'Item has a tag number — unseal first'; end if;
  select status::text into v_status from public.sublots where id=it.sublot_id;
  if v_status in ('sealed','exported','closed') then raise exception 'Sublot sealed'; end if;
  if not public.is_mgr() and v_status not in ('issued','loading','weighing') then raise exception 'Sublot is locked — call manager'; end if;
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