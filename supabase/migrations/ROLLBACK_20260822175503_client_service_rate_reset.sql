-- Rollback fail-closed de 20260822175503_client_service_rate_reset.sql.
-- La regla anterior exigía una cola particular abierta. No puede restaurarse
-- si producción ya contiene una cadena cerrada por el nuevo RPC.

do $$
begin
  if exists (
    select 1
    from public.client_service_rates r
    where r.valid_to is not null
      and not exists (
        select 1
        from public.client_service_rates n
        where n.client_id = r.client_id
          and n.service_slug = r.service_slug
          and n.valid_from = r.valid_to
      )
  ) then
    raise exception 'ROLLBACK_BLOCKED: existen tarifas particulares restablecidas al tarifario general';
  end if;
end;
$$;

drop function if exists public.client_service_rate_reset(uuid, text, text);

create or replace function public._client_service_rate_timeline_ck()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('tops:service-pricing:tariff:v1', 0));
  perform pg_advisory_xact_lock(hashtextextended('tops:service-pricing:client-rate:v1', 0));
  if exists (
    with timeline as (
      select client_id, service_slug, valid_to,
             lead(valid_from) over (
               partition by client_id, service_slug order by valid_from, id
             ) as next_from
      from public.client_service_rates
    )
    select 1 from timeline where valid_to is distinct from next_from
  ) then
    raise exception 'CLIENT_SERVICE_RATE_TIMELINE_INVALID: hueco o solapamiento temporal';
  end if;
  return null;
end;
$$;

revoke all on function public._client_service_rate_timeline_ck()
  from public, anon, authenticated, service_role;
