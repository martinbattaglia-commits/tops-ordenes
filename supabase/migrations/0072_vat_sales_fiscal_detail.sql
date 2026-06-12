-- =========================================================================
-- 0072_vat_sales_fiscal_detail.sql — IVA VENTAS V1 · Fundación canónica
--
-- Autorización presidencial 2026-06-12 (VAT-SALES-DOMAIN-DESIGN §7 · V1).
-- Espejo del lado AP (0056) para el DÉBITO fiscal:
--   · customer_invoice_vat_lines = FUENTE DE VERDAD del IVA Ventas por alícuota.
--   · La cabecera customer_invoices queda como CACHÉ reconciliada.
--   · Detail-only-via-RPC (guard ventas.via_rpc, espejo de ap.via_rpc 0056).
--   · numeric(15,2) — precisión del lado ventas (0011).
--
-- REFUERZOS sobre el espejo AP (mandatos V1 #2 y #4):
--   · ventas_persist_invoice(): cabecera + items + vat_lines + auditoría en
--     UNA transacción (RPC security definer).
--   · Constraint trigger DIFERIDO al commit: todo comprobante nuevo debe
--     tener ≥1 línea IVA y cumplir Σ líneas = cabecera ± 0,02 (neto e IVA).
--     No existen comprobantes emitidos sin detalle canónico.
--   · El importe canónico por alícuota es LO DECLARADO A ARCA (Σ de renglones
--     redondeados — array Iva[] del request). Por eso la coherencia aritmética
--     se exige a nivel COMPROBANTE (trigger ±0,02) y no por línea: con N
--     renglones el redondeo por renglón puede derivar hasta N×$0,005.
--   · G7: CHECK de par AFIP (alic_iva_id ↔ alicuota_iva) también en
--     invoice_items — ninguna alícuota inválida puede persistirse.
--
-- NATURALEZA: ADITIVA + backfill verificado. NO toca Tesorería, Cobranzas,
-- UI, vistas existentes ni ARCA. Cero DROP, cero DELETE, cero UPDATE de datos.
-- =========================================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------------------
-- 1. Guard: el detalle fiscal de ventas SOLO nace vía RPC (espejo 0056 §3).
-- -------------------------------------------------------------------------
create or replace function public.guard_ventas_detail_write()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('ventas.via_rpc', true), 'off') <> 'on' then
    raise exception
      'VENTAS_DETAIL_VIA_RPC_ONLY: el detalle fiscal de ventas solo se escribe vía RPC de emisión'
      using errcode = 'check_violation';
  end if;
  return new;
end; $$;

-- -------------------------------------------------------------------------
-- 2. customer_invoice_vat_lines — débito fiscal por alícuota (CANÓNICA)
-- -------------------------------------------------------------------------
create table if not exists public.customer_invoice_vat_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.customer_invoices(id) on delete restrict,
  alic_iva_id  smallint      not null,             -- AFIP: 3/4/5/6/8/9
  alicuota_iva numeric(5,2)  not null,             -- 0/2.5/5/10.5/21/27
  neto_gravado numeric(15,2) not null default 0,
  iva_importe  numeric(15,2) not null default 0,
  created_at timestamptz not null default now(),
  -- (alic_iva_id ↔ alicuota_iva) debe ser un par AFIP válido (espejo 0056)
  constraint civl_alic_pair_chk check (
    (alic_iva_id, alicuota_iva) in (
      (3, 0), (4, 10.5), (5, 21), (6, 27), (8, 5), (9, 2.5)
    )
  ),
  constraint civl_neto_pos_chk check (neto_gravado >= 0),
  constraint civl_iva_pos_chk  check (iva_importe >= 0),
  -- una sola fila por alícuota en cada comprobante
  unique (invoice_id, alic_iva_id)
);
create index if not exists civl_invoice_idx on public.customer_invoice_vat_lines (invoice_id);
create index if not exists civl_alic_idx    on public.customer_invoice_vat_lines (alic_iva_id);

