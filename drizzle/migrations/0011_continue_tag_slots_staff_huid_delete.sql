ALTER TABLE public.sublots ADD COLUMN IF NOT EXISTS tags_continued integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public._seal_blocker(p_sublot uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if exists (select 1 from public.items where sublot_id=p_sublot and deleted_at is null and hold_flag is not null) then return 'Open holds remain'; end if;
  if exists (select 1 from public.huid_pool where sublot_id=p_sublot and deleted_at is null and assigned_item_id is null) then return 'HUID pool not empty'; end if;
  if exists (select 1 from public.items i where i.sublot_id=p_sublot and i.deleted_at is null and (select count(*) from public.item_huids h where h.item_id=i.id and h.removed_at is null) <> i.pcs) then return 'Incomplete HUIDs'; end if;
  if exists (select 1 from public.items where sublot_id=p_sublot and deleted_at is null)
     and not exists (select 1 from public.tag_slots where sublot_id=p_sublot and superseded_at is null) then return 'No tag slots imported'; end if;
  return null;
end $$;
REVOKE ALL ON FUNCTION public._seal_blocker(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._do_seal(p_sublot uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_tpl text; r record; sl record; v_seq int := 0; v_name text; v_items int; v_free int; v_need int; v_max int; tpl record; k int;
begin
  select value #>> '{}' into v_tpl from public.settings where key='photo_name_template';
  v_tpl := coalesce(nullif(v_tpl,''), '{COMPCODE}{IC}{ser_no}.jpg');
  select count(*) into v_items from public.items where sublot_id=p_sublot and deleted_at is null;
  select count(*) into v_free from public.tag_slots where sublot_id=p_sublot and superseded_at is null and assigned_item_id is null;
  v_need := greatest(0, v_items - v_free);
  if v_need > 0 then
    select max(ser_no) into v_max from public.tag_slots where sublot_id=p_sublot and superseded_at is null;
    select compcode, type, ic, cmd into tpl from public.tag_slots where sublot_id=p_sublot and superseded_at is null order by ser_no desc limit 1;
    for k in 1..v_need loop
      insert into public.tag_slots(sublot_id, compcode, type, ic, ser_no, cmd, raw, imported_at, assumed)
        values (p_sublot, tpl.compcode, tpl.type, tpl.ic, v_max + k, tpl.cmd, jsonb_build_object('source','auto_continued_at_seal'), now(), true);
    end loop;
    update public.sublots set tags_continued = tags_continued + v_need where id=p_sublot;
    insert into public.station_events(sublot_id, event, detail)
      values (p_sublot, 'tags_continued', jsonb_build_object('count', v_need, 'from', v_max + 1, 'to', v_max + v_need));
  end if;
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

CREATE OR REPLACE FUNCTION public.delete_pool_huid(p_huid_pool_id uuid, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare r record; v_status sublot_status;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'Reason required'; end if;
  select * into r from public.huid_pool where id=p_huid_pool_id and deleted_at is null for update;
  if not found then raise exception 'HUID not found'; end if;
  select status into v_status from public.sublots where id=r.sublot_id;
  if not public.is_mgr() then
    perform public._require_worker();
    if v_status not in ('issued','loading','weighing') then raise exception 'Sublot is not open for editing'; end if;
  end if;
  if r.assigned_item_id is not null then raise exception 'HUID % is assigned to an item — unmatch it first', r.huid; end if;
  if v_status in ('sealed','photography','ready_to_export','exported','closed') then raise exception 'Sublot is sealed — unseal first'; end if;
  update public.huid_pool set deleted_at=now(), deleted_by=auth.uid(), delete_reason=trim(p_reason) where id=r.id;
  insert into public.huid_deletions(huid_pool_id, sublot_id, huid, reason, deleted_by)
  values (r.id, r.sublot_id, r.huid, trim(p_reason), auth.uid());
end $$;
REVOKE ALL ON FUNCTION public.delete_pool_huid(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_pool_huid(uuid, text) TO authenticated;