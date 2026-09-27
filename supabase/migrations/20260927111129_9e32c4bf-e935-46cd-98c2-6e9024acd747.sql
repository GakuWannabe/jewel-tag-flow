alter function public._is_service() set search_path = public;
select pg_get_functiondef('public.seal_sublot(uuid)'::regprocedure) like '%_is_service%' as ok;