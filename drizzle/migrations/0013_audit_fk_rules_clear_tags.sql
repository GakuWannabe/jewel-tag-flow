-- Audit tables: allow ONLY FK pointers to be nulled (by ON DELETE SET NULL); all else stays immutable
CREATE OR REPLACE FUNCTION public._block_removal_edits() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
declare k text[] := array['item_id','sublot_id','removal_id','huid_pool_id']; o jsonb; n jsonb;
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.purge', true), '') = 'on' then return old; end if;
  if tg_op = 'UPDATE' then
    o := to_jsonb(old) - k; n := to_jsonb(new) - k;
    if o = n and not exists (select 1 from unnest(k) x where to_jsonb(new) ? x and to_jsonb(new)->>x is not null and to_jsonb(new)->>x is distinct from to_jsonb(old)->>x) then
      return new;
    end if;
  end if;
  raise exception 'Removal log is immutable';
end $$;

ALTER TABLE public.huid_deletions ALTER COLUMN huid_pool_id DROP NOT NULL, ALTER COLUMN sublot_id DROP NOT NULL;
ALTER TABLE public.item_removals ALTER COLUMN item_id DROP NOT NULL, ALTER COLUMN sublot_id DROP NOT NULL;
ALTER TABLE public.item_corrections ALTER COLUMN item_id DROP NOT NULL, ALTER COLUMN sublot_id DROP NOT NULL;
ALTER TABLE public.removal_voids ALTER COLUMN removal_id DROP NOT NULL, ALTER COLUMN sublot_id DROP NOT NULL;
ALTER TABLE public.hold_events ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE public.reconciliations ALTER COLUMN sublot_id DROP NOT NULL;
ALTER TABLE public.bot_results ALTER COLUMN sublot_id DROP NOT NULL;

-- audit pointers -> SET NULL
ALTER TABLE public.huid_deletions DROP CONSTRAINT huid_deletions_huid_pool_id_fkey, ADD CONSTRAINT huid_deletions_huid_pool_id_fkey FOREIGN KEY (huid_pool_id) REFERENCES public.huid_pool(id) ON DELETE SET NULL;
ALTER TABLE public.huid_deletions DROP CONSTRAINT huid_deletions_sublot_id_fkey, ADD CONSTRAINT huid_deletions_sublot_id_fkey FOREIGN KEY (sublot_id) REFERENCES public.sublots(id) ON DELETE SET NULL;
ALTER TABLE public.item_removals DROP CONSTRAINT item_removals_item_id_fkey, ADD CONSTRAINT item_removals_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE SET NULL;
ALTER TABLE public.item_removals DROP CONSTRAINT item_removals_sublot_id_fkey, ADD CONSTRAINT item_removals_sublot_id_fkey FOREIGN KEY (sublot_id) REFERENCES public.sublots(id) ON DELETE SET NULL;
ALTER TABLE public.item_corrections DROP CONSTRAINT item_corrections_item_id_fkey, ADD CONSTRAINT item_corrections_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE SET NULL;
ALTER TABLE public.item_corrections DROP CONSTRAINT item_corrections_sublot_id_fkey, ADD CONSTRAINT item_corrections_sublot_id_fkey FOREIGN KEY (sublot_id) REFERENCES public.sublots(id) ON DELETE SET NULL;
ALTER TABLE public.removal_voids DROP CONSTRAINT removal_voids_removal_id_fkey, ADD CONSTRAINT removal_voids_removal_id_fkey FOREIGN KEY (removal_id) REFERENCES public.item_removals(id) ON DELETE SET NULL;
ALTER TABLE public.removal_voids DROP CONSTRAINT removal_voids_sublot_id_fkey, ADD CONSTRAINT removal_voids_sublot_id_fkey FOREIGN KEY (sublot_id) REFERENCES public.sublots(id) ON DELETE SET NULL;
ALTER TABLE public.hold_events DROP CONSTRAINT hold_events_item_id_fkey, ADD CONSTRAINT hold_events_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE SET NULL;
ALTER TABLE public.station_events DROP CONSTRAINT station_events_item_id_fkey, ADD CONSTRAINT station_events_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE SET NULL;
ALTER TABLE public.station_events DROP CONSTRAINT station_events_sublot_id_fkey, ADD CONSTRAINT station_events_sublot_id_fkey FOREIGN KEY (sublot_id) REFERENCES public.sublots(id) ON DELETE SET NULL;
ALTER TABLE public.reconciliations DROP CONSTRAINT reconciliations_sublot_id_fkey, ADD CONSTRAINT reconciliations_sublot_id_fkey FOREIGN KEY (sublot_id) REFERENCES public.sublots(id) ON DELETE SET NULL;
ALTER TABLE public.bot_results DROP CONSTRAINT bot_results_sublot_id_fkey, ADD CONSTRAINT bot_results_sublot_id_fkey FOREIGN KEY (sublot_id) REFERENCES public.sublots(id) ON DELETE SET NULL;
ALTER TABLE public.huid_pool DROP CONSTRAINT huid_pool_assigned_item_id_fkey, ADD CONSTRAINT huid_pool_assigned_item_id_fkey FOREIGN KEY (assigned_item_id) REFERENCES public.items(id) ON DELETE SET NULL;
ALTER TABLE public.tag_slots DROP CONSTRAINT tag_slots_assigned_item_id_fkey, ADD CONSTRAINT tag_slots_assigned_item_id_fkey FOREIGN KEY (assigned_item_id) REFERENCES public.items(id) ON DELETE SET NULL;

