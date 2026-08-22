-- Restablecimiento auditable de tarifas particulares al tarifario general.
-- Permite que una cadena particular termine de forma explícita: desde ese
-- instante vuelve a resolver la tarifa general, sin inventar una fila espejo.
-- Los huecos son, por contrato, períodos regidos por tarifa general; sólo se
-- rechazan solapamientos entre tramos particulares.

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
    select 1
    from timeline
    where next_from is not null
      and (valid_to is null or valid_to > next_from)
  ) then
    raise exception 'CLIENT_SERVICE_RATE_TIMELINE_INVALID: solapamiento temporal';
  end if;
  return null;
end;
$$;

create or replace function public.client_service_rate_reset(
  p_client_id uuid,
  p_service_slug text,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz;
  v_current public.client_service_rates%rowtype;
  v_deleted_future integer := 0;
  v_changed boolean := false;
begin
  if v_actor is null then
    raise exception 'Auth requerida' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = v_actor and p.active
  ) then
    raise exception 'Perfil activo requerido' using errcode = '42501';
  end if;
  if public.has_permission('servicios.edit') is distinct from true then
    raise exception 'Permiso requerido: servicios.edit' using errcode = '42501';
  end if;
  if p_client_id is null
     or length(btrim(coalesce(p_service_slug, ''))) not between 2 and 200
     or length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'Cliente, servicio y motivo de restablecimiento invalidos';
  end if;
  if not exists (
    select 1 from public.clients where id = p_client_id and coalesce(activo, true)
  ) then
    raise exception 'Cliente inexistente o inactivo';
  end if;

  perform pg_advisory_xact_lock_shared(hashtextextended('tops:service-pricing:tariff:v1', 0));
  perform pg_advisory_xact_lock(hashtextextended('tops:service-pricing:client-rate:v1', 0));
  v_now := clock_timestamp();

  -- Serializa todas las filas todavía vigentes o futuras del cliente/servicio.
  perform 1
  from public.client_service_rates
  where client_id = p_client_id
    and service_slug = btrim(p_service_slug)
    and (valid_to is null or valid_to > v_now)
  for update;

  select * into v_current
  from public.client_service_rates
  where client_id = p_client_id
    and service_slug = btrim(p_service_slug)
    and valid_from <= v_now
    and (valid_to is null or valid_to > v_now)
  order by valid_from desc, id desc
  limit 1
  for update;

  delete from public.client_service_rates
  where client_id = p_client_id
    and service_slug = btrim(p_service_slug)
    and valid_from > v_now;
  get diagnostics v_deleted_future = row_count;

  if v_current.id is not null then
    if v_current.valid_from = v_now then
      delete from public.client_service_rates where id = v_current.id;
    else
      update public.client_service_rates
      set valid_to = v_now
      where id = v_current.id;
    end if;
    v_changed := true;
  end if;
  v_changed := v_changed or v_deleted_future > 0;

  if not v_changed then
    return false;
  end if;

  insert into public.audit_log(user_id, entity, entity_id, action, payload)
  values (
    v_actor,
    'client_service_rates',
    p_client_id,
    'reset_to_list',
    jsonb_build_object(
      'client_id', p_client_id,
      'service_slug', btrim(p_service_slug),
      'closed_rate_id', v_current.id,
      'future_rates_cancelled', v_deleted_future,
      'effective_at', v_now,
      'business_timezone', 'America/Argentina/Buenos_Aires',
      'reason', btrim(p_reason)
    )
  );
  return true;
end;
$$;

revoke all on function public.client_service_rate_reset(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.client_service_rate_reset(uuid, text, text)
  to authenticated;

comment on function public.client_service_rate_reset(uuid, text, text) is
  'Cierra la tarifa particular vigente, cancela sucesoras futuras y restablece la tarifa general con auditoria.';
