ALTER TABLE public.sublot_targets RENAME COLUMN adjust_tags TO removed_tags;
ALTER TABLE public.sublot_targets RENAME COLUMN adjust_pieces TO removed_pieces;
ALTER TABLE public.sublot_targets RENAME COLUMN adjust_net_weight TO removed_net_weight;
UPDATE public.sublot_targets SET removed_tags = abs(removed_tags), removed_pieces = abs(removed_pieces), removed_net_weight = abs(removed_net_weight);

-- declared totals are permanent: no direct updates, removals only via remove_item
REVOKE UPDATE ON public.sublot_targets FROM authenticated;
DROP POLICY IF EXISTS "mgr upd targets" ON public.sublot_targets;

CREATE TABLE public.item_removals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.items(id),
  sublot_id uuid NOT NULL REFERENCES public.sublots(id),
  tray_code text,
  compartment_no integer,
  gross_weight numeric(10,3),
  less_weight numeric(10,3),
  net_weight numeric(10,3),
  pcs integer NOT NULL,
  huids text,
  hold_flag text,
  reason text NOT NULL,
  removed_by uuid NOT NULL,
  removed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.item_removals TO authenticated;
GRANT ALL ON public.item_removals TO service_role;
ALTER TABLE public.item_removals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mgr/aud read removals" ON public.item_removals FOR SELECT TO authenticated USING (public.is_mgr_or_aud());

CREATE OR REPLACE FUNCTION public._block_removal_edits() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
begin raise exception 'Removal log is immutable'; end $$;
CREATE TRIGGER item_removals_immutable BEFORE UPDATE OR DELETE ON public.item_removals FOR EACH ROW EXECUTE FUNCTION public._block_removal_edits();

CREATE OR REPLACE FUNCTION public.remove_item(p_item uuid, p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare it record; v_tray text; v_huids text;
begin
  if not public.is_mgr() then raise exception 'Manager only'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'Reason required'; end if;
  select * into it from public.items where id=p_item and deleted_at is null;
  if not found then raise exception 'Item not found'; end if;
  if (select status from public.sublots where id=it.sublot_id) in ('sealed','exported','closed') then raise exception 'Sublot sealed'; end if;
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
  v_tt := t.declared_tags - t.removed_tags; v_tp := t.declared_pieces - t.removed_pieces; v_tn := t.declared_net_weight - t.removed_net_weight;
  select coalesce((value #>> '{}')::numeric, 0.05) into v_tol from public.settings where key='recon_tolerance_per_10';
  -- tolerance is based on the ORIGINAL declared pieces, never tags
  v_tol := coalesce(v_tol,0.05) * greatest(1, ceil(t.declared_pieces/10.0));
  v_pass := v_tags = v_tt and v_pcs = v_tp and abs(v_net - v_tn) <= v_tol and v_rem = 0;
  insert into public.reconciliations(sublot_id, passed, entered_tags, target_tags, entered_pcs, target_pcs, entered_net, target_net, tolerance, huids_remaining)
    values (p_sublot, v_pass, v_tags, v_tt, v_pcs, v_tp, v_net, v_tn, v_tol, v_rem);
  if v_pass then update public.sublots set status='photography', halt_reason=null where id=p_sublot;
  else update public.sublots set status='halted', halt_reason='reconciliation_failed' where id=p_sublot; end if;
  return v_pass;
end $function$;