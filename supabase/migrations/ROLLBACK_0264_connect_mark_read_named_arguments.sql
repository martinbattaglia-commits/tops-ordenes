-- Rollback 0264 · restaura exactamente el wrapper sin nombres introducido por 0246.

drop function if exists public.connect_mark_read(uuid, bigint);

create function public.connect_mark_read(uuid, bigint) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.nexus_depot_manager_reject_legacy_connect();
  perform public.connect_mark_read_pre_0246($1, $2);
end
$$;

revoke all on function public.connect_mark_read(uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.connect_mark_read(uuid, bigint) to authenticated;

notify pgrst, 'reload schema';
