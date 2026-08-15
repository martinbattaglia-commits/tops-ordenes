-- =========================================================================
-- PR #66 · Ordenes de Servicio: tarifario versionado y ciclo de facturacion
--
-- Garantias:
--   · el navegador nunca decide la tarifa ni el total de una OS;
--   · tarifa general y precio particular se resuelven dentro de la RPC;
--   · tarifa, minimos y cantidades solicitadas quedan congelados al emitir;
--   · solicitado, prestado y facturado son magnitudes distintas;
--   · los ajustes de facturacion requieren motivo, autorizacion y ledger;
--   · snapshots, eventos y ajustes son append-only/inmutables.
-- =========================================================================

do $$ begin
  create type public.service_tariff_status_t as enum ('draft', 'active', 'superseded');
exception when duplicate_object then null; end $$;

create table if not exists public.service_tariff_versions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  currency text not null default 'ARS' check (currency in ('ARS', 'USD')),
  status public.service_tariff_status_t not null default 'draft',
  -- Ventana temporal exacta [effective_from, effective_to). `active` identifica
  -- solamente la cola publicada abierta (que puede comenzar en el futuro), no
  -- significa necesariamente "vigente en este instante".
  effective_from timestamptz not null,
  effective_to timestamptz,
  source_label text not null,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  activated_at timestamptz,
  activated_by uuid references auth.users(id) on delete set null,
  check (isfinite(effective_from)),
  check (effective_to is null or (isfinite(effective_to) and effective_to > effective_from)),
  check (
    (status = 'draft' and activated_at is null and activated_by is null and effective_to is null)
    or (status = 'active' and activated_at is not null and effective_to is null)
    or (status = 'superseded' and activated_at is not null and effective_to is not null)
  )
);

create unique index if not exists service_tariff_one_active_uk
  on public.service_tariff_versions ((status)) where status = 'active';

create table if not exists public.service_tariff_rates (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.service_tariff_versions(id) on delete restrict,
  service_slug text not null,
  label text not null,
  category text not null,
  unit public.service_unit_t not null,
  rate numeric(14,2),
  min_qty numeric(12,2) not null default 0
    check (min_qty >= 0 and min_qty < 'Infinity'::numeric),
  min_billing numeric(14,2) not null default 0
    check (min_billing >= 0 and min_billing < 'Infinity'::numeric),
  requires_quote boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (version_id, service_slug),
  check (
    (requires_quote and rate is null)
    or (
      not requires_quote and rate is not null
      and rate > 0 and rate < 'Infinity'::numeric
    )
  )
);

create table if not exists public.client_service_rates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  service_slug text not null,
  currency text not null default 'ARS' check (currency in ('ARS', 'USD')),
  rate numeric(14,2) not null
    check (rate > 0 and rate < 'Infinity'::numeric),
  min_qty numeric(12,2)
    check (min_qty is null or (min_qty >= 0 and min_qty < 'Infinity'::numeric)),
  min_billing numeric(14,2)
    check (min_billing is null or (min_billing >= 0 and min_billing < 'Infinity'::numeric)),
  -- Precio aprobado con ventana exacta [valid_from, valid_to). Una fila futura
  -- no deshabilita prematuramente su predecesora.
  valid_from timestamptz not null,
  valid_to timestamptz,
  reason text not null check (length(btrim(reason)) >= 3),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  check (isfinite(valid_from)),
  check (valid_to is null or (isfinite(valid_to) and valid_to > valid_from))
);

create unique index if not exists client_service_rates_open_uk
  on public.client_service_rates(client_id, service_slug)
  where valid_to is null;

create index if not exists client_service_rates_lookup_idx
  on public.client_service_rates(client_id, service_slug, valid_from desc);

-- La OS conserva el total solicitado/emitido. Prestado y facturado se completan
-- despues y nunca sustituyen el snapshot original.
alter table public.orders
  add column if not exists tariff_version_id uuid references public.service_tariff_versions(id) on delete restrict,
  add column if not exists pricing_currency text check (pricing_currency in ('ARS', 'USD')),
  add column if not exists pricing_snapshot_at timestamptz,
  add column if not exists issued_total numeric(14,2),
  add column if not exists provided_total numeric(14,2),
  add column if not exists billed_total numeric(14,2);

update public.orders
set pricing_snapshot_at = coalesce(pricing_snapshot_at, created_at, now()),
    issued_total = coalesce(issued_total, total)
where pricing_snapshot_at is null or issued_total is null;

alter table public.orders
  alter column pricing_snapshot_at set default now(),
  alter column pricing_snapshot_at set not null,
  alter column issued_total set default 0,
  alter column issued_total set not null;

alter table public.order_services
  add column if not exists tariff_rate_id uuid references public.service_tariff_rates(id) on delete restrict,
  add column if not exists client_rate_id uuid references public.client_service_rates(id) on delete restrict,
  add column if not exists price_source text,
  add column if not exists pricing_reason text,
  add column if not exists pricing_formula_snapshot jsonb,
  add column if not exists min_qty_snapshot numeric(12,2),
  add column if not exists min_billing_snapshot numeric(14,2),
  add column if not exists qty_requested numeric(12,2),
  add column if not exists qty_effective numeric(12,2),
  add column if not exists rate_snapshot numeric(14,2),
  add column if not exists subtotal_requested numeric(14,2),
  add column if not exists qty_provided numeric(12,2),
  add column if not exists subtotal_provided numeric(14,2),
  add column if not exists qty_billed numeric(12,2),
  add column if not exists subtotal_billed numeric(14,2),
  add column if not exists pricing_snapshot_at timestamptz;
alter table public.order_services
  add column if not exists currency_snapshot text check (currency_snapshot in ('ARS', 'USD'));
alter table public.order_services
  add column if not exists line_sequence integer;

with numbered as (
  select id, row_number() over (partition by order_id order by id)::integer as seq
  from public.order_services
)
update public.order_services os
set line_sequence = numbered.seq
from numbered
where os.id = numbered.id and os.line_sequence is null;

update public.order_services
set price_source = coalesce(price_source, 'legacy'),
    pricing_formula_snapshot = coalesce(pricing_formula_snapshot, '{"kind":"legacy"}'::jsonb),
    min_qty_snapshot = coalesce(min_qty_snapshot, 0),
    min_billing_snapshot = coalesce(min_billing_snapshot, 0),
    qty_requested = coalesce(qty_requested, qty),
    qty_effective = coalesce(qty_effective, qty),
    rate_snapshot = coalesce(rate_snapshot, rate),
    subtotal_requested = coalesce(subtotal_requested, subtotal),
    pricing_snapshot_at = coalesce(pricing_snapshot_at, now())
where price_source is null
   or pricing_formula_snapshot is null
   or min_qty_snapshot is null
   or min_billing_snapshot is null
   or qty_requested is null
   or qty_effective is null
   or rate_snapshot is null
   or subtotal_requested is null
   or pricing_snapshot_at is null;

alter table public.order_services
  alter column price_source set not null,
  alter column pricing_formula_snapshot set default '{"kind":"legacy"}'::jsonb,
  alter column pricing_formula_snapshot set not null,
  alter column min_qty_snapshot set default 0,
  alter column min_qty_snapshot set not null,
  alter column min_billing_snapshot set default 0,
  alter column min_billing_snapshot set not null,
  alter column qty_requested set not null,
  alter column qty_effective set not null,
  alter column rate_snapshot set not null,
  alter column subtotal_requested set not null,
  alter column line_sequence set not null,
  alter column pricing_snapshot_at set default now(),
  alter column pricing_snapshot_at set not null;

alter table public.order_services
  drop constraint if exists order_services_price_source_ck;
alter table public.order_services
  add constraint order_services_price_source_ck check (
    price_source in ('legacy', 'general_tariff', 'client_rate', 'derived', 'manual', 'bonification')
  );
alter table public.order_services
  drop constraint if exists order_services_pricing_formula_ck;
alter table public.order_services
  add constraint order_services_pricing_formula_ck check (
    jsonb_typeof(pricing_formula_snapshot) = 'object'
    and pricing_formula_snapshot->>'kind' in (
      'legacy', 'catalog_v1', 'transport_v1', 'derived_v1', 'manual_v1', 'bonification_v1'
    )
  );

create table if not exists public.service_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete restrict,
  order_service_id uuid references public.order_services(id) on delete restrict,
  event_kind text not null check (event_kind in ('issued', 'fulfillment_recorded', 'billing_adjusted')),
  reason text,
  actor_id uuid references auth.users(id) on delete set null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists service_order_events_order_idx
  on public.service_order_events(order_id, id);