-- parts of a sublot -> CASCADE
ALTER TABLE public.sublots DROP CONSTRAINT sublots_lot_id_fkey, ADD CONSTRAINT sublots_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.lots(id) ON DELETE CASCADE;
ALTER TABLE public.sublot_targets DROP CONSTRAINT sublot_targets_sublot_id_fkey, ADD CONSTRAINT sublot_targets_sublot_id_fkey FOREIGN KEY (sublot_id) REFERENCES public.sublots(id) ON DELETE CASCADE;
ALTER TABLE public.tray_sessions DROP CONSTRAINT tray_sessions_sublot_id_fkey, ADD CONSTRAINT tray_sessions_sublot_id_fkey FOREIGN KEY (sublot_id) REFERENCES public.sublots(id) ON DELETE CASCADE;
ALTER TABLE public.items DROP CONSTRAINT items_sublot_id_fkey, ADD CONSTRAINT items_sublot_id_fkey FOREIGN KEY (sublot_id) REFERENCES public.sublots(id) ON DELETE CASCADE;
ALTER TABLE public.items DROP CONSTRAINT items_tray_session_id_fkey, ADD CONSTRAINT items_tray_session_id_fkey FOREIGN KEY (tray_session_id) REFERENCES public.tray_sessions(id) ON DELETE CASCADE;
ALTER TABLE public.huid_pool DROP CONSTRAINT huid_pool_sublot_id_fkey, ADD CONSTRAINT huid_pool_sublot_id_fkey FOREIGN KEY (sublot_id) REFERENCES public.sublots(id) ON DELETE CASCADE;
ALTER TABLE public.item_huids DROP CONSTRAINT item_huids_item_id_fkey, ADD CONSTRAINT item_huids_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;
ALTER TABLE public.item_huids DROP CONSTRAINT item_huids_huid_pool_id_fkey, ADD CONSTRAINT item_huids_huid_pool_id_fkey FOREIGN KEY (huid_pool_id) REFERENCES public.huid_pool(id) ON DELETE CASCADE;
ALTER TABLE public.tag_slots DROP CONSTRAINT tag_slots_sublot_id_fkey, ADD CONSTRAINT tag_slots_sublot_id_fkey FOREIGN KEY (sublot_id) REFERENCES public.sublots(id) ON DELETE CASCADE;

-- delete_lot no longer destroys audit rows
CREATE OR REPLACE FUNCTION public.delete_lot(p_lot uuid, p_confirm text) RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_lot record; v_subs uuid[]; v_items uuid[]; v_photos text[];
begin
  if not public.is_mgr() then raise exception 'Manager only'; end if;
  if p_confirm is distinct from 'DELETE' then raise exception 'Type DELETE to confirm'; end if;
  select * into v_lot from public.lots where id=p_lot;
  if not found then raise exception 'Lot not found'; end if;
  select coalesce(array_agg(id),'{}') into v_subs from public.sublots where lot_id=p_lot;
  select coalesce(array_agg(id),'{}') into v_items from public.items where sublot_id = any(v_subs);
  select coalesce(array_agg(photo_url),'{}') into v_photos from public.items where id = any(v_items) and photo_url is not null;
  insert into public.lot_deletions(lot_no, summary) values (v_lot.lot_no, jsonb_build_object('sublots', coalesce(array_length(v_subs,1),0), 'items', coalesce(array_length(v_items,1),0)));
  perform set_config('app.purge','on',true);
  delete from public.sublots where id = any(v_subs);
  delete from public.lots where id=p_lot;
  perform set_config('app.purge','off',true);
  return v_photos;
end $$;

-- staff/manager: drop one or all unconsumed tag numbers of an editable sublot
CREATE OR REPLACE FUNCTION public.clear_tag_slots(p_sublot uuid, p_ser_no integer DEFAULT NULL) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_st sublot_status; n int;
begin
  if not (public.is_mgr() or public.has_role(auth.uid(),'staff')) then raise exception 'Not allowed'; end if;
  select status into v_st from public.sublots where id=p_sublot;
  if v_st in ('sealed','photography','ready_to_export','exported','closed') then raise exception 'Sublot sealed — unseal first'; end if;
  update public.tag_slots set superseded_at=now(), assigned_item_id=null
    where sublot_id=p_sublot and superseded_at is null and (p_ser_no is null or ser_no=p_ser_no);
  get diagnostics n = row_count;
  insert into public.station_events(sublot_id, station, action) values (p_sublot, 'tags', case when p_ser_no is null then 'tag_clear_all:'||n else 'tag_clear:'||p_ser_no end);
  return n;
end $$;
REVOKE ALL ON FUNCTION public.clear_tag_slots(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_tag_slots(uuid, integer) TO authenticated;