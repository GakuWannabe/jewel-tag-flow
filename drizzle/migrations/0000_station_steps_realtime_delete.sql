ALTER PUBLICATION supabase_realtime ADD TABLE public.item_huids, public.huid_pool, public.tag_slots;

CREATE OR REPLACE FUNCTION public._block_removal_edits()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
begin
  if coalesce(current_setting('app.purge', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
  end if;
  raise exception 'Removal log is immutable';
end $$;

CREATE OR REPLACE FUNCTION public.import_huids(p_sublot uuid, p_rows jsonb)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare r jsonb; n int := 0; h text;
begin
  perform public._require_worker();
  if (select status from public.sublots where id=p_sublot) in ('sealed','exported','closed') then raise exception 'Sublot sealed'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    h := upper(trim(r->>'huid'));
    if h !~ '^[A-Z0-9]{6}$' then raise exception 'Invalid HUID %', h; end if;
    if exists (select 1 from public.huid_pool where huid=h) then raise exception 'Duplicate HUID % already in database', h; end if;
    insert into public.huid_pool(sublot_id, huid, piece_weight, source) values (p_sublot, h, nullif(r->>'weight','')::numeric, coalesce(nullif(r->>'source',''),'import'));
    n := n + 1;
  end loop;
  insert into public.station_events(sublot_id, station, action) values (p_sublot, 'huid', 'huid_import:'||n);
  return n;
end $$;

CREATE OR REPLACE FUNCTION public.import_tag_slots(p_sublot uuid, p_headers jsonb, p_rows jsonb)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare r jsonb; n int := 0; v_now timestamptz := now(); v_branch text; v_base text; v_st sublot_status;
begin
  if not (public.is_mgr() or public._is_service() or public.has_role(auth.uid(),'staff')) then raise exception 'Not allowed'; end if;
  select s.status, b.branch_code, pt.base_code into v_st, v_branch, v_base from public.sublots s join public.lots l on l.id=s.lot_id
    join public.branches b on b.id=l.branch_id join public.product_types pt on pt.id=s.product_type_id where s.id=p_sublot;
  if v_st in ('sealed','exported','closed') then raise exception 'Sublot sealed'; end if;
  if (select count(distinct (x->>'compcode', x->>'type', x->>'ic')) from jsonb_array_elements(p_rows) x) <> 1 then raise exception 'Mixed file: COMPCODE/type/IC differ'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if r->>'type' <> v_branch then raise exception 'type % does not match lot branch %', r->>'type', v_branch; end if;
    if left(r->>'ic',1) <> v_branch then raise exception 'IC must start with %', v_branch; end if;
    if substr(r->>'ic',2) <> v_base then raise exception 'IC % does not match product %', r->>'ic', v_base; end if;
  end loop;
  update public.tag_slots set superseded_at=v_now where sublot_id=p_sublot and superseded_at is null and assigned_item_id is null;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.tag_slots(sublot_id, compcode, type, ic, ser_no, cmd, raw, imported_at)
      values (p_sublot, r->>'compcode', r->>'type', r->>'ic', (r->>'ser_no')::int, r->>'cmd', r->'raw', v_now);
    n := n + 1;
  end loop;
  update public.sublots set slot_headers=p_headers, slots_imported_at=v_now where id=p_sublot;
  if not public._is_service() then
    insert into public.station_events(sublot_id, station, action) values (p_sublot, 'tags', 'tag_import:'||n);
  end if;
  return n;
end $$;

CREATE OR REPLACE FUNCTION public.import_tag_numbers(p_sublot uuid, p_ser_nos integer[])
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare v_branch text; v_base text; v_st sublot_status; v_now timestamptz := now(); s int; n int := 0;
begin
  perform public._require_worker();
  select s2.status, b.branch_code, pt.base_code into v_st, v_branch, v_base from public.sublots s2 join public.lots l on l.id=s2.lot_id
    join public.branches b on b.id=l.branch_id join public.product_types pt on pt.id=s2.product_type_id where s2.id=p_sublot;
  if v_st is null then raise exception 'Sublot not found'; end if;
  if v_st in ('sealed','exported','closed') then raise exception 'Sublot sealed'; end if;
  if coalesce(array_length(p_ser_nos,1),0) = 0 then raise exception 'No tag numbers'; end if;
  if (select count(*) from unnest(p_ser_nos) x) <> (select count(distinct x) from unnest(p_ser_nos) x) then raise exception 'Duplicate tag numbers in list'; end if;
  update public.tag_slots set superseded_at=v_now where sublot_id=p_sublot and superseded_at is null and assigned_item_id is null;
  foreach s in array p_ser_nos loop
    if s is null or s <= 0 then raise exception 'Invalid tag number %', s; end if;
    insert into public.tag_slots(sublot_id, compcode, type, ic, ser_no, cmd, raw, imported_at)
      values (p_sublot, 'A', v_branch, v_branch||v_base, s, 'C', null, v_now);
    n := n + 1;
  end loop;
  update public.sublots set slots_imported_at=v_now where id=p_sublot;
  insert into public.station_events(sublot_id, station, action) values (p_sublot, 'tags', 'tag_import:'||n);
  return n;
end $$;

CREATE OR REPLACE FUNCTION public.tags_left_to_load(p_sublot uuid)
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select greatest(0, coalesce((select declared_tags - removed_tags from public.sublot_targets where sublot_id=p_sublot),0)
    - (select count(*) from public.items where sublot_id=p_sublot and deleted_at is null))::int
  where public.has_any_role(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.auto_load(p_session uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare ses record; v_left int; c int; n int := 0;
begin
  perform public._require_worker();
  select ts.*, t.compartment_count into ses from public.tray_sessions ts join public.trays t on t.id=ts.tray_id where ts.id=p_session;
  if not found then raise exception 'Session not found'; end if;
  perform public._require_editable(ses.sublot_id);
  if ses.status not in ('empty','loaded') then raise exception 'Tray is past loading'; end if;
  v_left := public.tags_left_to_load(ses.sublot_id);
  for c in 1..ses.compartment_count loop
    exit when n >= v_left;
    if not exists (select 1 from public.items where tray_session_id=p_session and compartment_no=c and deleted_at is null) then
      perform public.set_compartment(p_session, c, true, null);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

CREATE OR REPLACE FUNCTION public.move_item(p_item uuid, p_to integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare it record; v_cnt int; other record; v_from int;
begin
  perform public._require_worker();
  select * into it from public.items where id=p_item and deleted_at is null;
  if not found then raise exception 'Item not found'; end if;
  perform public._require_editable(it.sublot_id);
  select t.compartment_count into v_cnt from public.tray_sessions ts join public.trays t on t.id=ts.tray_id where ts.id=it.tray_session_id;
  if p_to < 1 or p_to > v_cnt then raise exception 'Bad compartment'; end if;
  v_from := it.compartment_no;
  if v_from = p_to then return; end if;
  select * into other from public.items where tray_session_id=it.tray_session_id and compartment_no=p_to;
  if found then
    if other.deleted_at is not null then
      update public.items set compartment_no = -abs(hashtext(other.id::text)) where id=other.id;
      update public.items set compartment_no=p_to, updated_by=auth.uid(), updated_at=now() where id=p_item;
    else
      update public.items set compartment_no = -1 where id=p_item;
      update public.items set compartment_no=v_from, updated_by=auth.uid(), updated_at=now() where id=other.id;
      update public.items set compartment_no=p_to, updated_by=auth.uid(), updated_at=now() where id=p_item;
      insert into public.station_events(item_id, sublot_id, station, action) values (other.id, it.sublot_id, 'loading', 'moved:'||p_to||'->'||v_from);
    end if;
  else
    update public.items set compartment_no=p_to, updated_by=auth.uid(), updated_at=now() where id=p_item;
  end if;
  insert into public.station_events(item_id, sublot_id, station, action) values (p_item, it.sublot_id, 'loading', 'moved:'||v_from||'->'||p_to);
end $$;

CREATE TABLE public.lot_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_no text NOT NULL,
  summary jsonb,
  deleted_by uuid DEFAULT auth.uid(),
  deleted_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.lot_deletions TO authenticated;
GRANT ALL ON public.lot_deletions TO service_role;
ALTER TABLE public.lot_deletions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mgr/aud read" ON public.lot_deletions FOR SELECT TO authenticated USING (public.is_mgr_or_aud());

CREATE OR REPLACE FUNCTION public.delete_lot(p_lot uuid, p_confirm text)
 RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
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
  delete from public.bot_results where sublot_id = any(v_subs);
  delete from public.reconciliations where sublot_id = any(v_subs);
  delete from public.station_events where sublot_id = any(v_subs) or item_id = any(v_items);
  delete from public.hold_events where item_id = any(v_items);
  delete from public.item_removals where sublot_id = any(v_subs);
  delete from public.sync_conflicts where sublot_id = any(v_subs) or item_id = any(v_items);
  delete from public.item_huids where item_id = any(v_items);
  update public.huid_pool set assigned_item_id=null where sublot_id = any(v_subs) or assigned_item_id = any(v_items);
  update public.tag_slots set assigned_item_id=null where sublot_id = any(v_subs) or assigned_item_id = any(v_items);
  delete from public.huid_pool where sublot_id = any(v_subs);
  delete from public.tag_slots where sublot_id = any(v_subs);
  delete from public.items where id = any(v_items);
  delete from public.tray_sessions where sublot_id = any(v_subs);
  delete from public.sublot_targets where sublot_id = any(v_subs);
  delete from public.sublots where id = any(v_subs);
  delete from public.lots where id=p_lot;
  perform set_config('app.purge','off',true);
  return v_photos;
end $$;

CREATE POLICY "mgr delete photos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id='photos' AND public.is_mgr());