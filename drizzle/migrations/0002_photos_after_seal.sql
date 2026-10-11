ALTER TABLE public.bot_clients ADD COLUMN kind text NOT NULL DEFAULT 'bot';
ALTER TABLE public.bot_clients ADD CONSTRAINT bot_clients_kind_check CHECK (kind IN ('bot','photo'));

ALTER TABLE public.items ADD COLUMN photo_skipped_at timestamptz;
ALTER TABLE public.items ADD COLUMN photo_skip_reason text;
ALTER TABLE public.items ADD COLUMN photo_delivered_at timestamptz;

CREATE TABLE public.photo_skips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  sublot_id uuid NOT NULL,
  sequence integer,
  reason text NOT NULL,
  device_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.photo_skips TO authenticated;
GRANT ALL ON public.photo_skips TO service_role;
ALTER TABLE public.photo_skips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mgr/aud read" ON public.photo_skips FOR SELECT TO authenticated USING (public.is_mgr_or_aud());

CREATE TABLE public.sublot_unseals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sublot_id uuid NOT NULL,
  reason text NOT NULL,
  from_status text,
  items integer,
  unsealed_by uuid DEFAULT auth.uid(),
  unsealed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sublot_unseals TO authenticated;
GRANT ALL ON public.sublot_unseals TO service_role;
ALTER TABLE public.sublot_unseals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mgr/aud read" ON public.sublot_unseals FOR SELECT TO authenticated USING (public.is_mgr_or_aud());
CREATE TRIGGER sublot_unseals_immutable BEFORE UPDATE OR DELETE ON public.sublot_unseals FOR EACH ROW EXECUTE FUNCTION public._block_removal_edits();

CREATE OR REPLACE FUNCTION public.close_sublot(p_sublot uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare t record; v_tags int; v_pcs int; v_net numeric; v_tol numeric; v_rem int; v_open int; v_pass boolean; v_tt int; v_tp int; v_tn numeric;
begin
  perform public._require_worker(); perform public._require_editable(p_sublot);
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
  if v_pass then update public.sublots set status='ready_to_seal', halt_reason=null where id=p_sublot;
  else update public.sublots set status='halted', halt_reason='reconciliation_failed' where id=p_sublot; end if;
  return v_pass;
end $$;

CREATE OR REPLACE FUNCTION public.seal_sublot(p_sublot uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare s record; v_items int; v_slots int; v_tpl text; r record; sl record; v_seq int := 0; v_name text;
begin
  if not (public.is_mgr() or public._is_service()) then raise exception 'Manager only'; end if;
  select * into s from public.sublots where id=p_sublot for update;
  if s.status <> 'ready_to_seal' then raise exception 'Sublot must be ready_to_seal (is %)', s.status; end if;
  if not exists (select 1 from public.reconciliations where sublot_id=p_sublot and passed order by created_at desc limit 1) then raise exception 'Reconciliation has not passed'; end if;
  if exists (select 1 from public.items where sublot_id=p_sublot and deleted_at is null and hold_flag is not null) then raise exception 'Open holds remain'; end if;
  if exists (select 1 from public.huid_pool where sublot_id=p_sublot and deleted_at is null and assigned_item_id is null) then raise exception 'HUID pool not empty'; end if;
  if exists (select 1 from public.items i where i.sublot_id=p_sublot and i.deleted_at is null and (select count(*) from public.item_huids h where h.item_id=i.id and h.removed_at is null) <> i.pcs) then raise exception 'Incomplete HUIDs'; end if;
  select count(*) into v_items from public.items where sublot_id=p_sublot and deleted_at is null;
  select count(*) into v_slots from public.tag_slots where sublot_id=p_sublot and superseded_at is null and assigned_item_id is null;
  if v_slots < v_items then raise exception 'Not enough tag slots (% available, % needed)', v_slots, v_items; end if;
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
  update public.sublots set status='sealed', sealed_at=now(), sealed_by=auth.uid() where id=p_sublot;
  return v_seq;
end $$;

CREATE OR REPLACE FUNCTION public.assign_photographer(p_sublot uuid, p_user uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare v_st sublot_status;
begin
  if not public.is_mgr() then raise exception 'Manager only'; end if;
  select status into v_st from public.sublots where id=p_sublot;
  if v_st not in ('sealed','photography','ready_to_export') then raise exception 'Seal the sublot first (is %)', v_st; end if;
  update public.sublots set photographer_id=p_user, status='photography', updated_by=auth.uid(), updated_at=now() where id=p_sublot;
end $$;

CREATE OR REPLACE FUNCTION public.unseal_sublot(p_sublot uuid, p_reason text)
 RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare v_st sublot_status; v_paths text[]; v_n int;
begin
  if not public.is_mgr() then raise exception 'Manager only'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'Reason required'; end if;
  select status into v_st from public.sublots where id=p_sublot for update;
  if v_st not in ('sealed','photography','ready_to_export') then raise exception 'Only sealed sublots can be unsealed (is %)', v_st; end if;
  select coalesce(array_agg(photo_url) filter (where photo_url is not null),'{}'), count(*) into v_paths, v_n from public.items where sublot_id=p_sublot and deleted_at is null;
  insert into public.sublot_unseals(sublot_id, reason, from_status, items) values (p_sublot, trim(p_reason), v_st::text, v_n);
  update public.tag_slots set assigned_item_id=null where sublot_id=p_sublot and assigned_item_id is not null;
  update public.items set sequence=null, compcode=null, type=null, ic=null, ser_no=null, photo_filename=null,
    photo_url=null, photo_matched_at=null, photo_skipped_at=null, photo_skip_reason=null, photo_delivered_at=null,
    updated_by=auth.uid(), updated_at=now() where sublot_id=p_sublot;
  update public.tray_sessions set status='weighed', station='weighed', station_since=now() where sublot_id=p_sublot and status='tagged';
  update public.sublots set status='ready_to_seal', sealed_at=null, sealed_by=null, updated_by=auth.uid(), updated_at=now() where id=p_sublot;
  return v_paths;
end $$;

CREATE OR REPLACE FUNCTION public.mark_exported(p_sublot uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
begin
  if not public.is_mgr() then raise exception 'Manager only'; end if;
  update public.sublots set status='exported' where id=p_sublot and status in ('sealed','ready_to_export');
end $$;