ALTER TABLE public.sublot_targets RENAME COLUMN declared_pcs TO declared_pieces;
ALTER TABLE public.sublot_targets RENAME COLUMN adjust_pcs TO adjust_pieces;
ALTER TABLE public.sublot_targets ADD COLUMN declared_tags integer, ADD COLUMN adjust_tags integer NOT NULL DEFAULT 0;
UPDATE public.sublot_targets t SET declared_tags = ceil(t.declared_pieces::numeric / greatest(pt.default_pcs,1))
  FROM public.sublots s JOIN public.product_types pt ON pt.id = s.product_type_id WHERE s.id = t.sublot_id;
UPDATE public.sublot_targets SET declared_tags = declared_pieces WHERE declared_tags IS NULL;
ALTER TABLE public.sublot_targets ALTER COLUMN declared_tags SET NOT NULL;
ALTER TABLE public.reconciliations ADD COLUMN entered_tags integer, ADD COLUMN target_tags integer;

CREATE OR REPLACE FUNCTION public.close_sublot(p_sublot uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare t record; v_tags int; v_pcs int; v_net numeric; v_tol numeric; v_rem int; v_open int; v_pass boolean; v_tt int; v_tp int; v_tn numeric;
begin
  perform public._require_worker(); perform public._require_editable(p_sublot);
  select count(*) into v_open from public.tray_sessions where sublot_id=p_sublot and status in ('empty','loaded');
  if v_open > 0 then raise exception 'Close every tray first'; end if;
  select * into t from public.sublot_targets where sublot_id=p_sublot;
  if not found then raise exception 'Sublot has no targets'; end if;
  select count(*), coalesce(sum(pcs),0), coalesce(sum(net_weight),0) into v_tags, v_pcs, v_net from public.items where sublot_id=p_sublot and deleted_at is null;
  select count(*) into v_rem from public.huid_pool where sublot_id=p_sublot and deleted_at is null and assigned_item_id is null;
  v_tt := t.declared_tags + t.adjust_tags; v_tp := t.declared_pieces + t.adjust_pieces; v_tn := t.declared_net_weight + t.adjust_net_weight;
  select coalesce((value #>> '{}')::numeric, 0.05) into v_tol from public.settings where key='recon_tolerance_per_10';
  v_tol := coalesce(v_tol,0.05) * greatest(1, ceil(v_tp/10.0));
  v_pass := v_tags = v_tt and v_pcs = v_tp and abs(v_net - v_tn) <= v_tol and v_rem = 0;
  insert into public.reconciliations(sublot_id, passed, entered_tags, target_tags, entered_pcs, target_pcs, entered_net, target_net, tolerance, huids_remaining)
    values (p_sublot, v_pass, v_tags, v_tt, v_pcs, v_tp, v_net, v_tn, v_tol, v_rem);
  if v_pass then update public.sublots set status='photography', halt_reason=null where id=p_sublot;
  else update public.sublots set status='halted', halt_reason='reconciliation_failed' where id=p_sublot; end if;
  return v_pass;
end $function$;

CREATE OR REPLACE FUNCTION public.remove_item(p_item uuid, p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare it record;
begin
  if not public.is_mgr() then raise exception 'Manager only'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'Reason required'; end if;
  select * into it from public.items where id=p_item and deleted_at is null;
  if not found then raise exception 'Item not found'; end if;
  if (select status from public.sublots where id=it.sublot_id) in ('sealed','exported','closed') then raise exception 'Sublot sealed'; end if;
  perform public.unassign_item_huids(p_item);
  update public.sublot_targets set adjust_tags = adjust_tags - 1, adjust_pieces = adjust_pieces - it.pcs, adjust_net_weight = adjust_net_weight - coalesce(it.net_weight,0)
    where sublot_id = it.sublot_id;
  update public.items set deleted_at=now(), deleted_by=auth.uid(), delete_reason=p_reason, hold_flag=null where id=p_item;
  insert into public.hold_events(item_id, action, note) values (p_item, 'removed', p_reason);
end $function$;