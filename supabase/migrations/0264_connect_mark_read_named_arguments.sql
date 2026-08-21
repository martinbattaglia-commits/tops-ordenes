-- 0264 · NEXUS Link: restaura los nombres públicos del RPC connect_mark_read.
--
-- 0246 recreó el wrapper como (uuid,bigint) sin nombres de argumentos. Aunque
-- PostgreSQL lo acepta, PostgREST no puede resolver el JSON nominal usado por
-- supabase-js (`p_conversation_id`, `p_up_to_seq`) y responde 404. La identidad
-- de tipos no cambia; sólo se restablece el contrato nominal original de 0144.

drop function if exists public.connect_mark_read(uuid, bigint);

create function public.connect_mark_read(
  p_conversation_id uuid,
  p_up_to_seq bigint
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.nexus_depot_manager_reject_legacy_connect();
  perform public.connect_mark_read_pre_0246(p_conversation_id, p_up_to_seq);
end
$$;

revoke all on function public.connect_mark_read(uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.connect_mark_read(uuid, bigint) to authenticated;

notify pgrst, 'reload schema';
