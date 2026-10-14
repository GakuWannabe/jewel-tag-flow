ALTER TABLE public.tag_slots ADD COLUMN IF NOT EXISTS assumed boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.tag_slots.assumed IS 'True when the ser_no was continued past the manager-entered list, not confirmed free by the ERP';

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
  if exists (select 1 from jsonb_array_elements(p_rows) x where coalesce((x->>'assumed')::boolean,false)) and not public.is_mgr() then
    raise exception 'Only a manager can add assumed tag numbers';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if r->>'type' <> v_branch then raise exception 'type % does not match lot branch %', r->>'type', v_branch; end if;
    if left(r->>'ic',1) <> v_branch then raise exception 'IC must start with %', v_branch; end if;
    if substr(r->>'ic',2) <> v_base then raise exception 'IC % does not match product %', r->>'ic', v_base; end if;
  end loop;
  update public.tag_slots set superseded_at=v_now where sublot_id=p_sublot and superseded_at is null and assigned_item_id is null;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.tag_slots(sublot_id, compcode, type, ic, ser_no, cmd, raw, imported_at, assumed)
      values (p_sublot, r->>'compcode', r->>'type', r->>'ic', (r->>'ser_no')::int, r->>'cmd', r->'raw', v_now, coalesce((r->>'assumed')::boolean,false));
    n := n + 1;
  end loop;
  update public.sublots set slot_headers=p_headers, slots_imported_at=v_now where id=p_sublot;
  if not public._is_service() then
    insert into public.station_events(sublot_id, station, action) values (p_sublot, 'tags', 'tag_import:'||n);
  end if;
  return n;
end $$;