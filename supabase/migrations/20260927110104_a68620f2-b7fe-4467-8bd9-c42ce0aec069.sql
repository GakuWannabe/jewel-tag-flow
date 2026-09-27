
create or replace function public.check_huids(p_huids text[])
returns table(huid text, sublot_id uuid, lot_no text, sublot_no int, assigned_item_id uuid, tray_code text, compartment_no int)
language sql stable security definer set search_path=public as $$
  select hp.huid, hp.sublot_id, l.lot_no, s.sublot_no, hp.assigned_item_id, t.tray_code, i.compartment_no
  from public.huid_pool hp
  join public.sublots s on s.id=hp.sublot_id join public.lots l on l.id=s.lot_id
  left join public.items i on i.id=hp.assigned_item_id
  left join public.tray_sessions ts on ts.id=i.tray_session_id left join public.trays t on t.id=ts.tray_id
  where public.has_any_role(auth.uid()) and hp.huid = any(select upper(trim(x)) from unnest(p_huids) x)
$$;

create or replace function public.import_huids(p_sublot uuid, p_rows jsonb) returns int language plpgsql security definer set search_path=public as $$
declare r jsonb; n int := 0; h text;
begin
  if not public.is_mgr() then raise exception 'Manager only'; end if;
  if (select status from public.sublots where id=p_sublot) in ('sealed','exported','closed') then raise exception 'Sublot sealed'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    h := upper(trim(r->>'huid'));
    if h !~ '^[A-Z0-9]{6}$' then raise exception 'Invalid HUID %', h; end if;
    if exists (select 1 from public.huid_pool where huid=h) then raise exception 'Duplicate HUID % already in database', h; end if;
    insert into public.huid_pool(sublot_id, huid, piece_weight) values (p_sublot, h, nullif(r->>'weight','')::numeric);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.import_tag_slots(p_sublot uuid, p_headers jsonb, p_rows jsonb) returns int language plpgsql security definer set search_path=public as $$
declare r jsonb; n int := 0; v_now timestamptz := now(); v_branch text; v_base text; v_st sublot_status;
begin
  if not public.is_mgr() then raise exception 'Manager only'; end if;
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
  return n;
end $$;

create or replace function public.manager_reopen_sublot(p_sublot uuid, p_status sublot_status) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_mgr() then raise exception 'Manager only'; end if;
  update public.sublots set status=p_status, halt_reason=null where id=p_sublot;
  if p_status in ('weighing','loading') then
    update public.tray_sessions set status='loaded', station='weighing', station_since=now() where sublot_id=p_sublot and status='weighed';
  end if;
end $$;

create or replace function public.mark_exported(p_sublot uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_mgr() then raise exception 'Manager only'; end if;
  update public.sublots set status='exported' where id=p_sublot and status='sealed';
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.prosecdef loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
