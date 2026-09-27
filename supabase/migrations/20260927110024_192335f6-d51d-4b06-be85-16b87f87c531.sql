
-- ============ ROLES ============
create type public.app_role as enum ('manager','staff','photo','auditor');

create table public.profiles (
  id uuid primary key,
  name text not null,
  username text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;
create or replace function public.has_any_role(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
                 where ur.user_id = _user_id and p.active)
$$;
create or replace function public.is_mgr() returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(),'manager') $$;
create or replace function public.is_mgr_or_aud() returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(),'manager') or public.has_role(auth.uid(),'auditor') $$;

create policy "read own or any role" on public.profiles for select to authenticated using (id = auth.uid() or public.has_any_role(auth.uid()));
create policy "manager updates profiles" on public.profiles for update to authenticated using (public.is_mgr()) with check (public.is_mgr());
create policy "read roles" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_mgr_or_aud());

-- ============ SETTINGS ============
create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.settings to authenticated;
grant all on public.settings to service_role;
alter table public.settings enable row level security;
create policy "any role reads settings" on public.settings for select to authenticated using (public.has_any_role(auth.uid()));
create policy "manager writes settings" on public.settings for insert to authenticated with check (public.is_mgr());
create policy "manager updates settings" on public.settings for update to authenticated using (public.is_mgr()) with check (public.is_mgr());

insert into public.settings(key, value) values
 ('recon_tolerance_per_10', '0.050'),
 ('ageing_minutes', '30'),
 ('photo_name_template', '"{COMPCODE}{IC}{ser_no}.JPEG"'),
 ('export_mapping', '[
   {"field":"gross_weight","column":"gw"},
   {"field":"net_weight","column":"nw"},
   {"field":"narration","column":"NARRATION"},
   {"field":"pcs","column":"pcs"},
   {"field":"purity_label","column":"purity"},
   {"field":"melting","column":"carrat"},
   {"field":"making_value","column":"MAKING"},
   {"field":"wastage_pct","column":"mkper"},
   {"field":"making_type","column":"labrate"},
   {"field":"vendor_code","column":"par_code"},
   {"field":"huids","column":"HUID"},
   {"field":"cat_a","column":"CATA"},
   {"field":"cat_b","column":"CATB"},
   {"field":"cat_c","column":"CATC"},
   {"field":"stone_pcs","column":"STNPCS"},
   {"field":"less_weight","column":"OW"},
   {"field":"photo_filename","column":"image"},
   {"field":"imgyesno","column":"imgyesno"}
 ]');

-- ============ MASTER DATA ============
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  branch_code text not null unique check (char_length(branch_code)=1),
  branch_name text not null,
  active boolean not null default true,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz
);
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null, active boolean not null default true,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz
);
create table public.product_types (
  id uuid primary key default gen_random_uuid(),
  base_code text not null unique, name text not null,
  default_pcs int not null default 1 check (default_pcs between 1 and 2),
  huid_pieces_per_tag int not null default 1 check (huid_pieces_per_tag between 1 and 2),
  active boolean not null default true,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz
);
create table public.purities (
  id uuid primary key default gen_random_uuid(),
  melting numeric(6,2) not null, purity_label text not null unique, metal text not null default 'GOLD',
  active boolean not null default true,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz
);
create table public.trays (
  id uuid primary key default gen_random_uuid(),
  tray_code text not null unique, tray_type text not null,
  rows int not null check (rows > 0), columns int not null check (columns > 0),
  compartment_count int not null,
  suitable_product_types uuid[] not null default '{}',
  active boolean not null default true,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz,
  check (compartment_count = rows * columns)
);

do $$ declare t text; begin
  foreach t in array array['branches','vendors','product_types','purities','trays'] loop
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "any role reads" on public.%I for select to authenticated using (public.has_any_role(auth.uid()))', t);
    execute format('create policy "manager inserts" on public.%I for insert to authenticated with check (public.is_mgr())', t);
    execute format('create policy "manager updates" on public.%I for update to authenticated using (public.is_mgr()) with check (public.is_mgr())', t);
  end loop;
end $$;

