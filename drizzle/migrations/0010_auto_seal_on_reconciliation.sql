CREATE OR REPLACE FUNCTION public._seal_blocker(p_sublot uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_items int; v_slots int;
begin
  if exists (select 1 from public.items where sublot_id=p_sublot and deleted_at is null and hold_flag is not null) then return 'Open holds remain'; end if;
  if exists (select 1 from public.huid_pool where sublot_id=p_sublot and deleted_at is null and assigned_item_id is null) then return 'HUID pool not empty'; end if;
  if exists (select 1 from public.items i where i.sublot_id=p_sublot and i.deleted_at is null and (select count(*) from public.item_huids h where h.item_id=i.id and h.removed_at is null) <> i.pcs) then return 'Incomplete HUIDs'; end if;
  select count(*) into v_items from public.items where sublot_id=p_sublot and deleted_at is null;
  select count(*) into v_slots from public.tag_slots where sublot_id=p_sublot and superseded_at is null and assigned_item_id is null;
  if v_slots < v_items then return format('Not enough tag slots (%s available, %s needed)', v_slots, v_items); end if;
  return null;
end $$;
REVOKE ALL ON FUNCTION public._seal_blocker(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._do_seal(p_sublot uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_tpl text; r record; sl record; v_seq int := 0; v_name text;
begin
  select value #>> '{}' into v_tpl from public.settings where key='photo_name_template';
  v_tpl := coalesce(nullif(v_tpl,''), '{COMPCODE}{IC}{ser_no}.jpg');
  for r in select i.id from public.items i join public.tray_sessions ts on ts.id=i.tray_session_id join public.trays t on t.id=ts.tray_id
           where i.sublot_id=p_sublot and i.deleted_at is null
           order by t.tray_code, ts.opened_at, i.compartment_no loop
    v_seq := v_seq + 1;
    select * into sl from public.tag_slots where sublot_id=p_sublot and superseded_at is null and assigned_item_id is null order by ser_no asc limit 1 for update;
    v_name := replace(replace(replace(v_tpl,'{COMPCODE}',sl.compcode),'{IC}',sl.ic),'{ser_no}',sl.ser_no::text);
    update public.tag_slots set assigned_item_id=r.id where id=sl.id;
    update public.items set sequence=v_seq, compcode=sl.compcode, type=sl.type, ic=sl.ic, ser_no=sl.ser_no, photo_filename=v_name,
      photo_url=null, photo_matched_at=null, photo_skipped_at=null, photo_skip_reason=null, photo_delivered_at=null where id=r.id;
  end loop;
  update public.tray_sessions set status='tagged', station='tagged', station_since=now() where sublot_id=p_sublot and status <> 'cleared';
  update public.sublots set status='photography', halt_reason=null, sealed_at=now(), sealed_by=auth.uid() where id=p_sublot;
  return v_seq;
end $$;
REVOKE ALL ON FUNCTION public._do_seal(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.seal_sublot(p_sublot uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare s record; v_err text;
begin
  if not (public.is_mgr() or public._is_service()) then raise exception 'Manager only'; end if;
  select * into s from public.sublots where id=p_sublot for update;
  if s.status not in ('ready_to_seal','halted') then raise exception 'Sublot must be ready_to_seal or halted (is %)', s.status; end if;
  if not coalesce((select passed from public.reconciliations where sublot_id=p_sublot order by created_at desc limit 1), false) then raise exception 'Reconciliation has not passed'; end if;
  v_err := public._seal_blocker(p_sublot);
  if v_err is not null then raise exception '%', v_err; end if;
  return public._do_seal(p_sublot);
end $$;

CREATE OR REPLACE FUNCTION public.close_sublot(p_sublot uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare t record; v_tags int; v_pcs int; v_net numeric; v_tol numeric; v_rem int; v_open int; v_pass boolean; v_tt int; v_tp int; v_tn numeric; v_err text;
begin
  perform public._require_worker(); perform public._require_editable(p_sublot);
  perform 1 from public.sublots where id=p_sublot for update;
  select count(*) into v_open from public.tray_sessions where sublot_id=p_sublot and status in ('empty','loaded');
  if v_open > 0 then raise exception 'Close every tray first'; end if;
  select * into t from public.sublot_targets where sublot_id=p_sublot;
  if not found then raise exception 'Sublot has no targets'; end if;
  select count(*), coalesce(sum(pcs),0), coalesce(sum(net_weight),0) into v_tags, v_pcs, v_net from public.items where sublot_id=p_sublot and deleted_at is null;
  select count(*) into v_rem from public.huid_pool where sublot_id=p_sublot and deleted_at is null and assigned_item_id is null;
  v_tt := t.declared_tags - t.removed_tags; v_tp := t.declared_pieces - t.removed_pieces; v_tn := t.declared_net_weight - t.removed_net_weight;
  select coalesce((value #>> '{}')::numeric, 0.05) into v_tol from public.settings where key='recon_tolerance_per_10';
  v_tol := coalesce(v_tol,0.05) * greatest(1, ceil(t.declared_pieces/10.0));
  v_pass := v_tags = v_tt and v_pcs = v_tp and abs(v_net - v_tn) <= v_tol and v_rem = 0;
  insert into public.reconciliations(sublot_id, passed, entered_tags, target_tags, entered_pcs, target_pcs, entered_net, target_net, tolerance, huids_remaining)
    values (p_sublot, v_pass, v_tags, v_tt, v_pcs, v_tp, v_net, v_tn, v_tol, v_rem);
  if v_pass then
    v_err := public._seal_blocker(p_sublot);
    if v_err is null then perform public._do_seal(p_sublot);
    else update public.sublots set status='halted', halt_reason=v_err where id=p_sublot; end if;
  else update public.sublots set status='halted', halt_reason='reconciliation_failed' where id=p_sublot; end if;
  return v_pass;
end $$;