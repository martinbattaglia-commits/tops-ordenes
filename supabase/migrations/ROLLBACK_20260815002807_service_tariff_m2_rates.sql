-- Este es el primer rollback hijo de la cadena. Repite el preflight de 0244
-- antes de cualquier DELETE y toma los locks en el mismo orden que las RPC.
-- La cadena completa debe ejecutarse dentro de una única transacción exterior.
do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('tops:service-pricing:tariff:v1', 0));
  perform pg_advisory_xact_lock(hashtextextended('tops:service-pricing:client-rate:v1', 0));
  lock table public.orders, public.order_services,
    public.service_tariff_versions, public.client_service_rates,
    public.service_order_events, public.service_order_billing_adjustments
    in share row exclusive mode;
  if exists (select 1 from public.orders where tariff_version_id is not null)
     or exists (select 1 from public.service_order_events)
     or exists (select 1 from public.service_order_billing_adjustments)
     or exists (select 1 from public.client_service_rates)
     or exists (
       select 1 from public.service_tariff_versions
       where code <> 'TOPS-OS-2026-01'
     ) then
    raise exception 'ROLLBACK_0244_BLOCKED: existen snapshots o vigencias que deben preservarse';
  end if;
end;
$$;

-- Revierte solamente las filas creadas por 20260815002807.
delete from public.service_tariff_rates r
using public.service_tariff_versions v
where r.version_id = v.id
  and v.code = 'TOPS-OS-2026-01'
  and r.service_slug in ('alm-general','alm-anmat');

-- `m2` se conserva en service_unit_t: PostgreSQL no permite quitar una
-- etiqueta de enum sin reconstruir el tipo y todas sus dependencias.
