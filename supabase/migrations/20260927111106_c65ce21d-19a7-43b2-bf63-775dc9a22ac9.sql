
create or replace function public._is_service() returns boolean language sql stable as $$ select coalesce(auth.role(),'') = 'service_role' $$;

do $$
declare src text;
begin
  -- allow the server-side bot API (service role) through the manager gate for seal + slot import
  select pg_get_functiondef('public.seal_sublot(uuid)'::regprocedure) into src;
  src := replace(src, 'if not public.is_mgr() then raise exception ''Manager only''; end if;', 'if not (public.is_mgr() or public._is_service()) then raise exception ''Manager only''; end if;');
  execute src;
  select pg_get_functiondef('public.import_tag_slots(uuid,jsonb,jsonb)'::regprocedure) into src;
  src := replace(src, 'if not public.is_mgr() then raise exception ''Manager only''; end if;', 'if not (public.is_mgr() or public._is_service()) then raise exception ''Manager only''; end if;');
  execute src;
end $$;

revoke execute on function public.seal_sublot(uuid) from public, anon;
revoke execute on function public.import_tag_slots(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.seal_sublot(uuid) to authenticated, service_role;
grant execute on function public.import_tag_slots(uuid,jsonb,jsonb) to authenticated, service_role;
