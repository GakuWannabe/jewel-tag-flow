-- 2(a)/(b): remove functions that revealed declared tag counts
DROP FUNCTION IF EXISTS public.auto_load(uuid);
DROP FUNCTION IF EXISTS public.tags_left_to_load(uuid);

-- 2(d): staff can no longer read huid_pool.piece_weight (sum = declared net weight)
REVOKE SELECT ON public.huid_pool FROM anon, authenticated;
GRANT SELECT (id, sublot_id, huid, assigned_item_id, assigned_at, assigned_by, source, deleted_at, deleted_by, delete_reason, created_by, created_at)
  ON public.huid_pool TO authenticated;
GRANT ALL ON public.huid_pool TO service_role;

-- managers/auditors keep full pool access (incl. weights) through this function
CREATE OR REPLACE FUNCTION public.huid_pool_admin(p_sublot uuid)
 RETURNS SETOF public.huid_pool LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
begin
  if not public.is_mgr_or_aud() then raise exception 'Managers and auditors only'; end if;
  return query select * from public.huid_pool where sublot_id=p_sublot and deleted_at is null order by huid;
end $$;
REVOKE ALL ON FUNCTION public.huid_pool_admin(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.huid_pool_admin(uuid) TO authenticated;

-- Server-side HUID matching. Returns HUID strings only — never weights, never the pool, never totals.
-- p_fragment null  -> top 3 weight-matched candidates (pcs=1 singles, pcs=2 pairs)
-- p_fragment given -> free HUIDs of the item's sublot containing that fragment
CREATE OR REPLACE FUNCTION public.suggest_huids(p_item uuid, p_fragment text DEFAULT NULL)
 RETURNS TABLE(huids text[]) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
declare it record; v_frag text;
begin
  perform public._require_worker();
  select id, sublot_id, net_weight, pcs into it from public.items where id=p_item and deleted_at is null;
  if not found then raise exception 'Item not found'; end if;

  v_frag := upper(trim(coalesce(p_fragment, '')));
  if p_fragment is not null then
    if v_frag !~ '^[A-Z0-9]{0,6}$' then raise exception 'Search with letters/digits only'; end if;
    return query
      select array[p.huid] from public.huid_pool p
      where p.sublot_id=it.sublot_id and p.deleted_at is null and p.assigned_item_id is null
        and p.huid like '%' || v_frag || '%'
      order by p.huid limit 60;
    return;
  end if;

  if it.net_weight is null or it.net_weight <= 0 then return; end if;

  if it.pcs = 1 then
    return query
      select array[p.huid] from public.huid_pool p
      where p.sublot_id=it.sublot_id and p.deleted_at is null and p.assigned_item_id is null and p.piece_weight is not null
      order by abs(p.piece_weight - it.net_weight), p.huid limit 3;
  elsif it.pcs = 2 then
    return query
      select array[a.huid, b.huid]
      from public.huid_pool a
      join public.huid_pool b on b.sublot_id=a.sublot_id and a.huid < b.huid
      where a.sublot_id=it.sublot_id
        and a.deleted_at is null and a.assigned_item_id is null and a.piece_weight is not null
        and b.deleted_at is null and b.assigned_item_id is null and b.piece_weight is not null
      -- closeness of the pair's sum first, similarity of the two pieces as tie-breaker
      order by abs(a.piece_weight + b.piece_weight - it.net_weight) + 0.25 * abs(a.piece_weight - b.piece_weight), a.huid, b.huid
      limit 3;
  end if;
end $$;
REVOKE ALL ON FUNCTION public.suggest_huids(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.suggest_huids(uuid, text) TO authenticated;

-- 5(a): a tag may carry any number of pieces; position <= item.pcs is enforced in assign_item_huids
ALTER TABLE public.item_huids DROP CONSTRAINT IF EXISTS item_huids_position_check;
ALTER TABLE public.item_huids ADD CONSTRAINT item_huids_position_check CHECK (position >= 1);
CREATE UNIQUE INDEX IF NOT EXISTS item_huids_item_position_active_uq ON public.item_huids(item_id, position) WHERE removed_at IS NULL;

-- 5(b): lot numbers are unique per branch, not globally
ALTER TABLE public.lots DROP CONSTRAINT IF EXISTS lots_lot_no_key;
ALTER TABLE public.lots ADD CONSTRAINT lots_branch_lot_no_key UNIQUE (branch_id, lot_no);