comment on table public.customer_invoice_vat_lines is
  'FUENTE DE VERDAD del débito fiscal (IVA Ventas) por alícuota. La cabecera customer_invoices.subtotal/iva es caché reconciliada (identidad exigida por trg_ci_vat_identity).';

drop trigger if exists trg_guard_civl on public.customer_invoice_vat_lines;
create trigger trg_guard_civl
  before insert or update on public.customer_invoice_vat_lines
  for each row execute function public.guard_ventas_detail_write();

alter table public.customer_invoice_vat_lines enable row level security;
drop policy if exists "civl read" on public.customer_invoice_vat_lines;
create policy "civl read" on public.customer_invoice_vat_lines for select
  using (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "civl write" on public.customer_invoice_vat_lines;
create policy "civl write" on public.customer_invoice_vat_lines for all
  using (public.current_role() in ('admin','operaciones'))
  with check (public.current_role() in ('admin','operaciones'));

-- -------------------------------------------------------------------------
-- 3. G7 — alícuotas válidas también en invoice_items (sin default silencioso)
--    El par AFIP queda exigido en DB; el código ya no mapea desconocidas a 21.
-- -------------------------------------------------------------------------
do $$ begin
  alter table public.invoice_items
    add constraint ii_alic_pair_chk check (
      (alic_iva_id, alicuota_iva) in (
        (3, 0), (4, 10.5), (5, 21), (6, 27), (8, 5), (9, 2.5)
      )
    );
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------------------
-- 4. Identidad al commit: todo comprobante NUEVO debe tener detalle canónico
--    y cumplir Σ vat_lines = cabecera ± 0,02 (neto e IVA). DIFERIDO para que
--    la RPC inserte cabecera→líneas dentro de la misma transacción.
-- -------------------------------------------------------------------------
create or replace function public.check_ci_vat_identity()
returns trigger language plpgsql as $$
declare
  v_neto numeric;
  v_iva  numeric;
  v_n    int;
begin
  select coalesce(sum(neto_gravado), 0), coalesce(sum(iva_importe), 0), count(*)
    into v_neto, v_iva, v_n
  from public.customer_invoice_vat_lines
  where invoice_id = new.id;

  if v_n = 0 then
    raise exception
      'CI_VAT_LINES_REQUIRED: el comprobante % no tiene líneas de IVA canónicas (emisión solo vía RPC ventas_persist_invoice)', new.id
      using errcode = 'check_violation';
  end if;
  if abs(v_neto - new.subtotal) > 0.02 or abs(v_iva - new.iva) > 0.02 then
    raise exception
      'CI_VAT_IDENTITY: Σ líneas (neto %, iva %) difiere de la cabecera (neto %, iva %) en más de ±0,02 — comprobante %',
      v_neto, v_iva, new.subtotal, new.iva, new.id
      using errcode = 'check_violation';
  end if;
  return null;
end; $$;

drop trigger if exists trg_ci_vat_identity on public.customer_invoices;
create constraint trigger trg_ci_vat_identity
  after insert on public.customer_invoices
  deferrable initially deferred
  for each row execute function public.check_ci_vat_identity();

-- -------------------------------------------------------------------------
-- 5. RPC de emisión transaccional — cabecera + items + vat_lines + auditoría
--    en UNA transacción. Espejo de ap_create_supplier_invoice (0058):
--    security definer + gate de rol (admin/operaciones, el mismo del RLS de
--    escritura de customer_invoices) + set_config('ventas.via_rpc').
-- -------------------------------------------------------------------------
create or replace function public.ventas_persist_invoice(
  p_invoice   jsonb,
  p_items     jsonb,
  p_vat_lines jsonb,
  p_audit     jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.customer_invoices;
  v_id  uuid := gen_random_uuid();
begin
  if public.current_role() not in ('admin','operaciones') then
    raise exception 'VENTAS_RPC_DENIED: requiere rol admin u operaciones'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('ventas.via_rpc', 'on', true);

  insert into public.customer_invoices
  select * from jsonb_populate_record(
    null::public.customer_invoices,
    p_invoice || jsonb_build_object(
      'id', v_id,
      'created_at', now(),
      'updated_at', now()
    )
  )
  returning * into v_row;

  insert into public.invoice_items
    (invoice_id, order_id, descripcion, cantidad, precio_unitario,
     alicuota_iva, alic_iva_id, importe_neto, importe_iva, importe_total, orden)
  select
    v_id,
    nullif(r->>'order_id','')::uuid,
    r->>'descripcion',
    (r->>'cantidad')::numeric,
    (r->>'precio_unitario')::numeric,
    (r->>'alicuota_iva')::numeric,
    (r->>'alic_iva_id')::smallint,
    (r->>'importe_neto')::numeric,
    (r->>'importe_iva')::numeric,
    (r->>'importe_total')::numeric,
    coalesce((r->>'orden')::int, 0)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) r;

  insert into public.customer_invoice_vat_lines
    (invoice_id, alic_iva_id, alicuota_iva, neto_gravado, iva_importe)
  select
    v_id,
    (r->>'alic_iva_id')::smallint,
    (r->>'alicuota_iva')::numeric,
    (r->>'neto_gravado')::numeric,
    (r->>'iva_importe')::numeric
  from jsonb_array_elements(coalesce(p_vat_lines, '[]'::jsonb)) r;

  insert into public.invoice_audit
    (invoice_id, user_id, action, estado, cae, request, response, ip)
  select
    v_id,
    nullif(r->>'user_id','')::uuid,
    r->>'action',
    (r->>'estado')::public.invoice_arca_status_t,
    nullif(r->>'cae',''),
    r->'request',
    r->'response',
    nullif(r->>'ip','')
  from jsonb_array_elements(coalesce(p_audit, '[]'::jsonb)) r;

  return to_jsonb(v_row);
end; $$;

revoke all on function public.ventas_persist_invoice(jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.ventas_persist_invoice(jsonb, jsonb, jsonb, jsonb) to authenticated;

-- -------------------------------------------------------------------------
-- 6. BACKFILL histórico — reconstrucción desde invoice_items (idempotente).
--    El importe canónico = Σ de los renglones (lo declarado a ARCA).
-- -------------------------------------------------------------------------
do $$
begin
  perform set_config('ventas.via_rpc', 'on', true);

  insert into public.customer_invoice_vat_lines
    (invoice_id, alic_iva_id, alicuota_iva, neto_gravado, iva_importe)
  select
    ii.invoice_id,
    ii.alic_iva_id,
    ii.alicuota_iva,
    sum(ii.importe_neto),
    sum(ii.importe_iva)
  from public.invoice_items ii
  group by ii.invoice_id, ii.alic_iva_id, ii.alicuota_iva
  on conflict (invoice_id, alic_iva_id) do nothing;
end $$;

-- -------------------------------------------------------------------------
-- 7. VERIFICACIÓN MATEMÁTICA del backfill (mandato V1 #4) — fail-fast:
--    si algún comprobante con renglones queda sin líneas o fuera de ±0,02,
--    la migración FALLA y reporta los comprobantes afectados.
-- -------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(
           format('%s [%s-%s]: Δneto=%s Δiva=%s lineas=%s',
                  ci.id, ci.punto_venta, coalesce(ci.numero_comprobante, 0),
                  coalesce(vl.neto, 0) - ci.subtotal,
                  coalesce(vl.iva, 0) - ci.iva,
                  coalesce(vl.n, 0)),
           ' · ')
    into v_bad
  from public.customer_invoices ci
  left join (
    select invoice_id, sum(neto_gravado) as neto, sum(iva_importe) as iva, count(*) as n
    from public.customer_invoice_vat_lines
    group by invoice_id
  ) vl on vl.invoice_id = ci.id
  where exists (select 1 from public.invoice_items ii where ii.invoice_id = ci.id)
    and (coalesce(vl.n, 0) = 0
         or abs(coalesce(vl.neto, 0) - ci.subtotal) > 0.02
         or abs(coalesce(vl.iva, 0) - ci.iva) > 0.02);

  if v_bad is not null then
    raise exception 'BACKFILL_VAT_IDENTITY_FAIL: %', v_bad;
  end if;
end $$;

notify pgrst, 'reload schema';
