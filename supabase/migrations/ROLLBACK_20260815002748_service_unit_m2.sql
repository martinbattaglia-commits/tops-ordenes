-- Rollback logico ejecutable de 20260815002748_service_unit_m2.sql.
-- PostgreSQL no permite retirar de forma segura un label de enum ya publicado.
-- Primero demuestra que ninguna fila conserva `m2`; luego deja el label inerte.

do $$
declare
  v_refs bigint;
begin
  select
    (select count(*) from public.services_catalog where unit='m2'::public.service_unit_t)
    + (select count(*) from public.order_services where unit='m2'::public.service_unit_t)
    + case when to_regclass('public.service_tariff_rates') is null then 0 else
        (select count(*) from public.service_tariff_rates where unit='m2'::public.service_unit_t)
      end
  into v_refs;

  if v_refs <> 0 then
    raise exception 'Rollback m2 bloqueado: % referencias activas; revierta primero tarifas y datos dependientes', v_refs;
  end if;
end;
$$;

-- El label queda deliberadamente huerfano e inerte.
select 1;
