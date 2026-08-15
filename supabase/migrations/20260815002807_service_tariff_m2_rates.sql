insert into public.service_tariff_rates
  (version_id, service_slug, label, category, unit, rate, min_qty, min_billing, requires_quote, metadata)
select v.id, x.service_slug, x.label, 'almacenamiento', 'm2'::public.service_unit_t,
       null, 0, 0, true,
       jsonb_build_object('approval_state','A_COTIZAR','currency_conversion','forbidden')
from public.service_tariff_versions v
cross join (values
  ('alm-general','Almacenamiento Cargas Generales'),
  ('alm-anmat','Almacenamiento ANMAT')
) as x(service_slug,label)
where v.code = 'TOPS-OS-2026-01'
on conflict (version_id, service_slug) do update set
  label = excluded.label,
  category = excluded.category,
  unit = excluded.unit,
  rate = excluded.rate,
  min_qty = excluded.min_qty,
  min_billing = excluded.min_billing,
  requires_quote = excluded.requires_quote,
  metadata = excluded.metadata;

do $$
begin
  if (select count(*) from public.service_tariff_rates r
      join public.service_tariff_versions v on v.id=r.version_id
      where v.code='TOPS-OS-2026-01'
        and r.service_slug in ('alm-general','alm-anmat')
        and r.rate is null
        and r.requires_quote) <> 2 then
    raise exception 'No se pudieron materializar los dos conceptos m2 como A COTIZAR';
  end if;
end;
$$;

notify pgrst, 'reload schema';
