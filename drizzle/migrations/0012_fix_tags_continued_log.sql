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
    insert into public.station_events(sublot_id, station, action)
      values (p_sublot, 'seal', format('tags_continued %s (%s-%s)', v_need, v_max + 1, v_max + v_need));
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