create table if not exists public.service_order_billing_adjustments (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete restrict,
  order_service_id uuid not null references public.order_services(id) on delete restrict,
  prior_qty numeric(12,2),
  prior_amount numeric(14,2),
  billed_qty numeric(12,2) not null check (billed_qty >= 0),
  billed_amount numeric(14,2) not null check (billed_amount >= 0),
  delta_amount numeric(14,2) not null,
  reason text not null check (length(btrim(reason)) >= 3),
  authorized_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- Evidencia binaria exacta de la firma. El hash de `orders.signature_hash`
-- se calcula sobre estos mismos bytes dentro de `service_order_issue`; no se
-- acepta un digest declarado por el navegador ni se depende de que Storage
-- esté disponible para poder verificar una OS ya firmada.
create table if not exists public.service_order_signatures (
  order_id uuid primary key references public.orders(id) on delete restrict,
  png bytea not null check (octet_length(png) between 67 and 524288),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);

create index if not exists service_order_billing_adjustments_order_idx
  on public.service_order_billing_adjustments(order_id, id);

create or replace function public._service_order_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'El ledger de Ordenes de Servicio es append-only';
end;
$$;

drop trigger if exists trg_service_order_events_immutable on public.service_order_events;
create trigger trg_service_order_events_immutable
before update or delete on public.service_order_events
for each row execute function public._service_order_append_only();

drop trigger if exists trg_service_order_adjustments_immutable on public.service_order_billing_adjustments;
create trigger trg_service_order_adjustments_immutable
before update or delete on public.service_order_billing_adjustments
for each row execute function public._service_order_append_only();

drop trigger if exists trg_service_order_signatures_immutable on public.service_order_signatures;
create trigger trg_service_order_signatures_immutable
before update or delete on public.service_order_signatures
for each row execute function public._service_order_append_only();

drop trigger if exists trg_service_order_signatures_no_truncate on public.service_order_signatures;
create trigger trg_service_order_signatures_no_truncate
before truncate on public.service_order_signatures
for each statement execute function public._service_order_append_only();

create or replace function public._service_order_snapshot_immutable()
returns trigger language plpgsql as $$
declare
  v_mode text := current_setting('app.service_order_mutation', true);
begin
  if row(
    old.order_id, old.service_slug, old.label, old.qty, old.unit, old.rate, old.subtotal,
    old.tariff_rate_id, old.client_rate_id, old.price_source, old.pricing_reason,
    old.pricing_formula_snapshot,
    old.min_qty_snapshot, old.min_billing_snapshot, old.qty_requested,
    old.qty_effective, old.rate_snapshot, old.subtotal_requested, old.line_sequence,
    old.pricing_snapshot_at, old.currency_snapshot
  ) is distinct from row(
    new.order_id, new.service_slug, new.label, new.qty, new.unit, new.rate, new.subtotal,
    new.tariff_rate_id, new.client_rate_id, new.price_source, new.pricing_reason,
    new.pricing_formula_snapshot,
    new.min_qty_snapshot, new.min_billing_snapshot, new.qty_requested,
    new.qty_effective, new.rate_snapshot, new.subtotal_requested, new.line_sequence,
    new.pricing_snapshot_at, new.currency_snapshot
  ) then
    raise exception 'El snapshot emitido de la OS es inmutable';
  end if;

  if row(old.qty_provided, old.subtotal_provided, old.qty_billed, old.subtotal_billed)
     is distinct from
     row(new.qty_provided, new.subtotal_provided, new.qty_billed, new.subtotal_billed)
     and v_mode not in ('fulfillment', 'billing') then
    raise exception 'Prestacion y facturacion solo pueden cambiar mediante RPC autorizada';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_service_order_snapshot_immutable on public.order_services;
create trigger trg_service_order_snapshot_immutable
before update on public.order_services
for each row execute function public._service_order_snapshot_immutable();

create or replace function public._service_order_header_snapshot_immutable()
returns trigger language plpgsql as $$
begin
  if row(
    old.depot, old.client_id, old.operator_id, old.h_start, old.h_end,
    old.hours, old.pallets, old.units, old.km, old.observ,
    old.total, old.issued_total, old.tariff_version_id,
    old.pricing_currency, old.pricing_snapshot_at, old.created_by
  ) is distinct from row(
    new.depot, new.client_id, new.operator_id, new.h_start, new.h_end,
    new.hours, new.pallets, new.units, new.km, new.observ,
    new.total, new.issued_total, new.tariff_version_id,
    new.pricing_currency, new.pricing_snapshot_at, new.created_by
  ) and exists (
    select 1 from public.service_order_events e
    where e.order_id = old.id and e.event_kind = 'issued'
  ) then
    raise exception 'La cabecera y el total emitido de la OS son inmutables';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_service_order_header_snapshot_immutable on public.orders;
create trigger trg_service_order_header_snapshot_immutable
before update on public.orders
for each row execute function public._service_order_header_snapshot_immutable();

-- Nuevo permiso: no se concede a encargados de deposito. Las tarifas manuales
-- y los ajustes posteriores quedan reservados a Director/Admin.
insert into public.permissions (slug, module, action, label, description)
values (
  'servicios.edit', 'servicios', 'edit', 'Ajustar facturacion de OS',
  'Autorizar precios manuales y diferencias entre solicitado, prestado y facturado'
)
on conflict (slug) do update set
  label = excluded.label,
  description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.slug = 'servicios.edit'
where r.slug in ('director_ops', 'admin')
on conflict do nothing;

-- Tarifario de partida: transcripcion de los catalogos que ya usa Nexus.
-- Los conceptos "a cotizar" son NULL, nunca cero ni un precio inventado.
insert into public.service_tariff_versions (
  code, currency, status, effective_from, source_label, notes, activated_at
) values (
  'TOPS-OS-2026-01', 'ARS', 'active',
  (timestamp '2026-01-01 00:00:00' at time zone 'America/Argentina/Buenos_Aires'),
  'TARIFARIO TOPS ENERO 2026 + TARIFARIO TRANSPORTE FEBRERO 2026',
  'Version inicial normalizada desde los catalogos vigentes ya incorporados en Nexus.',
  now()
)
on conflict (code) do nothing;

insert into public.service_tariff_rates
  (version_id, service_slug, label, category, unit, rate, min_qty, min_billing, requires_quote, metadata)
select v.id, x.service_slug, x.label, x.category, x.unit::public.service_unit_t,
       x.rate, x.min_qty, x.min_billing, x.requires_quote, x.metadata
from public.service_tariff_versions v
cross join (values
  ('peon','Peon por hora','personal','hs',30000::numeric,4::numeric,0::numeric,false,'{}'::jsonb),
  ('autoelevador-unas','Autoelevador con unas','especial','hs',79000,2,0,false,'{}'),
  ('autoelevador-clamp','Autoelevador con clamp','especial','hs',90000,2,0,false,'{}'),
  ('palletizado-enfilmado','Palletizado y enfilmado','especial','un',28000,0,0,false,'{}'),
  ('enfilmado','Enfilmado solo','especial','un',16000,0,0,false,'{}'),
  ('picking','Picking (preparacion de pedidos)','carga','m3',8000,0,43000,false,'{}'),
  ('carga-palletizada','Carga palletizada a camion','carga','m3',8000,0,43000,false,'{}'),
  ('carga-suelta','Carga suelta a camion','carga','m3',9000,0,71000,false,'{}'),
  ('desconso-20-pal','Desconsolidado 20 palletizado','desconsolidado','un',390000,0,0,false,'{}'),
  ('desconso-40-pal','Desconsolidado 40 palletizado','desconsolidado','un',450000,0,0,false,'{}'),
  ('desconso-40hc-pal','Desconsolidado 40 HC palletizado','desconsolidado','un',520000,0,0,false,'{}'),
  ('desconso-20-trasbordo','Desconsolidado y trasbordo 20','desconsolidado','un',480000,0,0,false,'{}'),
  ('desconso-40-trasbordo','Desconsolidado y trasbordo 40','desconsolidado','un',650000,0,0,false,'{}'),
  ('desconso-chasis-20m3','Desconsolidado chasis (hasta 20 m3)','desconsolidado','un',137000,0,0,false,'{}'),
  -- Las dos tarifas por m2 se siembran en 20260815002807, despues de que
  -- 20260815002748 agregue la etiqueta al enum en una transaccion separada.
  ('oficina-privada','Oficina privada','coworking','mes',null,0,0,true,'{}'),
  ('coworking-individual','Puesto coworking individual','coworking','mes',null,0,0,true,'{}'),
  ('coworking-isla-6','Isla coworking 6 personas','coworking','mes',null,0,0,true,'{}'),
  ('coworking-isla-4','Isla coworking 4 personas','coworking','mes',null,0,0,true,'{}'),
  ('coworking-isla-3','Isla coworking 3 personas','coworking','mes',null,0,0,true,'{}'),
  ('admin-in','Gastos administrativos - Entrada','admin','un',45000,0,0,false,'{}'),
  ('admin-out','Gastos administrativos - Salida','admin','un',32000,0,0,false,'{}'),
  ('transporte:qubo:CABA','Qubo - CABA a CABA','transporte','viaje',203000,0,0,false,'{"vehicle":"qubo","zone":"CABA"}'),
  ('transporte:qubo:40KM','Qubo - hasta 40 km','transporte','viaje',223000,0,0,false,'{"vehicle":"qubo","zone":"40KM"}'),
  ('transporte:qubo:60KM','Qubo - hasta 60 km','transporte','viaje',243000,0,0,false,'{"vehicle":"qubo","zone":"60KM"}'),
  ('transporte:qubo:80KM','Qubo - hasta 80 km','transporte','viaje',264000,0,0,false,'{"vehicle":"qubo","zone":"80KM"}'),
  ('transporte:qubo:100KM','Qubo - hasta 100 km','transporte','viaje',286000,0,0,false,'{"vehicle":"qubo","zone":"100KM"}'),
  ('transporte:qubo:MAS_100','Qubo - más de 100 km','transporte','viaje',null,0,0,true,'{"vehicle":"qubo","zone":"MAS_100"}'),
  ('transporte:chasis-710:CABA','Chasis 710 - CABA a CABA','transporte','viaje',325000,0,0,false,'{"vehicle":"chasis-710","zone":"CABA"}'),
  ('transporte:chasis-710:40KM','Chasis 710 - hasta 40 km','transporte','viaje',353000,0,0,false,'{"vehicle":"chasis-710","zone":"40KM"}'),
  ('transporte:chasis-710:60KM','Chasis 710 - hasta 60 km','transporte','viaje',394000,0,0,false,'{"vehicle":"chasis-710","zone":"60KM"}'),
  ('transporte:chasis-710:80KM','Chasis 710 - hasta 80 km','transporte','viaje',420000,0,0,false,'{"vehicle":"chasis-710","zone":"80KM"}'),
  ('transporte:chasis-710:100KM','Chasis 710 - hasta 100 km','transporte','viaje',448000,0,0,false,'{"vehicle":"chasis-710","zone":"100KM"}'),
  ('transporte:chasis-710:MAS_100','Chasis 710 - más de 100 km','transporte','viaje',null,0,0,true,'{"vehicle":"chasis-710","zone":"MAS_100"}'),
  ('transporte:balancin-1720:CABA','Balancin 1720 - CABA a CABA','transporte','viaje',436000,0,0,false,'{"vehicle":"balancin-1720","zone":"CABA"}'),
  ('transporte:balancin-1720:40KM','Balancin 1720 - hasta 40 km','transporte','viaje',476000,0,0,false,'{"vehicle":"balancin-1720","zone":"40KM"}'),
  ('transporte:balancin-1720:60KM','Balancin 1720 - hasta 60 km','transporte','viaje',524000,0,0,false,'{"vehicle":"balancin-1720","zone":"60KM"}'),
  ('transporte:balancin-1720:80KM','Balancin 1720 - hasta 80 km','transporte','viaje',544000,0,0,false,'{"vehicle":"balancin-1720","zone":"80KM"}'),
  ('transporte:balancin-1720:100KM','Balancin 1720 - hasta 100 km','transporte','viaje',612000,0,0,false,'{"vehicle":"balancin-1720","zone":"100KM"}'),
  ('transporte:balancin-1720:MAS_100','Balancin 1720 - más de 100 km','transporte','viaje',null,0,0,true,'{"vehicle":"balancin-1720","zone":"MAS_100"}'),
  ('transporte:semi:CABA','Semi - CABA a CABA','transporte','viaje',null,0,0,true,'{"vehicle":"semi","zone":"CABA"}'),
  ('transporte:semi:40KM','Semi - hasta 40 km','transporte','viaje',null,0,0,true,'{"vehicle":"semi","zone":"40KM"}'),
  ('transporte:semi:60KM','Semi - hasta 60 km','transporte','viaje',null,0,0,true,'{"vehicle":"semi","zone":"60KM"}'),
  ('transporte:semi:80KM','Semi - hasta 80 km','transporte','viaje',null,0,0,true,'{"vehicle":"semi","zone":"80KM"}'),
  ('transporte:semi:100KM','Semi - hasta 100 km','transporte','viaje',null,0,0,true,'{"vehicle":"semi","zone":"100KM"}'),
  ('transporte:semi:MAS_100','Semi - más de 100 km','transporte','viaje',null,0,0,true,'{"vehicle":"semi","zone":"MAS_100"}')
) as x(service_slug,label,category,unit,rate,min_qty,min_billing,requires_quote,metadata)
where v.code = 'TOPS-OS-2026-01'
on conflict (version_id, service_slug) do nothing;

-- Convierte una fecha de negocio a un instante inequívoco de Buenos Aires.
-- Para "hoy" nunca retrocede a medianoche: la vigencia comienza después de
-- adquirir los locks y validar el pedido. Una fecha futura comienza exactamente
-- a las 00:00 de Argentina.
create or replace function public._service_pricing_boundary(
  p_day date,
  p_now timestamptz
) returns timestamptz
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  v_today date := (p_now at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if p_day is null then
    raise exception 'Vigencia obligatoria';
  end if;
  if p_day < v_today then
    raise exception 'No se permite retrotraer una vigencia publicada';
  end if;
  if p_day = v_today then
    return p_now;
  end if;
  return p_day::timestamp at time zone 'America/Argentina/Buenos_Aires';
end;
$$;

-- Invariante global: las versiones publicadas forman una cadena continua y
-- exacta. La única fila `active` es la cola abierta; las filas cerradas siguen
-- siendo resolubles como `superseded` dentro de su ventana.
create or replace function public._service_tariff_timeline_ck()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_active_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('tops:service-pricing:tariff:v1', 0));
  select count(*) filter (where status = 'active')
    into v_active_count
  from public.service_tariff_versions
  where status in ('active', 'superseded');
  if v_active_count <> 1 then
    raise exception 'SERVICE_TARIFF_TIMELINE_INVALID: debe existir una unica cola publicada';
  end if;
  if exists (
    with timeline as (
      select effective_to,
             lead(effective_from) over (order by effective_from, id) as next_from
      from public.service_tariff_versions
      where status in ('active', 'superseded')
    )
    select 1 from timeline where effective_to is distinct from next_from
  ) then
    raise exception 'SERVICE_TARIFF_TIMELINE_INVALID: hueco o solapamiento temporal';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_service_tariff_timeline_ck on public.service_tariff_versions;
create constraint trigger trg_service_tariff_timeline_ck
after insert or update or delete on public.service_tariff_versions
deferrable initially deferred
for each row execute function public._service_tariff_timeline_ck();

-- Invariante por cliente/concepto: desde el primer precio particular aprobado,
-- cada sucesor comienza exactamente cuando termina el anterior. Antes de ese
-- primer instante se usa explícitamente la tarifa general.
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

drop trigger if exists trg_client_service_rate_timeline_ck on public.client_service_rates;
create constraint trigger trg_client_service_rate_timeline_ck
after insert or update or delete on public.client_service_rates
deferrable initially deferred
for each row execute function public._client_service_rate_timeline_ck();

-- Validador PNG completo para la evidencia de firma de OS: recorre chunks,
-- valida CRC, dimensiones, orden IHDR/IDAT/IEND y ausencia de bytes extra.
create or replace function public._service_order_png_crc32(p_bytes bytea)
returns bigint language plpgsql immutable strict set search_path = pg_catalog as $$
declare
  v_crc bigint := 4294967295;
  v_i integer;
  v_bit integer;
begin
  if octet_length(p_bytes) > 524288 then return -1; end if;
  for v_i in 0..octet_length(p_bytes)-1 loop
    v_crc := (v_crc # get_byte(p_bytes,v_i)) & 4294967295;
    for v_bit in 1..8 loop
      if (v_crc & 1) = 1 then
        v_crc := ((v_crc >> 1) # 3988292384) & 4294967295;
      else
        v_crc := (v_crc >> 1) & 4294967295;
      end if;
    end loop;
  end loop;
  return (v_crc # 4294967295) & 4294967295;
end;
$$;

create or replace function public._service_order_png_is_valid(p_png bytea)
returns boolean language plpgsql immutable strict set search_path = pg_catalog as $$
declare
  v_len integer := octet_length(p_png);
  v_pos integer := 8;
  v_chunk_len integer;
  v_type text;
  v_stored_crc bigint;
  v_width bigint;
  v_height bigint;
  v_seen_ihdr boolean := false;
  v_seen_idat boolean := false;
  v_seen_iend boolean := false;
begin
  if v_len < 67 or v_len > 524288
     or substring(p_png from 1 for 8) <> decode('89504e470d0a1a0a','hex') then
    return false;
  end if;
  while v_pos + 12 <= v_len loop
    v_chunk_len := get_byte(p_png,v_pos)::bigint * 16777216
      + get_byte(p_png,v_pos+1)::bigint * 65536
      + get_byte(p_png,v_pos+2)::bigint * 256
      + get_byte(p_png,v_pos+3)::bigint;
    if v_chunk_len > 524288 or v_pos + 12 + v_chunk_len > v_len then return false; end if;
    begin
      v_type := convert_from(substring(p_png from v_pos+5 for 4),'UTF8');
    exception when others then
      return false;
    end;
    v_stored_crc := get_byte(p_png,v_pos+8+v_chunk_len)::bigint * 16777216
      + get_byte(p_png,v_pos+9+v_chunk_len)::bigint * 65536
      + get_byte(p_png,v_pos+10+v_chunk_len)::bigint * 256
      + get_byte(p_png,v_pos+11+v_chunk_len)::bigint;
    if public._service_order_png_crc32(substring(p_png from v_pos+5 for 4+v_chunk_len))
       is distinct from v_stored_crc then return false; end if;

    if not v_seen_ihdr then
      if v_type <> 'IHDR' or v_chunk_len <> 13 then return false; end if;
      v_width := get_byte(p_png,v_pos+8)::bigint * 16777216
        + get_byte(p_png,v_pos+9)::bigint * 65536
        + get_byte(p_png,v_pos+10)::bigint * 256
        + get_byte(p_png,v_pos+11)::bigint;
      v_height := get_byte(p_png,v_pos+12)::bigint * 16777216
        + get_byte(p_png,v_pos+13)::bigint * 65536
        + get_byte(p_png,v_pos+14)::bigint * 256
        + get_byte(p_png,v_pos+15)::bigint;
      if v_width < 1 or v_height < 1 or v_width > 2048 or v_height > 2048
         or v_width * v_height > 4194304
         or get_byte(p_png,v_pos+18) <> 0
         or get_byte(p_png,v_pos+19) <> 0
         or get_byte(p_png,v_pos+20) not in (0,1) then return false; end if;
      v_seen_ihdr := true;
    elsif v_type = 'IDAT' then
      if v_chunk_len = 0 or v_seen_iend then return false; end if;
      v_seen_idat := true;
    elsif v_type = 'IEND' then
      if v_chunk_len <> 0 or not v_seen_idat or v_pos + 12 <> v_len then return false; end if;
      v_seen_iend := true;
    elsif ascii(substr(v_type,1,1)) between 65 and 90 and v_type <> 'PLTE' then
      return false;
    end if;
    v_pos := v_pos + 12 + v_chunk_len;
    exit when v_seen_iend;
  end loop;
  return v_seen_ihdr and v_seen_idat and v_seen_iend and v_pos = v_len;
end;
$$;

revoke all on function public._service_order_png_crc32(bytea)
  from public, anon, authenticated, service_role;
revoke all on function public._service_order_png_is_valid(bytea)
  from public, anon, authenticated, service_role;

create or replace function public.service_order_issue(p_order jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_order_id uuid;
  v_public_id text;
  v_short_id integer;
  v_order_date timestamptz;
  v_version public.service_tariff_versions%rowtype;
  v_line jsonb;
  v_rate public.service_tariff_rates%rowtype;
  v_client_rate public.client_service_rates%rowtype;
  v_service_id uuid;
  v_kind text;
  v_canonical_kind text;
  v_slug text;
  v_label text;
  v_unit public.service_unit_t;
  v_source text;
  v_reason text;
  v_q_req numeric;
  v_q_eff numeric;
  v_price numeric;
  v_subtotal numeric;
  v_min_qty numeric;
  v_min_billing numeric;
  v_total numeric := 0;
  v_transport_total numeric := 0;
  v_surcharge numeric;
  v_second_trip_discount boolean;
  v_formula jsonb;
  v_client_id uuid;
  v_client_total numeric;
  v_line_sequence integer := 0;
  v_urgent_seen boolean := false;
  v_pricing_at timestamptz;
  v_key text;
  v_signature_b64 text;
  v_signature_bytes bytea;
  v_signature_hash text;
begin
  if v_actor is null then raise exception 'Auth requerida'; end if;
  if not exists (
    select 1 from public.profiles p where p.id = v_actor and p.active
  ) then
    raise exception 'Perfil activo requerido' using errcode = '42501';
  end if;
  if public.has_permission('servicios.create') is distinct from true
     or public.has_permission('servicios.sign') is distinct from true then
    raise exception 'Permisos requeridos: servicios.create y servicios.sign';
  end if;
  if coalesce(jsonb_typeof(p_order), 'missing') <> 'object' then
    raise exception 'La cabecera de la OS debe ser un objeto';
  end if;
  if coalesce(jsonb_typeof(p_lines), 'missing') <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'La OS requiere al menos un servicio';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_lines) candidate
     where candidate ->> 'pricing_kind' in ('manual','bonification')
  ) and public.has_permission('servicios.edit') is distinct from true then
    raise exception 'Permiso requerido para precio manual: servicios.edit';
  end if;
  if coalesce(jsonb_typeof(p_order->'client_id'), 'missing') <> 'string'
     or coalesce(p_order->>'client_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(jsonb_typeof(p_order->'operator_id'), 'missing') <> 'string'
     or coalesce(p_order->>'operator_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(jsonb_typeof(p_order->'expected_tariff_version_id'), 'missing') <> 'string'
     or coalesce(p_order->>'expected_tariff_version_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Identidad canónica de OS inválida';
  end if;
  if coalesce(jsonb_typeof(p_order->'client_total'), 'missing') <> 'number' then
    raise exception 'Total firmado inválido';
  end if;
  v_client_total := (p_order->>'client_total')::numeric;
  if v_client_total < 0 or v_client_total >= 1000000000000
     or v_client_total <> round(v_client_total, 2) then
    raise exception 'Total firmado inválido';
  end if;
  if coalesce(jsonb_typeof(p_order->'depot'),'missing') <> 'string'
     or p_order->>'depot' not in ('MAGALDI','LUJAN')
     or coalesce(jsonb_typeof(p_order->'signed_by'),'missing') <> 'string'
     or length(btrim(coalesce(p_order->>'signed_by',''))) not between 2 and 120
     or p_order ? 'signature_hash'
     or coalesce(jsonb_typeof(p_order->'signature_data_url'),'missing') <> 'string'
     or coalesce(p_order->>'signature_data_url','') !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$'
     or (p_order ? 'signed_doc' and coalesce(jsonb_typeof(p_order->'signed_doc'),'null') not in ('string','null'))
     or length(coalesce(p_order->>'signed_doc','')) > 100
     or (p_order ? 'observ' and coalesce(jsonb_typeof(p_order->'observ'),'null') not in ('string','null'))
     or length(coalesce(p_order->>'observ','')) > 2000
     or (p_order ? 'ip' and coalesce(jsonb_typeof(p_order->'ip'),'null') not in ('string','null'))
     or length(coalesce(p_order->>'ip','')) > 64 then
    raise exception 'Depósito o firma de OS inválidos';
  end if;
  v_signature_b64 := substr(p_order->>'signature_data_url', 23);
  if length(v_signature_b64) < 4 or length(v_signature_b64) > 700000
     or length(v_signature_b64) % 4 <> 0 then
    raise exception 'Firma PNG inválida';
  end if;
  begin
    v_signature_bytes := decode(v_signature_b64, 'base64');
  exception when others then
    raise exception 'Firma PNG inválida';
  end;
  if not public._service_order_png_is_valid(v_signature_bytes) then
    raise exception 'Firma PNG inválida';
  end if;
  v_signature_hash := encode(sha256(v_signature_bytes), 'hex');
  foreach v_key in array array['hours','pallets','units','km'] loop
    if coalesce(jsonb_typeof(p_order->v_key), 'missing') <> 'number'
       or coalesce(p_order->>v_key,'') !~ '^\d+$' then
      raise exception 'Magnitud operativa inválida en %', v_key;
    end if;
  end loop;
  if coalesce(jsonb_typeof(p_order->'h_start'), 'missing') <> 'string'
     or coalesce(jsonb_typeof(p_order->'h_end'), 'missing') <> 'string'
     or coalesce(p_order->>'h_start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or coalesce(p_order->>'h_end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or (p_order ? 'geo_lat' and coalesce(jsonb_typeof(p_order->'geo_lat'),'null') not in ('number','null'))
     or (p_order ? 'geo_lng' and coalesce(jsonb_typeof(p_order->'geo_lng'),'null') not in ('number','null')) then
    raise exception 'Horario o geolocalización inválidos';
  end if;

  -- Orden universal de locks: tarifario general y luego particulares. La
  -- captura del instante ocurre DESPUES de esperar, por lo que una emision no
  -- puede congelar la version vieja atravesando el commit de una publicacion.
  perform pg_advisory_xact_lock_shared(hashtextextended('tops:service-pricing:tariff:v1', 0));
  perform pg_advisory_xact_lock_shared(hashtextextended('tops:service-pricing:client-rate:v1', 0));
  v_pricing_at := clock_timestamp();

  v_client_id := (p_order->>'client_id')::uuid;
  if not exists (select 1 from public.clients where id = v_client_id and coalesce(activo, true)) then
    raise exception 'Cliente inexistente o inactivo';
  end if;

  select * into strict v_version
  from public.service_tariff_versions
  where status in ('active', 'superseded')
    and effective_from <= v_pricing_at
    and (effective_to is null or effective_to > v_pricing_at);
  if (p_order->>'expected_tariff_version_id')::uuid <> v_version.id then
    raise exception 'El tarifario cambio durante la firma; recargue y revise el total';
  end if;

  insert into public.orders (
    depot, client_id, operator_id, h_start, h_end, hours, pallets, units, km,
    observ, total, issued_total, tariff_version_id, pricing_currency, pricing_snapshot_at, status,
    signed_by, signed_doc, signed_at, signature_hash, geo_lat, geo_lng, ip, created_by
  ) values (
    (p_order->>'depot')::public.depot_t,
    v_client_id,
    nullif(p_order->>'operator_id','')::uuid,
    p_order->>'h_start', p_order->>'h_end', coalesce((p_order->>'hours')::int,0),
    coalesce((p_order->>'pallets')::int,0), coalesce((p_order->>'units')::int,0),
    coalesce((p_order->>'km')::int,0), nullif(p_order->>'observ',''),
    0, 0, v_version.id, v_version.currency, v_pricing_at, 'FIRMADA',
    p_order->>'signed_by', nullif(p_order->>'signed_doc',''), now(),
    v_signature_hash, nullif(p_order->>'geo_lat','')::double precision,
    nullif(p_order->>'geo_lng','')::double precision, nullif(p_order->>'ip',''), v_actor
  ) returning id, public_id, short_id, date
    into v_order_id, v_public_id, v_short_id, v_order_date;

  insert into public.service_order_signatures(order_id,png,sha256,created_at)
  values (v_order_id,v_signature_bytes,v_signature_hash,v_pricing_at);

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_sequence := v_line_sequence + 1;
    if coalesce(jsonb_typeof(v_line), 'missing') <> 'object' then
      raise exception 'Cada línea de OS debe ser un objeto';
    end if;
    v_kind := v_line->>'pricing_kind';
    v_slug := btrim(coalesce(v_line->>'service_slug',''));
    if v_kind not in ('catalog','transport','urgent','manual','bonification')
       or length(v_slug) < 2 or length(v_slug) > 200 then
      raise exception 'Identidad de línea de OS inválida';
    end if;
    v_reason := nullif(btrim(coalesce(v_line->>'pricing_reason','')), '');
    if coalesce(jsonb_typeof(v_line->'qty_requested'), 'missing') <> 'number' then
      raise exception 'Cantidad solicitada inválida';
    end if;
    v_q_req := (v_line->>'qty_requested')::numeric;
    if v_q_req <= 0 or v_q_req >= 10000000000 or v_q_req <> round(v_q_req, 2) then
      raise exception 'Cantidad solicitada inválida';
    end if;
    v_service_id := gen_random_uuid();
    v_formula := '{"kind":"legacy"}'::jsonb;

    if v_kind in ('catalog','transport') then
      select * into v_rate
      from public.service_tariff_rates
      where version_id = v_version.id and service_slug = v_slug;
      if not found then raise exception 'Servicio fuera del tarifario vigente: %', v_slug; end if;
      v_canonical_kind := case
        when v_rate.service_slug like 'transporte:%' then 'transport'
        else 'catalog'
      end;
      if v_kind <> v_canonical_kind then
        raise exception 'Tipo de precio no coincide con el servicio canónico';
      end if;
      if coalesce(jsonb_typeof(v_line->'expected_tariff_rate_id'), 'missing') <> 'string'
         or coalesce(v_line->>'expected_tariff_rate_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         or (v_line->>'expected_tariff_rate_id')::uuid <> v_rate.id then
        raise exception 'La tarifa del servicio cambio durante la firma; recargue la orden';
      end if;
      if coalesce(jsonb_typeof(v_line->'expected_client_rate_id'), 'null') not in ('string','null')
         or (
           jsonb_typeof(v_line->'expected_client_rate_id') = 'string'
           and (v_line->>'expected_client_rate_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         ) then
        raise exception 'Identidad de precio particular inválida';
      end if;

      select * into v_client_rate
      from public.client_service_rates
      where client_id = v_client_id and service_slug = v_slug
        and currency = v_version.currency
        and valid_from <= v_pricing_at and (valid_to is null or valid_to > v_pricing_at)
      order by valid_from desc, created_at desc limit 1;

      if found then
        if nullif(v_line->>'expected_client_rate_id','') is null
           or (v_line->>'expected_client_rate_id')::uuid <> v_client_rate.id then
          raise exception 'El precio particular cambio durante la firma; recargue la orden';
        end if;
        v_price := v_client_rate.rate;
        v_min_qty := coalesce(v_client_rate.min_qty, v_rate.min_qty);
        v_min_billing := coalesce(v_client_rate.min_billing, v_rate.min_billing);
        v_source := 'client_rate';
      else
        if nullif(v_line->>'expected_client_rate_id','') is not null then
          raise exception 'El precio particular esperado ya no esta vigente; recargue la orden';
        end if;
        if v_rate.rate is null then
          raise exception 'El servicio % requiere cotizacion o precio particular vigente', v_slug;
        end if;
        v_price := v_rate.rate;
        v_min_qty := v_rate.min_qty;
        v_min_billing := v_rate.min_billing;
        v_source := 'general_tariff';
      end if;
      v_label := v_rate.label;
      v_unit := v_rate.unit;
      v_q_eff := greatest(v_q_req, v_min_qty);
      v_subtotal := round(greatest(v_q_eff * v_price, v_min_billing), 2);
      v_formula := jsonb_build_object('kind','catalog_v1');

      if v_kind = 'transport' then
        if v_q_req <> trunc(v_q_req) or v_q_eff <> trunc(v_q_eff) then
          raise exception 'Los viajes y sus mínimos deben ser enteros';
        end if;
        if coalesce(jsonb_typeof(v_line->'second_trip_discount'), 'missing') <> 'boolean' then
          raise exception 'Descuento de segundo viaje inválido';
        end if;
        v_second_trip_discount := coalesce((v_line->>'second_trip_discount')::boolean,false);
        if v_second_trip_discount and v_q_eff >= 2 then
          v_subtotal := v_price + ((v_q_eff - 1) * v_price * 0.5);
        else
          v_subtotal := v_price * v_q_eff;
        end if;
        v_subtotal := greatest(v_subtotal, v_min_billing);
        v_surcharge := case coalesce(v_line->>'surcharge','none')
          when 'none' then 0 when '17_19' then 0.25 when '19_21' then 0.50 when '21_plus' then 1.00
          else null end;
        if v_surcharge is null then raise exception 'Recargo de transporte invalido'; end if;
        v_subtotal := round(v_subtotal * (1 + v_surcharge), 2);
        v_formula := jsonb_build_object(
          'kind','transport_v1',
          'second_trip_discount',v_second_trip_discount,
          'surcharge_pct',v_surcharge
        );
        v_transport_total := v_transport_total + v_subtotal;
      end if;
    elsif v_kind = 'urgent' then
      if v_slug <> 'recargo-envio-urgente'
         or v_q_req <> 1
         or v_urgent_seen
         or v_line_sequence <> jsonb_array_length(p_lines)
         or v_transport_total <= 0 then
        raise exception 'Recargo urgente sin transporte previo';
      end if;
      v_urgent_seen := true;
      v_label := 'Recargo envio urgente (+100%)'; v_unit := 'un';
      v_source := 'derived'; v_q_req := 1; v_q_eff := 1;
      v_price := v_transport_total; v_subtotal := v_transport_total;
      v_min_qty := 0; v_min_billing := 0;
      v_reason := 'Despacho prioritario para ejecucion el mismo dia';
      v_formula := jsonb_build_object('kind','derived_v1','basis','transport_total');
      v_rate.id := null; v_client_rate.id := null;
    elsif v_kind in ('manual','bonification') then
      if v_reason is null or length(v_reason) < 3 then raise exception 'El precio manual requiere motivo'; end if;
      v_label := left(coalesce(nullif(btrim(v_line->>'label'),''), v_slug), 200);
      v_unit := coalesce(nullif(v_line->>'unit',''),'un')::public.service_unit_t;
      v_q_eff := v_q_req; v_min_qty := 0; v_min_billing := 0;
      if coalesce(jsonb_typeof(v_line->'manual_rate'), 'missing') <> 'number'
         or coalesce(jsonb_typeof(v_line->'manual_subtotal'), 'missing') <> 'number' then
        raise exception 'Precio manual inválido';
      end if;
      v_price := (v_line->>'manual_rate')::numeric;
      v_subtotal := round(v_q_req * v_price, 2);
      if v_price <> round(v_price, 2) or abs(v_price) >= 1000000000000
         or (v_line->>'manual_subtotal')::numeric is distinct from v_subtotal then
        raise exception 'Precio o subtotal manual inconsistente';
      end if;
      if v_kind = 'manual' and (v_price <= 0 or v_subtotal <= 0) then raise exception 'Precio manual invalido'; end if;
      if v_kind = 'bonification' and (v_price >= 0 or v_subtotal >= 0) then raise exception 'Bonificacion invalida'; end if;
      v_source := v_kind;
      v_formula := jsonb_build_object(
        'kind', case when v_kind='manual' then 'manual_v1' else 'bonification_v1' end
      );
      v_rate.id := null; v_client_rate.id := null;
    else
      raise exception 'Tipo de precio de servicio invalido: %', v_kind;
    end if;

    insert into public.order_services (
      id, order_id, service_slug, label, qty, unit, rate, subtotal,
      tariff_rate_id, client_rate_id, price_source, pricing_reason,
      pricing_formula_snapshot,
      min_qty_snapshot, min_billing_snapshot, qty_requested, qty_effective,
      rate_snapshot, subtotal_requested, line_sequence, pricing_snapshot_at,
      currency_snapshot
    ) values (
      v_service_id, v_order_id, v_slug, v_label, v_q_eff, v_unit, v_price, v_subtotal,
      v_rate.id, v_client_rate.id, v_source, v_reason,
      v_formula,
      v_min_qty, v_min_billing, v_q_req, v_q_eff, v_price, v_subtotal, v_line_sequence, v_pricing_at,
      v_version.currency
    );
    v_total := v_total + v_subtotal;
    v_rate.id := null; v_client_rate.id := null;
  end loop;

  if v_total < 0 then raise exception 'El total emitido de la OS no puede ser negativo'; end if;
  if v_total is distinct from v_client_total then
    raise exception 'El total firmado no coincide con el calculo autoritativo (% vs %)',
      v_client_total, v_total;
  end if;
  update public.orders set total = v_total, issued_total = v_total where id = v_order_id;

  insert into public.service_order_events(order_id, event_kind, actor_id, payload, created_at)
  values (v_order_id, 'issued', v_actor, jsonb_build_object(
    'tariff_version_id', v_version.id, 'tariff_code', v_version.code,
    'currency', v_version.currency, 'issued_total', v_total,
    'signature_hash', v_signature_hash,
    'line_count', jsonb_array_length(p_lines), 'pricing_snapshot_at', v_pricing_at
  ), v_pricing_at);
  insert into public.audit_log(user_id, entity, entity_id, action, payload, ip)
  values (v_actor, 'orders', v_order_id, 'create_signed_pricing_snapshot',
    jsonb_build_object('tariff_version_id', v_version.id, 'currency', v_version.currency,
      'issued_total', v_total),
    nullif(p_order->>'ip',''));

  return jsonb_build_object('id', v_order_id, 'public_id', v_public_id,
    'short_id', v_short_id, 'date', v_order_date, 'total', v_total,
    'tariff_version_id', v_version.id, 'tariff_code', v_version.code,
    'currency', v_version.currency, 'signature_hash', v_signature_hash);
end;
$$;

-- ── Outbox idempotente de correos de OS ────────────────────────────────
-- UNIQUE(order_id,tag) viene de 0075. La clave de transporte se deriva de
-- esa identidad. Las dos RPC verifican además el claim `service_role`:
-- ningún usuario autenticado puede convertirlas en un relay de correo.
create or replace function public._service_order_email_sends_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_mode text := current_setting('app.service_order_email_mutation', true);
begin
  if tg_op = 'DELETE' then
    raise exception 'El outbox de OS es append-only';
  end if;
  if v_mode not in ('prepare','finalize') then
    raise exception 'El outbox de OS sólo cambia mediante RPC autorizada';
  end if;
  if row(new.id,new.order_id,new.tag,new.to_email)
     is distinct from row(old.id,old.order_id,old.tag,old.to_email) then
    raise exception 'La identidad del intento de email es inmutable';
  end if;
  if old.status = 'sent' and row(new.status,new.provider_id,new.sent_at)
     is distinct from row(old.status,old.provider_id,old.sent_at) then
    raise exception 'Un envío confirmado es inmutable';
  end if;
  if old.status is distinct from new.status and not (
    (old.status = 'queued' and new.status in ('sent','failed','unknown'))
    or (old.status = 'failed' and new.status = 'queued')
    or (old.status = 'unknown' and new.status in ('queued','sent','failed'))
  ) then
    raise exception 'Transición inválida del outbox de OS: % -> %', old.status, new.status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_service_order_email_sends_guard on public.email_sends;
create trigger trg_service_order_email_sends_guard
before update or delete on public.email_sends
for each row execute function public._service_order_email_sends_guard();

create or replace function public.service_order_prepare_email_delivery(
  p_order_id uuid,
  p_tag text,
  p_internal_to text default null,
  p_retry_unknown boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_to text;
  v_attempt text;
  v_row public.email_sends%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'SERVICE_ORDER_EMAIL_SERVICE_ONLY' using errcode='42501';
  end if;
  if p_tag not in ('depot','director','facturacion','cliente') then
    raise exception 'SERVICE_ORDER_EMAIL_TAG_INVALID';
  end if;
  perform 1 from public.orders where id=p_order_id for update;
  if not found then raise exception 'SERVICE_ORDER_EMAIL_ORDER_NOT_FOUND'; end if;

  if p_tag = 'cliente' then
    select lower(btrim(c.email)) into v_to
    from public.orders o join public.clients c on c.id=o.client_id
    where o.id=p_order_id and coalesce(c.activo,true);
  else
    v_to := lower(btrim(coalesce(p_internal_to,'')));
  end if;
  if coalesce(v_to,'') !~ '^[^[:space:]<>,;@]+@[^[:space:]<>,;@]+\.[^[:space:]<>,;@]+$'
     or length(v_to) > 254 then
    raise exception 'SERVICE_ORDER_EMAIL_RECIPIENT_INVALID';
  end if;

  v_attempt := 'service-order/' || p_order_id::text || '/' || p_tag;
  insert into public.email_sends(order_id,to_email,tag,status,provider_id,error,sent_at)
  values (p_order_id,v_to,p_tag,'queued',null,null,null)
  on conflict (order_id,tag) do nothing;

  select * into strict v_row from public.email_sends
  where order_id=p_order_id and tag=p_tag for update;
  if v_row.to_email is distinct from v_to then
    raise exception 'SERVICE_ORDER_EMAIL_RECIPIENT_CHANGED';
  end if;
  if v_row.status = 'failed' or (v_row.status = 'unknown' and p_retry_unknown) then
    perform set_config('app.service_order_email_mutation','prepare',true);
    update public.email_sends
       set status='queued',provider_id=null,error=null,sent_at=null
     where id=v_row.id returning * into v_row;
  end if;
  return jsonb_build_object(
    'attempt_key',v_attempt,'status',v_row.status,
    'to_email',v_row.to_email,'provider_id',v_row.provider_id
  );
end;
$$;

create or replace function public.service_order_finalize_email_delivery(
  p_order_id uuid,
  p_tag text,
  p_attempt_key text,
  p_status text,
  p_provider_id text default null,
  p_error_code text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_expected text := 'service-order/' || p_order_id::text || '/' || p_tag;
  v_row public.email_sends%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'SERVICE_ORDER_EMAIL_SERVICE_ONLY' using errcode='42501';
  end if;
  if p_tag not in ('depot','director','facturacion','cliente')
     or p_attempt_key is distinct from v_expected
     or p_status not in ('sent','failed','unknown') then
    raise exception 'SERVICE_ORDER_EMAIL_FINALIZE_INVALID';
  end if;
  select * into strict v_row from public.email_sends
  where order_id=p_order_id and tag=p_tag for update;

  if p_status = 'sent' then
    if length(btrim(coalesce(p_provider_id,''))) not between 2 and 200 then
      raise exception 'SERVICE_ORDER_EMAIL_PROVIDER_ID_INVALID';
    end if;
    if v_row.status = 'sent' then
      if v_row.provider_id is distinct from p_provider_id then
        raise exception 'SERVICE_ORDER_EMAIL_REPLAY_CONFLICT';
      end if;
      return jsonb_build_object('status','sent','provider_id',v_row.provider_id);
    end if;
  elsif coalesce(p_error_code,'') !~ '^[A-Z0-9_]{3,80}$' then
    raise exception 'SERVICE_ORDER_EMAIL_ERROR_CODE_INVALID';
  end if;

  perform set_config('app.service_order_email_mutation','finalize',true);
  update public.email_sends
     set status=p_status,
         provider_id=case when p_status='sent' then p_provider_id else null end,
         error=case when p_status='sent' then null else p_error_code end,
         sent_at=case when p_status='sent' then clock_timestamp() else null end
   where id=v_row.id and status in ('queued','unknown')
   returning * into v_row;
  if not found then raise exception 'SERVICE_ORDER_EMAIL_STATE_CONFLICT'; end if;
  return jsonb_build_object('status',v_row.status,'provider_id',v_row.provider_id);
end;
$$;

revoke all on function public._service_order_email_sends_guard()
  from public, anon, authenticated, service_role;
revoke all on function public.service_order_prepare_email_delivery(uuid,text,text,boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.service_order_finalize_email_delivery(uuid,text,text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_order_prepare_email_delivery(uuid,text,text,boolean)
  to service_role;
grant execute on function public.service_order_finalize_email_delivery(uuid,text,text,text,text,text)
  to service_role;

create or replace function public.service_order_record_fulfillment(
  p_order_service_id uuid, p_qty_provided numeric, p_reason text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_order_id uuid;
  v_line public.order_services%rowtype;
  v_amount numeric;
  v_effective_qty numeric;
  v_base numeric;
  v_discount boolean;
  v_surcharge numeric;
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
    raise exception 'Permiso requerido: servicios.edit';
  end if;
  if p_qty_provided is null
     or p_qty_provided < 0 or p_qty_provided >= 10000000000
     or p_qty_provided <> round(p_qty_provided, 2)
     or length(btrim(coalesce(p_reason,''))) < 3 then
    raise exception 'Cantidad prestada y motivo son obligatorios';
  end if;
  select order_id into strict v_order_id
  from public.order_services where id = p_order_service_id;
  -- Orden universal: cabecera primero, línea después. Todas las líneas de una
  -- OS serializan el recálculo del agregado y no pueden pisarse entre sí.
  perform 1 from public.orders where id = v_order_id for update;
  select * into strict v_line from public.order_services where id = p_order_service_id for update;
  -- La prestacion conserva la regla economica congelada. Para lineas
  -- derivadas/manuales se prorratea el subtotal emitido; para tarifas de
  -- catalogo se reaplican minimo de cantidad y minimo facturable. Cero
  -- prestado siempre es cero y nunca dispara un minimo ficticio.
  if p_qty_provided = 0 then
    v_amount := 0;
  elsif v_line.pricing_formula_snapshot->>'kind' = 'transport_v1' then
    if p_qty_provided <> trunc(p_qty_provided) then
      raise exception 'La cantidad prestada de viajes debe ser entera';
    end if;
    v_effective_qty := greatest(p_qty_provided, v_line.min_qty_snapshot);
    if v_effective_qty <> trunc(v_effective_qty) then
      raise exception 'El mínimo congelado de viajes debe ser entero';
    end if;
    v_discount := coalesce(
      (v_line.pricing_formula_snapshot->>'second_trip_discount')::boolean,
      false
    );
    v_surcharge := coalesce(
      (v_line.pricing_formula_snapshot->>'surcharge_pct')::numeric,
      0
    );
    if v_surcharge not in (0,0.25,0.50,1.00) then
      raise exception 'Snapshot de recargo de transporte inválido';
    end if;
    v_base := case
      when v_discount and v_effective_qty >= 2
        then v_line.rate_snapshot + ((v_effective_qty - 1) * v_line.rate_snapshot * 0.5)
      else v_effective_qty * v_line.rate_snapshot
    end;
    v_amount := round(greatest(v_base, v_line.min_billing_snapshot) * (1 + v_surcharge), 2);
  elsif v_line.price_source in ('general_tariff', 'client_rate') then
    v_amount := round(greatest(
      greatest(p_qty_provided, v_line.min_qty_snapshot) * v_line.rate_snapshot,
      v_line.min_billing_snapshot
    ), 2);
  else
    v_amount := round(
      case when v_line.qty_requested = 0 then 0
           else v_line.subtotal_requested * p_qty_provided / v_line.qty_requested end,
      2
    );
  end if;
  perform set_config('app.service_order_mutation','fulfillment',true);
  update public.order_services set qty_provided = p_qty_provided, subtotal_provided = v_amount
  where id = p_order_service_id;
  update public.orders o set provided_total = s.total
  from (select order_id, sum(subtotal_provided) total from public.order_services
        where order_id = v_line.order_id group by order_id) s
  where o.id = s.order_id;
  insert into public.service_order_events(order_id, order_service_id, event_kind, reason, actor_id, payload)
  values (v_line.order_id, v_line.id, 'fulfillment_recorded', btrim(p_reason), v_actor,
    jsonb_build_object('qty_requested',v_line.qty_requested,'qty_provided',p_qty_provided,
      'subtotal_requested',v_line.subtotal_requested,'subtotal_provided',v_amount,
      'pricing_formula_snapshot',v_line.pricing_formula_snapshot,
      'currency',v_line.currency_snapshot));
  insert into public.audit_log(user_id,entity,entity_id,action,payload)
  values (v_actor,'orders',v_line.order_id,'service_fulfillment_recorded',
    jsonb_build_object('order_service_id',v_line.id,'qty_provided',p_qty_provided,'reason',btrim(p_reason)));
end;
$$;

create or replace function public.service_order_adjust_billing(
  p_order_service_id uuid, p_billed_qty numeric, p_billed_amount numeric, p_reason text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_order_id uuid;
  v_line public.order_services%rowtype;
  v_signed_amount numeric;
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
    raise exception 'Permiso requerido: servicios.edit';
  end if;
  if p_billed_qty is null or p_billed_amount is null
     or p_billed_qty < 0 or p_billed_qty >= 10000000000
     or p_billed_qty <> round(p_billed_qty, 2)
     or p_billed_amount < 0 or p_billed_amount >= 1000000000000
     or p_billed_amount <> round(p_billed_amount, 2)
     or length(btrim(coalesce(p_reason,''))) < 3 then
    raise exception 'Cantidad, importe y motivo de facturacion son obligatorios';
  end if;
  select order_id into strict v_order_id
  from public.order_services where id = p_order_service_id;
  perform 1 from public.orders where id = v_order_id for update;
  select * into strict v_line from public.order_services where id = p_order_service_id for update;
  -- La UI declara una magnitud no negativa. Sólo PostgreSQL determina el signo
  -- de una bonificación y nunca permite superar el descuento ya firmado.
  if v_line.price_source = 'bonification' then
    if p_billed_amount > abs(v_line.subtotal_requested) then
      raise exception 'La bonificación facturada excede el snapshot emitido';
    end if;
    v_signed_amount := -p_billed_amount;
  else
    v_signed_amount := p_billed_amount;
  end if;
  insert into public.service_order_billing_adjustments(
    order_id, order_service_id, prior_qty, prior_amount, billed_qty, billed_amount,
    delta_amount, reason, authorized_by
  ) values (
    v_line.order_id, v_line.id, v_line.qty_billed, v_line.subtotal_billed,
    p_billed_qty, p_billed_amount, v_signed_amount - coalesce(v_line.subtotal_billed,0),
    btrim(p_reason), v_actor
  );
  perform set_config('app.service_order_mutation','billing',true);
  update public.order_services set qty_billed = p_billed_qty, subtotal_billed = v_signed_amount
  where id = p_order_service_id;
  update public.orders o set billed_total = s.total
  from (select order_id, sum(subtotal_billed) total from public.order_services
        where order_id = v_line.order_id group by order_id) s
  where o.id = s.order_id;
  insert into public.service_order_events(order_id, order_service_id, event_kind, reason, actor_id, payload)
  values (v_line.order_id, v_line.id, 'billing_adjusted', btrim(p_reason), v_actor,
    jsonb_build_object('prior_qty',v_line.qty_billed,'prior_amount',v_line.subtotal_billed,
      'billed_qty',p_billed_qty,'billed_amount',v_signed_amount,
      'billed_magnitude',p_billed_amount,
      'issued_amount',v_line.subtotal_requested,'provided_amount',v_line.subtotal_provided,
      'currency',v_line.currency_snapshot));
  insert into public.audit_log(user_id,entity,entity_id,action,payload)
  values (v_actor,'orders',v_line.order_id,'service_billing_adjusted',
    jsonb_build_object('order_service_id',v_line.id,'billed_amount',v_signed_amount,
      'billed_magnitude',p_billed_amount,'reason',btrim(p_reason)));
end;
$$;

-- Publica una nueva version completa del tarifario. La funcion valida todos
-- los renglones y reemplaza la version activa en una unica transaccion; no hay
-- pasos manuales entre superseder y activar.
create or replace function public.service_tariff_publish(
  p_code text,
  p_currency text,
  p_effective_from date,
  p_source_label text,
  p_reason text,
  p_rates jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_version_id uuid;
  v_currency text := upper(btrim(coalesce(p_currency,'')));
  v_rate jsonb;
  v_slug text;
  v_requires_quote boolean;
  v_amount numeric;
  v_count integer := 0;
  v_now timestamptz;
  v_start timestamptz;
  v_tail public.service_tariff_versions%rowtype;
  v_existing public.service_tariff_versions%rowtype;
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
    raise exception 'Permiso requerido: servicios.edit';
  end if;
  if length(btrim(coalesce(p_code,''))) < 3
     or length(btrim(coalesce(p_source_label,''))) < 3
     or length(btrim(coalesce(p_reason,''))) < 3 then
    raise exception 'Codigo, fuente aprobada y motivo son obligatorios';
  end if;
  if v_currency not in ('ARS','USD') then raise exception 'Moneda invalida'; end if;
  if p_effective_from is null then raise exception 'Vigencia obligatoria'; end if;
  if coalesce(jsonb_typeof(p_rates), 'missing') <> 'array' or jsonb_array_length(p_rates) = 0 then
    raise exception 'El tarifario debe contener al menos un renglon';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rates) r
    group by btrim(r->>'service_slug') having count(*) > 1
  ) then
    raise exception 'El tarifario contiene servicios duplicados';
  end if;

  -- Validar la totalidad del payload antes de tocar la cola publicada.
  for v_rate in select value from jsonb_array_elements(p_rates) loop
    if coalesce(jsonb_typeof(v_rate), 'missing') <> 'object'
       or coalesce(jsonb_typeof(v_rate->'service_slug'), 'missing') <> 'string'
       or coalesce(jsonb_typeof(v_rate->'label'), 'missing') <> 'string'
       or coalesce(jsonb_typeof(v_rate->'category'), 'missing') <> 'string'
       or coalesce(jsonb_typeof(v_rate->'unit'), 'missing') <> 'string'
       or coalesce(jsonb_typeof(v_rate->'requires_quote'), 'missing') <> 'boolean' then
      raise exception 'Renglon de tarifario malformado';
    end if;
    v_slug := btrim(coalesce(v_rate->>'service_slug',''));
    v_requires_quote := coalesce((v_rate->>'requires_quote')::boolean,false);
    if (v_requires_quote and coalesce(jsonb_typeof(v_rate->'rate'), 'null') <> 'null')
       or (not v_requires_quote and coalesce(jsonb_typeof(v_rate->'rate'), 'missing') <> 'number')
       or (v_rate ? 'min_qty' and coalesce(jsonb_typeof(v_rate->'min_qty'), 'missing') <> 'number')
       or (v_rate ? 'min_billing' and coalesce(jsonb_typeof(v_rate->'min_billing'), 'missing') <> 'number')
       or (v_rate ? 'metadata' and coalesce(jsonb_typeof(v_rate->'metadata'), 'missing') <> 'object') then
      raise exception 'Precio o minimos de tarifario malformados para %', v_slug;
    end if;
    v_amount := nullif(v_rate->>'rate','')::numeric;
    if length(v_slug) < 2
       or length(btrim(coalesce(v_rate->>'label',''))) < 2
       or length(btrim(coalesce(v_rate->>'category',''))) < 2 then
      raise exception 'Renglon de tarifario incompleto';
    end if;
    if not (
      (
        v_slug like 'transporte:%'
        and btrim(v_rate->>'category') = 'transporte'
        and v_rate->>'unit' = 'viaje'
      )
      or (
        v_slug not like 'transporte:%'
        and btrim(v_rate->>'category') <> 'transporte'
        and v_rate->>'unit' <> 'viaje'
      )
    ) then
      raise exception 'Identidad canónica de transporte inválida para %', v_slug;
    end if;
    if (v_requires_quote and v_amount is not null)
       or (not v_requires_quote and (v_amount is null or v_amount <= 0))
       or (v_amount is not null and (v_amount >= 1000000000000 or v_amount <> round(v_amount,2))) then
      raise exception 'Precio incompatible con A COTIZAR para %', v_slug;
    end if;
    if coalesce(nullif(v_rate->>'min_qty','')::numeric,0) < 0
       or coalesce(nullif(v_rate->>'min_qty','')::numeric,0) >= 10000000000
       or coalesce(nullif(v_rate->>'min_qty','')::numeric,0) <>
          round(coalesce(nullif(v_rate->>'min_qty','')::numeric,0),2)
       or coalesce(nullif(v_rate->>'min_billing','')::numeric,0) < 0
       or coalesce(nullif(v_rate->>'min_billing','')::numeric,0) >= 1000000000000
       or coalesce(nullif(v_rate->>'min_billing','')::numeric,0) <>
          round(coalesce(nullif(v_rate->>'min_billing','')::numeric,0),2)
       or (
         v_slug like 'transporte:%'
         and coalesce(nullif(v_rate->>'min_qty','')::numeric,0) <>
             trunc(coalesce(nullif(v_rate->>'min_qty','')::numeric,0))
       ) then
      raise exception 'Minimos invalidos para %', v_slug;
    end if;
    perform (v_rate->>'unit')::public.service_unit_t;
    v_count := v_count + 1;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('tops:service-pricing:tariff:v1', 0));
  v_now := clock_timestamp();

  -- Replay exacto por `code`: devuelve la misma identidad sin reabrir ventanas
  -- ni duplicar auditoria. El mismo codigo con cualquier dato distinto falla.
  select * into v_existing
  from public.service_tariff_versions
  where code = btrim(p_code);
  if found then
    if v_existing.currency <> v_currency
       or (v_existing.effective_from at time zone 'America/Argentina/Buenos_Aires')::date <> p_effective_from
       or v_existing.source_label <> btrim(p_source_label)
       or coalesce(v_existing.notes,'') <> btrim(p_reason)
       or (select count(*) from public.service_tariff_rates where version_id=v_existing.id) <> v_count
       or exists (
         select 1
         from jsonb_array_elements(p_rates) x
         where not exists (
           select 1 from public.service_tariff_rates r
           where r.version_id=v_existing.id
             and r.service_slug=btrim(x->>'service_slug')
             and r.label=btrim(x->>'label')
             and r.category=btrim(x->>'category')
             and r.unit=(x->>'unit')::public.service_unit_t
             and r.rate is not distinct from nullif(x->>'rate','')::numeric
             and r.min_qty=coalesce(nullif(x->>'min_qty','')::numeric,0)
             and r.min_billing=coalesce(nullif(x->>'min_billing','')::numeric,0)
             and r.requires_quote=coalesce((x->>'requires_quote')::boolean,false)
             and r.metadata=coalesce(x->'metadata','{}'::jsonb)
         )
       ) then
      raise exception 'El codigo de tarifario ya existe con otro contenido';
    end if;
    return v_existing.id;
  end if;

  v_start := public._service_pricing_boundary(p_effective_from, v_now);
  select * into strict v_tail
  from public.service_tariff_versions
  where status='active'
  for update;
  if v_start <= v_tail.effective_from then
    raise exception 'La nueva vigencia debe ser posterior a la cola publicada';
  end if;

  -- Cada versión es un tarifario completo. Omitir un concepto de la cola
  -- anterior lo haría desaparecer al comenzar la nueva ventana. Para retirarlo
  -- económicamente debe conservarse explícitamente como A COTIZAR.
  if exists (
    select 1
      from public.service_tariff_rates previous_rate
     where previous_rate.version_id = v_tail.id
       and not exists (
         select 1
           from jsonb_array_elements(p_rates) next_rate
          where btrim(next_rate->>'service_slug') = previous_rate.service_slug
       )
  ) then
    raise exception 'El tarifario completo debe incluir todos los conceptos de la versión anterior; use A COTIZAR para retirar un importe';
  end if;

  -- Un tarifario futuro no puede invalidar precios particulares que sigan
  -- abiertos con otra moneda o con un concepto eliminado.
  if exists (
    select 1
    from public.client_service_rates c
    where (c.valid_to is null or c.valid_to > v_start)
      and (
        c.currency <> v_currency
        or not exists (
          select 1 from jsonb_array_elements(p_rates) x
          where btrim(x->>'service_slug') = c.service_slug
        )
        or exists (
          select 1
          from public.service_tariff_rates old_rate
          join jsonb_array_elements(p_rates) x
            on btrim(x->>'service_slug') = old_rate.service_slug
          where old_rate.version_id = v_tail.id
            and old_rate.service_slug = c.service_slug
            and (
              old_rate.unit <> (x->>'unit')::public.service_unit_t
              or (
                c.min_qty is null
                and old_rate.min_qty <> coalesce(nullif(x->>'min_qty','')::numeric,0)
              )
              or (
                c.min_billing is null
                and old_rate.min_billing <> coalesce(nullif(x->>'min_billing','')::numeric,0)
              )
            )
        )
      )
  ) then
    raise exception 'El tarifario futuro es incompatible con precios particulares aprobados';
  end if;

  update public.service_tariff_versions
  set status='superseded', effective_to=v_start
  where id=v_tail.id;

  insert into public.service_tariff_versions(
    code,currency,status,effective_from,source_label,notes,created_by,activated_at,activated_by
  ) values (
    btrim(p_code),v_currency,'active',v_start,btrim(p_source_label),btrim(p_reason),
    v_actor,v_now,v_actor
  ) returning id into v_version_id;

  for v_rate in select value from jsonb_array_elements(p_rates) loop
    v_slug := btrim(v_rate->>'service_slug');
    v_requires_quote := coalesce((v_rate->>'requires_quote')::boolean,false);
    v_amount := nullif(v_rate->>'rate','')::numeric;
    insert into public.service_tariff_rates(
      version_id,service_slug,label,category,unit,rate,min_qty,min_billing,
      requires_quote,metadata
    ) values (
      v_version_id,v_slug,btrim(v_rate->>'label'),btrim(v_rate->>'category'),
      (v_rate->>'unit')::public.service_unit_t,v_amount,
      coalesce(nullif(v_rate->>'min_qty','')::numeric,0),
      coalesce(nullif(v_rate->>'min_billing','')::numeric,0),
      v_requires_quote,coalesce(v_rate->'metadata','{}'::jsonb)
    );
  end loop;

  insert into public.audit_log(user_id,entity,entity_id,action,payload)
  values (v_actor,'service_tariff_versions',v_version_id,'publish',jsonb_build_object(
    'code',btrim(p_code),'currency',v_currency,'effective_from',v_start,
    'predecessor_id',v_tail.id,'predecessor_effective_to',v_start,
    'business_timezone','America/Argentina/Buenos_Aires',
    'source_label',btrim(p_source_label),'reason',btrim(p_reason),'rate_count',v_count
  ));
  return v_version_id;
end;
$$;

-- Aprueba un precio particular explícito para un cliente. La moneda debe ser
-- exactamente la de la version general activa; una conversion entre monedas
-- nunca se infiere ni se ejecuta dentro de Nexus.
create or replace function public.client_service_rate_set(
  p_client_id uuid,
  p_service_slug text,
  p_currency text,
  p_rate numeric,
  p_min_qty numeric,
  p_min_billing numeric,
  p_valid_from date,
  p_reason text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_currency text;
  v_now timestamptz;
  v_start timestamptz;
  v_tail public.client_service_rates%rowtype;
  v_existing_rate public.client_service_rates%rowtype;
  v_base_rate public.service_tariff_rates%rowtype;
  v_base_rate_id uuid;
  v_requested_day date;
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
    raise exception 'Permiso requerido: servicios.edit';
  end if;
  if p_rate is null or p_rate <= 0 or p_rate >= 1000000000000
     or p_rate <> round(p_rate, 2)
     or p_min_qty is not null and (
       p_min_qty < 0 or p_min_qty >= 10000000000 or p_min_qty <> round(p_min_qty, 2)
     )
     or p_min_billing is not null and (
       p_min_billing < 0 or p_min_billing >= 1000000000000
       or p_min_billing <> round(p_min_billing, 2)
     )
     or length(btrim(coalesce(p_service_slug,''))) < 2
     or length(btrim(coalesce(p_service_slug,''))) > 200
     or length(btrim(coalesce(p_reason,''))) < 3 then
    raise exception 'Precio, minimos y motivo de aprobacion invalidos';
  end if;
  if not exists (select 1 from public.clients where id=p_client_id and coalesce(activo,true)) then
    raise exception 'Cliente inexistente o inactivo';
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('tops:service-pricing:tariff:v1', 0));
  perform pg_advisory_xact_lock(hashtextextended('tops:service-pricing:client-rate:v1', 0));
  v_now := clock_timestamp();
  v_requested_day := coalesce(
    p_valid_from,
    (v_now at time zone 'America/Argentina/Buenos_Aires')::date
  );

  -- La idempotencia se resuelve contra toda la genealogía, no sólo contra la
  -- cola abierta. Un retry de A sigue devolviendo A aunque B ya esté programada.
  select * into v_existing_rate
  from public.client_service_rates
  where client_id=p_client_id and service_slug=btrim(p_service_slug)
    and (valid_from at time zone 'America/Argentina/Buenos_Aires')::date=v_requested_day
  order by valid_from, id
  limit 1
  for update;
  if found then
    if v_existing_rate.currency=upper(btrim(coalesce(p_currency,'')))
       and v_existing_rate.rate=p_rate
       and v_existing_rate.min_qty is not distinct from p_min_qty
       and v_existing_rate.min_billing is not distinct from p_min_billing
       and v_existing_rate.reason=btrim(p_reason) then
      return v_existing_rate.id;
    end if;
    raise exception 'Ya existe un precio particular aprobado para esa fecha con otro contenido';
  end if;
  v_start := public._service_pricing_boundary(
    v_requested_day,
    v_now
  );

  select v.currency, r.id into strict v_currency, v_base_rate_id
  from public.service_tariff_versions v
  join public.service_tariff_rates r on r.version_id=v.id
  where v.status in ('active','superseded') and r.service_slug=btrim(p_service_slug)
    and v.effective_from <= v_start
    and (v.effective_to is null or v.effective_to > v_start);
  select * into strict v_base_rate
  from public.service_tariff_rates
  where id = v_base_rate_id;
  if upper(btrim(coalesce(p_currency,''))) <> v_currency then
    raise exception 'La moneda % no coincide con el tarifario activo %', p_currency, v_currency;
  end if;

  -- Aprobar y publicar en cualquier orden debe conservar la misma garantía:
  -- la cola particular abierta no puede cruzar una versión general futura
  -- con otra moneda, concepto, unidad o mínimos heredados.
  if exists (
    select 1
    from public.service_tariff_versions v
    left join public.service_tariff_rates r
      on r.version_id = v.id and r.service_slug = btrim(p_service_slug)
    where v.status in ('active','superseded')
      and (v.effective_to is null or v.effective_to > v_start)
      and (
        v.currency <> v_currency
        or r.id is null
        or r.unit <> v_base_rate.unit
        or (p_min_qty is null and r.min_qty <> v_base_rate.min_qty)
        or (p_min_billing is null and r.min_billing <> v_base_rate.min_billing)
      )
  ) then
    raise exception 'Precio particular incompatible con tarifarios futuros publicados';
  end if;

  select * into v_tail
  from public.client_service_rates
  where client_id=p_client_id and service_slug=btrim(p_service_slug)
    and valid_to is null
  for update;
  if found and v_start <= v_tail.valid_from then
    raise exception 'La nueva vigencia particular debe ser posterior a la cola aprobada';
  end if;
  if found then
    update public.client_service_rates
    set valid_to=v_start
    where id=v_tail.id;
  end if;

  insert into public.client_service_rates(
    client_id,service_slug,currency,rate,min_qty,min_billing,valid_from,
    reason,created_by
  ) values (
    p_client_id,btrim(p_service_slug),v_currency,p_rate,p_min_qty,p_min_billing,
    v_start,btrim(p_reason),v_actor
  ) returning id into v_id;

  insert into public.audit_log(user_id,entity,entity_id,action,payload)
  values (v_actor,'client_service_rates',v_id,'approve',jsonb_build_object(
    'client_id',p_client_id,'service_slug',btrim(p_service_slug),
    'currency',v_currency,'rate',p_rate,'min_qty',p_min_qty,
    'min_billing',p_min_billing,'valid_from',v_start,
    'predecessor_id',v_tail.id,'business_timezone','America/Argentina/Buenos_Aires',
    'reason',btrim(p_reason)
  ));
  return v_id;
end;
$$;

alter table public.service_tariff_versions enable row level security;
alter table public.service_tariff_rates enable row level security;
alter table public.client_service_rates enable row level security;
alter table public.service_order_events enable row level security;
alter table public.service_order_billing_adjustments enable row level security;
alter table public.service_order_signatures enable row level security;

drop policy if exists "service order signatures service read" on public.service_order_signatures;
create policy "service order signatures service read" on public.service_order_signatures
  for select to service_role using (true);

drop policy if exists "service tariff authenticated read" on public.service_tariff_versions;
create policy "service tariff authenticated read" on public.service_tariff_versions
  for select to authenticated using (true);
drop policy if exists "service rates authenticated read" on public.service_tariff_rates;
create policy "service rates authenticated read" on public.service_tariff_rates
  for select to authenticated using (true);
drop policy if exists "client service rates authorized read" on public.client_service_rates;
create policy "client service rates authorized read" on public.client_service_rates
  for select to authenticated using (
    public.has_permission('servicios.create') or public.has_permission('servicios.edit')
  );
drop policy if exists "service order events authorized read" on public.service_order_events;
create policy "service order events authorized read" on public.service_order_events
  for select to authenticated using (
    public.has_permission('servicios.view')
  );
drop policy if exists "service billing adjustments authorized read" on public.service_order_billing_adjustments;
create policy "service billing adjustments authorized read" on public.service_order_billing_adjustments
  for select to authenticated using (
    public.has_permission('servicios.view')
  );

grant select on public.service_tariff_versions, public.service_tariff_rates,
  public.client_service_rates, public.service_order_events,
  public.service_order_billing_adjustments to authenticated;
revoke insert, update, delete on public.service_order_events,
  public.service_order_billing_adjustments from anon, authenticated, service_role;
revoke truncate on public.service_order_events,
  public.service_order_billing_adjustments from anon, authenticated, service_role;
revoke all on public.service_order_signatures from public, anon, authenticated, service_role;
-- El único lector runtime es el backend autenticado con service_role. La
-- evidencia permanece append-only: se concede sólo lectura, nunca DML.
grant select on public.service_order_signatures to service_role;
revoke insert, update, delete, truncate on public.email_sends
  from anon, authenticated, service_role;
revoke insert, update, delete, truncate on public.service_tariff_versions,
  public.service_tariff_rates, public.client_service_rates
  from anon, authenticated, service_role;
revoke insert, update, delete, truncate on public.orders from anon, authenticated, service_role;
grant update (status, invoice_id) on public.orders to authenticated, service_role;
revoke insert, update, delete, truncate on public.order_services from anon, authenticated, service_role;
revoke all on function public._service_pricing_boundary(date,timestamptz) from public, anon, authenticated, service_role;
revoke all on function public._service_tariff_timeline_ck() from public, anon, authenticated, service_role;
revoke all on function public._client_service_rate_timeline_ck() from public, anon, authenticated, service_role;
revoke all on function public.service_order_issue(jsonb,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.service_order_record_fulfillment(uuid,numeric,text) from public, anon, authenticated, service_role;
revoke all on function public.service_order_adjust_billing(uuid,numeric,numeric,text) from public, anon, authenticated, service_role;
revoke all on function public.service_tariff_publish(text,text,date,text,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.client_service_rate_set(uuid,text,text,numeric,numeric,numeric,date,text) from public, anon, authenticated, service_role;
grant execute on function public.service_order_issue(jsonb,jsonb) to authenticated;
grant execute on function public.service_order_record_fulfillment(uuid,numeric,text) to authenticated;
grant execute on function public.service_order_adjust_billing(uuid,numeric,numeric,text) to authenticated;
grant execute on function public.service_tariff_publish(text,text,date,text,text,jsonb) to authenticated;
grant execute on function public.client_service_rate_set(uuid,text,text,numeric,numeric,numeric,date,text) to authenticated;

comment on table public.service_tariff_versions is
  'Versiones fechadas del tarifario general de Ordenes de Servicio.';
comment on column public.order_services.subtotal_requested is
  'Snapshot inmutable al emitir. Nunca se reemplaza por prestado ni facturado.';
comment on table public.service_order_billing_adjustments is
  'Ledger inmutable de diferencias de facturacion con motivo y autorizador.';
comment on column public.order_services.currency_snapshot is
  'Moneda explicita e inmutable de la linea emitida; NULL identifica legado sin moneda demostrable.';