insert into public.branches(branch_code, branch_name) values ('W','BZ'),('H','VP'),('G','DOM');
insert into public.purities(melting, purity_label, metal) values (91.66,'916','GOLD'),(92.50,'925','SILVER'),(75.00,'750','GOLD'),(70.00,'700','GOLD');
insert into public.trays(tray_code, tray_type, rows, columns, compartment_count) values ('A','SMALL_18',6,3,18),('B','LARGE_12',4,3,12);
insert into public.product_types(base_code,name,default_pcs,huid_pieces_per_tag) values ('KC','Sample KC',1,1),('BL','Bali',2,2);

-- ============ LOTS / SUBLOTS ============
create type public.making_type as enum ('percentage','per_gram','per_piece');
create type public.sublot_status as enum ('draft','issued','loading','weighing','photography','ready_to_seal','sealed','exported','closed','halted');

create table public.lots (
  id uuid primary key default gen_random_uuid(),
  lot_no text not null unique,
  branch_id uuid not null references public.branches(id),
  vendor_id uuid not null references public.vendors(id),
  purity_id uuid not null references public.purities(id),
  melting numeric(6,2) not null,
  wastage_pct numeric(8,3) not null default 0,
  making_value numeric(12,3) not null default 0,
  making_type making_type not null default 'per_gram',
  received_date date not null default current_date,
  notes text, status text not null default 'open',
  deleted_at timestamptz, deleted_by uuid, delete_reason text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz
);
create table public.sublots (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.lots(id),
  sublot_no int not null,
  product_type_id uuid not null references public.product_types(id),
  status sublot_status not null default 'draft',
  halt_reason text,
  photographer_id uuid,
  slot_headers jsonb,           -- original ERP sheet column order
  slots_imported_at timestamptz,
  sealed_at timestamptz, sealed_by uuid,
  deleted_at timestamptz, deleted_by uuid, delete_reason text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz,
  unique (lot_id, sublot_no)
);
-- declared totals live apart so staff can NEVER read them
create table public.sublot_targets (
  sublot_id uuid primary key references public.sublots(id),
  declared_pcs int not null,
  declared_net_weight numeric(12,3) not null,
  adjust_pcs int not null default 0,
  adjust_net_weight numeric(12,3) not null default 0,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz
);
grant select, insert, update on public.lots, public.sublots, public.sublot_targets to authenticated;
grant all on public.lots, public.sublots, public.sublot_targets to service_role;
alter table public.lots enable row level security;
alter table public.sublots enable row level security;
alter table public.sublot_targets enable row level security;
create policy "any role reads lots" on public.lots for select to authenticated using (public.has_any_role(auth.uid()));
create policy "mgr ins lots" on public.lots for insert to authenticated with check (public.is_mgr());
create policy "mgr upd lots" on public.lots for update to authenticated using (public.is_mgr()) with check (public.is_mgr());
create policy "any role reads sublots" on public.sublots for select to authenticated using (public.has_any_role(auth.uid()));
create policy "mgr ins sublots" on public.sublots for insert to authenticated with check (public.is_mgr());
create policy "mgr upd sublots" on public.sublots for update to authenticated using (public.is_mgr()) with check (public.is_mgr());
create policy "mgr/aud read targets" on public.sublot_targets for select to authenticated using (public.is_mgr_or_aud());
create policy "mgr ins targets" on public.sublot_targets for insert to authenticated with check (public.is_mgr());
create policy "mgr upd targets" on public.sublot_targets for update to authenticated using (public.is_mgr()) with check (public.is_mgr());

-- ============ TRAY SESSIONS / ITEMS ============
create type public.session_status as enum ('empty','loaded','weighed','photographed','tagged','cleared');
create type public.hold_flag as enum ('damaged','wrong_item','re_photo','weight_disputed');

create table public.tray_sessions (
  id uuid primary key default gen_random_uuid(),
  sublot_id uuid not null references public.sublots(id),
  tray_id uuid not null references public.trays(id),
  status session_status not null default 'empty',
  station text not null default 'loading',
  station_since timestamptz not null default now(),
  holder_id uuid default auth.uid(),
  opened_by uuid default auth.uid(), opened_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_by uuid, updated_at timestamptz
);
-- HARD rule: a tray has at most one non-cleared session
create unique index one_open_session_per_tray on public.tray_sessions(tray_id) where status <> 'cleared';

create table public.items (
  id uuid primary key default gen_random_uuid(),
  tray_session_id uuid not null references public.tray_sessions(id),
  compartment_no int not null,
  sublot_id uuid not null references public.sublots(id),
  sequence int,
  gross_weight numeric(10,3),
  less_weight numeric(10,3) not null default 0.000,
  net_weight numeric(10,3) generated always as (gross_weight - less_weight) stored,
  pcs int not null default 1,
  narration text,
  compcode text, type text, ic text, ser_no int,
  actual_ser_no int,
  photo_filename text, photo_url text, source_photo_name text,
  hold_flag hold_flag, hold_note text,
  weighed_by uuid, weighed_at timestamptz, photo_matched_at timestamptz,
  -- reserved for later scope
  cat_a text, cat_b text, cat_c text, size text, stone_pcs int, barcode text, scale_serial text,
  deleted_at timestamptz, deleted_by uuid, delete_reason text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz,
  unique (tray_session_id, compartment_no)
);

create table public.huid_pool (
  id uuid primary key default gen_random_uuid(),
  sublot_id uuid not null references public.sublots(id),
  huid text not null unique check (huid ~ '^[A-Z0-9]{6}$'),
  piece_weight numeric(10,3),
  assigned_item_id uuid references public.items(id),
  assigned_at timestamptz, assigned_by uuid,
  source text not null default 'import',
  deleted_at timestamptz, deleted_by uuid, delete_reason text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create table public.item_huids (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  huid_pool_id uuid not null references public.huid_pool(id),
  position int not null check (position in (1,2)),
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  removed_at timestamptz, removed_by uuid
);
create unique index item_huids_active_pool on public.item_huids(huid_pool_id) where removed_at is null;
create unique index item_huids_active_pos on public.item_huids(item_id, position) where removed_at is null;

create table public.tag_slots (
  id uuid primary key default gen_random_uuid(),
  sublot_id uuid not null references public.sublots(id),
  compcode text not null, type text not null, ic text not null, ser_no int not null, cmd text,
  raw jsonb,
  assigned_item_id uuid references public.items(id),
  imported_at timestamptz not null default now(), imported_by uuid default auth.uid(),
  superseded_at timestamptz,
  unique (sublot_id, ser_no, imported_at)
);

create table public.hold_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  action text not null, flag hold_flag, note text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create table public.station_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.items(id),
  sublot_id uuid references public.sublots(id),
  station text not null, action text not null,
  user_id uuid default auth.uid(), created_at timestamptz not null default now()
);
create table public.reconciliations (
  id uuid primary key default gen_random_uuid(),
  sublot_id uuid not null references public.sublots(id),
  passed boolean not null,
  entered_pcs int, target_pcs int, entered_net numeric(12,3), target_net numeric(12,3),
  tolerance numeric(10,3), huids_remaining int,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create table public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  sublot_id uuid, item_id uuid, op jsonb, error text,
  resolved_at timestamptz, resolved_by uuid,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create table public.bot_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null, key_hash text not null unique, key_hint text,
  active boolean not null default true,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create table public.bot_results (
  id uuid primary key default gen_random_uuid(),
  sublot_id uuid not null references public.sublots(id),
  sequence int not null, expected_ser_no int, actual_ser_no int,
  status text not null, error_message text, mismatch boolean not null default false,
  bot_client_id uuid, created_at timestamptz not null default now()
);

grant select on public.tray_sessions, public.items, public.huid_pool, public.item_huids, public.tag_slots, public.hold_events, public.station_events to authenticated;
grant select, insert on public.sync_conflicts to authenticated;
grant update on public.sync_conflicts to authenticated;
grant select on public.reconciliations, public.bot_results to authenticated;
grant select, insert, update on public.bot_clients to authenticated;
grant all on public.tray_sessions, public.items, public.huid_pool, public.item_huids, public.tag_slots, public.hold_events, public.station_events, public.reconciliations, public.sync_conflicts, public.bot_clients, public.bot_results to service_role;

alter table public.tray_sessions enable row level security;
alter table public.items enable row level security;
alter table public.huid_pool enable row level security;
alter table public.item_huids enable row level security;
alter table public.tag_slots enable row level security;
alter table public.hold_events enable row level security;
alter table public.station_events enable row level security;
alter table public.reconciliations enable row level security;
alter table public.sync_conflicts enable row level security;
alter table public.bot_clients enable row level security;
alter table public.bot_results enable row level security;

create policy "read" on public.tray_sessions for select to authenticated using (public.has_any_role(auth.uid()));
create policy "read" on public.items for select to authenticated using (public.has_any_role(auth.uid()));
create policy "read" on public.huid_pool for select to authenticated using (public.has_any_role(auth.uid()));
create policy "read" on public.item_huids for select to authenticated using (public.has_any_role(auth.uid()));
create policy "read" on public.tag_slots for select to authenticated using (public.has_any_role(auth.uid()));
create policy "read" on public.hold_events for select to authenticated using (public.has_any_role(auth.uid()));
create policy "mgr/aud read" on public.station_events for select to authenticated using (public.is_mgr_or_aud());
create policy "mgr/aud read" on public.reconciliations for select to authenticated using (public.is_mgr_or_aud());
create policy "mgr/aud read" on public.bot_results for select to authenticated using (public.is_mgr_or_aud());
create policy "mgr/aud read" on public.bot_clients for select to authenticated using (public.is_mgr_or_aud());
create policy "mgr ins" on public.bot_clients for insert to authenticated with check (public.is_mgr());
create policy "mgr upd" on public.bot_clients for update to authenticated using (public.is_mgr()) with check (public.is_mgr());
create policy "read own or mgr" on public.sync_conflicts for select to authenticated using (created_by = auth.uid() or public.is_mgr_or_aud());
create policy "any role logs" on public.sync_conflicts for insert to authenticated with check (public.has_any_role(auth.uid()) and created_by = auth.uid());
create policy "mgr resolves" on public.sync_conflicts for update to authenticated using (public.is_mgr()) with check (public.is_mgr());

-- ============ HELPERS ============
create or replace function public.touch_updated() returns trigger language plpgsql set search_path=public as $$
begin new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['branches','vendors','product_types','purities','trays','lots','sublots','sublot_targets','tray_sessions','items'] loop
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated()', t);
  end loop;
end $$;

create or replace function public._require_worker() returns void language plpgsql stable security definer set search_path=public as $$
begin
  if not (public.has_role(auth.uid(),'staff') or public.has_role(auth.uid(),'manager')) then
    raise exception 'Not allowed';
  end if;
end $$;

create or replace function public._require_editable(_sublot uuid) returns void language plpgsql stable security definer set search_path=public as $$
declare s sublot_status;
begin
  select status into s from public.sublots where id=_sublot and deleted_at is null;
  if s is null then raise exception 'Sublot not found'; end if;
  if s not in ('issued','loading','weighing') then raise exception 'Sublot is locked (status %)', s; end if;
end $$;

-- ============ STAFF ACTIONS ============
create or replace function public.open_tray_session(p_sublot uuid, p_tray uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_existing record;
begin
  perform public._require_worker(); perform public._require_editable(p_sublot);
  select * into v_existing from public.tray_sessions where tray_id=p_tray and status <> 'cleared';
  if found then
    if v_existing.sublot_id = p_sublot then return v_existing.id; end if;
    raise exception 'Tray is still in use by another sublot. It must be cleared first.';
  end if;
  insert into public.tray_sessions(sublot_id, tray_id) values (p_sublot, p_tray) returning id into v_id;
  update public.sublots set status='loading' where id=p_sublot and status='issued';
  return v_id;
end $$;

create or replace function public.set_compartment(p_session uuid, p_compartment int, p_occupied boolean, p_item_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare ses record; v_item record; v_pcs int; v_count int; v_id uuid;
begin
  perform public._require_worker();
  select ts.*, t.compartment_count into ses from public.tray_sessions ts join public.trays t on t.id=ts.tray_id where ts.id=p_session;
  if not found then raise exception 'Session not found'; end if;
  perform public._require_editable(ses.sublot_id);
  if ses.status not in ('empty','loaded') then raise exception 'Tray is past loading'; end if;
  if p_compartment < 1 or p_compartment > ses.compartment_count then raise exception 'Bad compartment'; end if;
  select * into v_item from public.items where tray_session_id=p_session and compartment_no=p_compartment;
  if p_occupied then
    if found then
      if v_item.deleted_at is not null then
        update public.items set deleted_at=null, deleted_by=null, delete_reason=null where id=v_item.id;
      end if;
      return v_item.id;
    end if;
    select pt.default_pcs into v_pcs from public.sublots s join public.product_types pt on pt.id=s.product_type_id where s.id=ses.sublot_id;
    insert into public.items(id, tray_session_id, compartment_no, sublot_id, pcs)
      values (coalesce(p_item_id, gen_random_uuid()), p_session, p_compartment, ses.sublot_id, v_pcs) returning id into v_id;
    insert into public.station_events(item_id, sublot_id, station, action) values (v_id, ses.sublot_id, 'loading', 'loaded');
  else
    if found and v_item.deleted_at is null then
      if v_item.gross_weight is not null then raise exception 'Compartment already weighed'; end if;
      update public.items set deleted_at=now(), deleted_by=auth.uid(), delete_reason='unmarked during loading' where id=v_item.id;
    end if;
    v_id := v_item.id;
  end if;
  select count(*) into v_count from public.items where tray_session_id=p_session and deleted_at is null;
  update public.tray_sessions set status = case when v_count>0 then 'loaded'::session_status else 'empty'::session_status end, holder_id=auth.uid() where id=p_session;
  return v_id;
end $$;

create or replace function public.start_weighing(p_session uuid) returns void language plpgsql security definer set search_path=public as $$
declare ses record;
begin
  perform public._require_worker();
  select * into ses from public.tray_sessions where id=p_session;
  perform public._require_editable(ses.sublot_id);
  update public.tray_sessions set station='weighing', station_since=now(), holder_id=auth.uid() where id=p_session and station<>'weighing';
  update public.sublots set status='weighing' where id=ses.sublot_id and status in ('issued','loading');
end $$;

create or replace function public.save_weight(p_item uuid, p_gross numeric, p_less numeric, p_pcs int, p_narration text)
returns void language plpgsql security definer set search_path=public as $$
declare it record;
begin
  perform public._require_worker();
  select * into it from public.items where id=p_item and deleted_at is null;
  if not found then raise exception 'Item not found'; end if;
  perform public._require_editable(it.sublot_id);
  if p_gross is null or p_gross <= 0 then raise exception 'Gross weight required'; end if;
  if coalesce(p_less,0) < 0 or coalesce(p_less,0) > p_gross then raise exception 'Less weight must be between 0 and gross'; end if;
  if p_pcs not in (1,2) then raise exception 'pcs must be 1 or 2'; end if;
  if p_pcs < (select count(*) from public.item_huids where item_id=p_item and removed_at is null) then
    raise exception 'Unassign HUIDs before reducing pcs';
  end if;
  update public.items set gross_weight=round(p_gross,3), less_weight=round(coalesce(p_less,0),3), pcs=p_pcs,
    narration=nullif(trim(p_narration),''), weighed_by=auth.uid(), weighed_at=now() where id=p_item;
  insert into public.station_events(item_id, sublot_id, station, action) values (p_item, it.sublot_id, 'weighing', 'weighed');
  update public.tray_sessions set holder_id=auth.uid() where id=it.tray_session_id;
end $$;

create or replace function public.unassign_item_huids(p_item uuid) returns void language plpgsql security definer set search_path=public as $$
declare it record;
begin
  perform public._require_worker();
  select * into it from public.items where id=p_item;
  if not found then raise exception 'Item not found'; end if;
  if not public.is_mgr() then perform public._require_editable(it.sublot_id); end if;
  update public.huid_pool set assigned_item_id=null, assigned_at=null, assigned_by=null
    where id in (select huid_pool_id from public.item_huids where item_id=p_item and removed_at is null);
  update public.item_huids set removed_at=now(), removed_by=auth.uid() where item_id=p_item and removed_at is null;
end $$;

-- p_huids: HUID strings in position order. Existing pool rows of this sublot are used;
-- a HUID not in any pool is added to this sublot's pool as a manual entry.
create or replace function public.assign_item_huids(p_item uuid, p_huids text[]) returns void language plpgsql security definer set search_path=public as $$
declare it record; h text; i int := 0; pr record; v_norm text[] := '{}';
begin
  perform public._require_worker();
  select * into it from public.items where id=p_item and deleted_at is null;
  if not found then raise exception 'Item not found'; end if;
  perform public._require_editable(it.sublot_id);
  foreach h in array p_huids loop v_norm := v_norm || upper(trim(h)); end loop;
  if array_length(v_norm,1) is distinct from it.pcs then raise exception 'Need exactly % HUID(s)', it.pcs; end if;
  if array_length(v_norm,1)=2 and v_norm[1]=v_norm[2] then raise exception 'The two HUIDs on one tag cannot be identical'; end if;
  perform public.unassign_item_huids(p_item);
  foreach h in array v_norm loop
    i := i + 1;
    if h !~ '^[A-Z0-9]{6}$' then raise exception 'HUID % must be 6 letters/digits', h; end if;
    select * into pr from public.huid_pool where huid=h for update;
    if not found then
      insert into public.huid_pool(sublot_id, huid, source) values (it.sublot_id, h, 'manual') returning * into pr;
    end if;
    if pr.sublot_id <> it.sublot_id then raise exception 'HUID % belongs to another sublot', h; end if;
    if pr.deleted_at is not null then raise exception 'HUID % was removed from the pool', h; end if;
    if pr.assigned_item_id is not null then raise exception 'HUID % is already assigned to another item', h; end if;
    update public.huid_pool set assigned_item_id=p_item, assigned_at=now(), assigned_by=auth.uid() where id=pr.id;
    insert into public.item_huids(item_id, huid_pool_id, position) values (p_item, pr.id, i);
  end loop;
  insert into public.station_events(item_id, sublot_id, station, action) values (p_item, it.sublot_id, 'weighing', 'huid');
end $$;

create or replace function public.set_hold(p_item uuid, p_flag hold_flag, p_note text) returns void language plpgsql security definer set search_path=public as $$
declare it record;
begin
  if not public.has_any_role(auth.uid()) or public.has_role(auth.uid(),'auditor') and not public.is_mgr() and not public.has_role(auth.uid(),'staff') and not public.has_role(auth.uid(),'photo') then raise exception 'Not allowed'; end if;
  select * into it from public.items where id=p_item and deleted_at is null;
  if not found then raise exception 'Item not found'; end if;
  if (select status from public.sublots where id=it.sublot_id) in ('sealed','exported','closed') then raise exception 'Sublot sealed'; end if;
  update public.items set hold_flag=p_flag, hold_note=p_note where id=p_item;
  insert into public.hold_events(item_id, action, flag, note) values (p_item, 'set', p_flag, p_note);
end $$;

create or replace function public.clear_hold(p_item uuid, p_note text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_mgr() then raise exception 'Manager only'; end if;
  update public.items set hold_flag=null, hold_note=null where id=p_item;
  insert into public.hold_events(item_id, action, note) values (p_item, 'cleared', p_note);
end $$;

create or replace function public.remove_item(p_item uuid, p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare it record;
begin
  if not public.is_mgr() then raise exception 'Manager only'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'Reason required'; end if;
  select * into it from public.items where id=p_item and deleted_at is null;
  if not found then raise exception 'Item not found'; end if;
  if (select status from public.sublots where id=it.sublot_id) in ('sealed','exported','closed') then raise exception 'Sublot sealed'; end if;
  perform public.unassign_item_huids(p_item);
  -- return the HUIDs to the pool for this piece's count: the pieces leave the sublot, so the target shrinks
  update public.sublot_targets set adjust_pcs = adjust_pcs - it.pcs, adjust_net_weight = adjust_net_weight - coalesce(it.net_weight,0)
    where sublot_id = it.sublot_id;
  update public.items set deleted_at=now(), deleted_by=auth.uid(), delete_reason=p_reason, hold_flag=null where id=p_item;
  insert into public.hold_events(item_id, action, note) values (p_item, 'removed', p_reason);
end $$;

create or replace function public.close_tray_session(p_session uuid) returns void language plpgsql security definer set search_path=public as $$
declare ses record; v_bad int;
begin
  perform public._require_worker();
  select * into ses from public.tray_sessions where id=p_session;
  perform public._require_editable(ses.sublot_id);
  select count(*) into v_bad from public.items i where i.tray_session_id=p_session and i.deleted_at is null
    and (i.gross_weight is null or (select count(*) from public.item_huids h where h.item_id=i.id and h.removed_at is null) <> i.pcs);
  if v_bad > 0 then raise exception '% compartment(s) still need weight or HUIDs', v_bad; end if;
  if not exists (select 1 from public.items where tray_session_id=p_session and deleted_at is null) then raise exception 'Tray is empty'; end if;
  update public.tray_sessions set status='weighed', station='weighed', station_since=now() where id=p_session;
end $$;

-- blind: returns only pass/fail
create or replace function public.close_sublot(p_sublot uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare t record; v_pcs int; v_net numeric; v_tol numeric; v_rem int; v_open int; v_pass boolean; v_tp int; v_tn numeric;
begin
  perform public._require_worker(); perform public._require_editable(p_sublot);
  select count(*) into v_open from public.tray_sessions where sublot_id=p_sublot and status in ('empty','loaded');
  if v_open > 0 then raise exception 'Close every tray first'; end if;
  select * into t from public.sublot_targets where sublot_id=p_sublot;
  if not found then raise exception 'Sublot has no targets'; end if;
  select coalesce(sum(pcs),0), coalesce(sum(net_weight),0) into v_pcs, v_net from public.items where sublot_id=p_sublot and deleted_at is null;
  select count(*) into v_rem from public.huid_pool where sublot_id=p_sublot and deleted_at is null and assigned_item_id is null;
  v_tp := t.declared_pcs + t.adjust_pcs; v_tn := t.declared_net_weight + t.adjust_net_weight;
  select coalesce((value #>> '{}')::numeric, 0.05) into v_tol from public.settings where key='recon_tolerance_per_10';
  v_tol := coalesce(v_tol,0.05) * greatest(1, ceil(v_tp/10.0));
  v_pass := v_pcs = v_tp and abs(v_net - v_tn) <= v_tol and v_rem = 0;
  insert into public.reconciliations(sublot_id, passed, entered_pcs, target_pcs, entered_net, target_net, tolerance, huids_remaining)
    values (p_sublot, v_pass, v_pcs, v_tp, v_net, v_tn, v_tol, v_rem);
  if v_pass then
    update public.sublots set status='photography', halt_reason=null where id=p_sublot;
  else
    update public.sublots set status='halted', halt_reason='reconciliation_failed' where id=p_sublot;
  end if;
  return v_pass;
end $$;

-- ============ PHOTOS ============
create or replace function public.match_photo(p_item uuid, p_path text, p_name text) returns void language plpgsql security definer set search_path=public as $$
declare it record;
begin
  if not (public.is_mgr() or public.has_role(auth.uid(),'photo')) then raise exception 'Not allowed'; end if;
  select * into it from public.items where id=p_item and deleted_at is null;
  if not found then raise exception 'Item not found'; end if;
  if (select status from public.sublots where id=it.sublot_id) not in ('photography','ready_to_seal') then raise exception 'Sublot is not in photography'; end if;
  update public.items set photo_url=p_path, source_photo_name=p_name, photo_matched_at=now() where id=p_item;
  insert into public.station_events(item_id, sublot_id, station, action) values (p_item, it.sublot_id, 'photo', 'matched');
end $$;

create or replace function public.refresh_photo_status(p_sublot uuid) returns text language plpgsql security definer set search_path=public as $$
declare v_missing int; v_status sublot_status;
begin
  if not (public.is_mgr() or public.has_role(auth.uid(),'photo')) then raise exception 'Not allowed'; end if;
  select status into v_status from public.sublots where id=p_sublot;
  if v_status not in ('photography','ready_to_seal') then return v_status::text; end if;
  select count(*) into v_missing from public.items where sublot_id=p_sublot and deleted_at is null and photo_url is null;
  update public.tray_sessions ts set status='photographed', station='photographed', station_since=now()
   where ts.sublot_id=p_sublot and ts.status='weighed'
     and not exists (select 1 from public.items i where i.tray_session_id=ts.id and i.deleted_at is null and i.photo_url is null);
  update public.sublots set status = case when v_missing=0 then 'ready_to_seal'::sublot_status else 'photography'::sublot_status end where id=p_sublot;
  return case when v_missing=0 then 'ready_to_seal' else 'photography' end;
end $$;

-- ============ SEAL ============
create or replace function public.seal_sublot(p_sublot uuid) returns int language plpgsql security definer set search_path=public as $$
declare s record; v_items int; v_slots int; v_tpl text; r record; sl record; v_seq int := 0; v_name text;
begin
  if not public.is_mgr() then raise exception 'Manager only'; end if;
  select * into s from public.sublots where id=p_sublot for update;
  if s.status <> 'ready_to_seal' then raise exception 'Sublot must be ready_to_seal (is %)', s.status; end if;
  if not exists (select 1 from public.reconciliations where sublot_id=p_sublot and passed order by created_at desc limit 1) then raise exception 'Reconciliation has not passed'; end if;
  if exists (select 1 from public.items where sublot_id=p_sublot and deleted_at is null and hold_flag is not null) then raise exception 'Open holds remain'; end if;
  if exists (select 1 from public.items where sublot_id=p_sublot and deleted_at is null and photo_url is null) then raise exception 'Photos missing'; end if;
  if exists (select 1 from public.huid_pool where sublot_id=p_sublot and deleted_at is null and assigned_item_id is null) then raise exception 'HUID pool not empty'; end if;
  if exists (select 1 from public.items i where i.sublot_id=p_sublot and i.deleted_at is null and (select count(*) from public.item_huids h where h.item_id=i.id and h.removed_at is null) <> i.pcs) then raise exception 'Incomplete HUIDs'; end if;
  select count(*) into v_items from public.items where sublot_id=p_sublot and deleted_at is null;
  select count(*) into v_slots from public.tag_slots where sublot_id=p_sublot and superseded_at is null and assigned_item_id is null;
  if v_slots < v_items then raise exception 'Not enough tag slots (% available, % needed)', v_slots, v_items; end if;
  select coalesce(value #>> '{}', '{COMPCODE}{IC}{ser_no}.JPEG') into v_tpl from public.settings where key='photo_name_template';
  v_tpl := coalesce(v_tpl, '{COMPCODE}{IC}{ser_no}.JPEG');
  for r in select i.id from public.items i join public.tray_sessions ts on ts.id=i.tray_session_id join public.trays t on t.id=ts.tray_id
           where i.sublot_id=p_sublot and i.deleted_at is null
           order by t.tray_code, ts.opened_at, i.compartment_no loop
    v_seq := v_seq + 1;
    select * into sl from public.tag_slots where sublot_id=p_sublot and superseded_at is null and assigned_item_id is null order by ser_no asc limit 1 for update;
    v_name := replace(replace(replace(v_tpl,'{COMPCODE}',sl.compcode),'{IC}',sl.ic),'{ser_no}',sl.ser_no::text);
    update public.tag_slots set assigned_item_id=r.id where id=sl.id;
    update public.items set sequence=v_seq, compcode=sl.compcode, type=sl.type, ic=sl.ic, ser_no=sl.ser_no, photo_filename=v_name where id=r.id;
  end loop;
  update public.tray_sessions set status='tagged', station='tagged', station_since=now() where sublot_id=p_sublot and status <> 'cleared';
  update public.sublots set status='sealed', sealed_at=now(), sealed_by=auth.uid() where id=p_sublot;
  return v_seq;
end $$;

create or replace function public.clear_tray_session(p_session uuid) returns void language plpgsql security definer set search_path=public as $$
declare ses record; st sublot_status;
begin
  if not public.is_mgr() then raise exception 'Manager only'; end if;
  select * into ses from public.tray_sessions where id=p_session;
  select status into st from public.sublots where id=ses.sublot_id;
  if st not in ('sealed','exported','closed') and exists (select 1 from public.items where tray_session_id=p_session and deleted_at is null) then
    raise exception 'Tray still holds untagged items';
  end if;
  update public.tray_sessions set status='cleared', closed_at=now(), station='cleared', station_since=now() where id=p_session;
end $$;

-- ============ STORAGE ============
create policy "roles read photos" on storage.objects for select to authenticated using (bucket_id='photos' and public.has_any_role(auth.uid()));
create policy "photo/mgr upload" on storage.objects for insert to authenticated with check (bucket_id='photos' and (public.is_mgr() or public.has_role(auth.uid(),'photo')));
create policy "photo/mgr replace" on storage.objects for update to authenticated using (bucket_id='photos' and (public.is_mgr() or public.has_role(auth.uid(),'photo')));

-- ============ REALTIME ============
alter publication supabase_realtime add table public.tray_sessions;
alter publication supabase_realtime add table public.items;

grant execute on all functions in schema public to authenticated;
