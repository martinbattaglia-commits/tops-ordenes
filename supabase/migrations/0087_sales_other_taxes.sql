-- =========================================================================
-- 0087_sales_other_taxes.sql — Fase 10.A · Percepciones/otros tributos de VENTA
--                              (desglosados)
--
-- Cierra la brecha "percepciones de venta sin desglose": hasta ahora la
-- cabecera customer_invoices solo tenía los TOTALES (percepciones / tributos).
-- Esta migración agrega el DETALLE por tipo y jurisdicción, espejo de
-- supplier_invoice_other_taxes (0056), SIN mezclarlo con el IVA débito fiscal
-- (que vive en customer_invoice_vat_lines, 0072) y SIN tocar la cabecera.
--
-- COMPATIBILIDAD (0082-0086):
--   · La cabecera customer_invoices.percepciones/tributos sigue siendo la fuente
--     de los TOTALES (la usa el asiento de venta de 0085 y los libros IVA). El
--     detalle es ADITIVO: explica la composición y habilita DDJJ por jurisdicción.
--   · No se agrega identidad dura cabecera↔detalle (los comprobantes legacy no
--     tienen detalle). La reconciliación es informativa (v_*_check en 0089).
--   · Escritura solo vía RPC (reutiliza el guard ventas.via_rpc de 0072).
--
-- NATURALEZA: ADITIVA e idempotente. No aplica migraciones (las aplica Martín).
-- =========================================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------------------
-- 1. Enum de tipos de tributo adicional en ventas (tipo nuevo → uso en la
--    misma migración es seguro)
-- -------------------------------------------------------------------------
do $$ begin
  create type public.sales_other_tax_t as enum (
    'PERCEPCION_IVA',
    'PERCEPCION_IIBB',
    'PERCEPCION_MUNICIPAL',
    'IMPUESTO_INTERNO',
    'OTRO'
  );
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------------------
-- 2. customer_invoice_other_taxes — detalle de percepciones/tributos de venta
-- -------------------------------------------------------------------------
create table if not exists public.customer_invoice_other_taxes (
  id uuid primary key default gen_random_uuid(),
  customer_invoice_id uuid not null references public.customer_invoices(id) on delete restrict,
  tax_type     public.sales_other_tax_t not null,
  tax_name     text,
  -- jurisdiccion NOT NULL DEFAULT '' para que el UNIQUE deduplique de forma
  -- determinística (NULLs distintos romperían el on-conflict idempotente).
  jurisdiction text not null default '',
  tax_base     numeric(15,2) not null default 0,
  rate         numeric(7,4),
  amount       numeric(15,2) not null default 0,
  -- imputación contable opcional (override de las reglas; default vía accounting_rules)
  account_id   uuid references public.chart_of_accounts(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint ciot_amount_pos_chk check (amount >= 0),
  -- IIBB y Municipal exigen jurisdicción (mismo criterio que AP / IIBB en 0056)
  constraint ciot_jurisdiction_chk check (
    tax_type not in ('PERCEPCION_IIBB','PERCEPCION_MUNICIPAL')
    or length(trim(jurisdiction)) > 0
  )
);
create unique index if not exists ciot_unique on public.customer_invoice_other_taxes (customer_invoice_id, tax_type, jurisdiction);
create index if not exists ciot_invoice_idx on public.customer_invoice_other_taxes (customer_invoice_id);
create index if not exists ciot_type_idx    on public.customer_invoice_other_taxes (tax_type);

comment on table public.customer_invoice_other_taxes is
  'Detalle de percepciones/otros tributos de venta por tipo y jurisdicción. NO incluye IVA débito (eso vive en customer_invoice_vat_lines). La cabecera customer_invoices.percepciones/tributos es el total reconciliado.';

drop trigger if exists trg_touch_ciot on public.customer_invoice_other_taxes;
create trigger trg_touch_ciot
before update on public.customer_invoice_other_taxes
for each row execute function public.touch_updated_at();

-- Guard: detalle solo vía RPC (reutiliza el guard de ventas, 0072).
drop trigger if exists trg_guard_ciot on public.customer_invoice_other_taxes;
create trigger trg_guard_ciot
before insert or update on public.customer_invoice_other_taxes
for each row execute function public.guard_ventas_detail_write();

-- -------------------------------------------------------------------------
-- 3. RLS — espejo de customer_invoice_vat_lines (0072): lectura interna,
--    escritura admin/operaciones (+ guard via_rpc encima).
-- -------------------------------------------------------------------------
alter table public.customer_invoice_other_taxes enable row level security;
drop policy if exists "ciot read" on public.customer_invoice_other_taxes;
create policy "ciot read" on public.customer_invoice_other_taxes for select
  using (public.current_role() in ('admin','operaciones','supervisor')
         or public.has_permission('contabilidad.view'));
drop policy if exists "ciot write" on public.customer_invoice_other_taxes;
create policy "ciot write" on public.customer_invoice_other_taxes for all
  using (public.current_role() in ('admin','operaciones'))
  with check (public.current_role() in ('admin','operaciones'));

-- -------------------------------------------------------------------------
-- 4. RPC de alta del detalle (idempotente, transaccional). Espejo del patrón
--    ventas_persist_invoice (0072): security definer + gate de rol + via_rpc.
-- -------------------------------------------------------------------------
create or replace function public.ventas_persist_other_taxes(
  p_invoice_id uuid,
  p_taxes jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_n int; v_inserted int;
begin
  if public.current_role() not in ('admin','operaciones') then
    raise exception 'VENTAS_RPC_DENIED: requiere rol admin u operaciones' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.customer_invoices where id = p_invoice_id) then
    raise exception 'VENTAS_INVOICE_NOT_FOUND: factura % inexistente', p_invoice_id using errcode = 'no_data_found';
  end if;

  perform set_config('ventas.via_rpc', 'on', true);

  with src as (
    select
      p_invoice_id as customer_invoice_id,
      (r->>'tax_type')::public.sales_other_tax_t as tax_type,
      nullif(r->>'tax_name','') as tax_name,
      coalesce(r->>'jurisdiction','') as jurisdiction,
      coalesce((r->>'tax_base')::numeric, 0) as tax_base,
      nullif(r->>'rate','')::numeric as rate,
      coalesce((r->>'amount')::numeric, 0) as amount,
      nullif(r->>'account_id','')::uuid as account_id
    from jsonb_array_elements(coalesce(p_taxes, '[]'::jsonb)) r
  ),
  ins as (
    insert into public.customer_invoice_other_taxes
      (customer_invoice_id, tax_type, tax_name, jurisdiction, tax_base, rate, amount, account_id)
    select customer_invoice_id, tax_type, tax_name, jurisdiction, tax_base, rate, amount, account_id
    from src
    on conflict (customer_invoice_id, tax_type, jurisdiction) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  select count(*) into v_n from jsonb_array_elements(coalesce(p_taxes, '[]'::jsonb));
  return jsonb_build_object('ok', true, 'invoice_id', p_invoice_id, 'recibidos', v_n, 'insertados', v_inserted);
end; $$;
revoke all on function public.ventas_persist_other_taxes(uuid, jsonb) from public;
grant execute on function public.ventas_persist_other_taxes(uuid, jsonb) to authenticated;

-- -------------------------------------------------------------------------
-- 5. Plan de cuentas: cuenta de Percepciones Municipales a depositar (las de
--    IVA=2.1.04, IIBB=2.1.05 y otros=2.1.10 ya existen en 0084). Aditivo.
-- -------------------------------------------------------------------------
insert into public.chart_of_accounts (code, name, type, subtype, is_postable, is_system) values
  ('2.1.16', 'Percepciones Municipales a depositar', 'pasivo', 'corriente', true, true)
on conflict (code) do nothing;

-- Reenlazar parent_id por prefijo (idempotente; mismo patrón que 0084).
update public.chart_of_accounts c
set parent_id = p.id
from public.chart_of_accounts p
where position('.' in c.code) > 0
  and p.code = substr(c.code, 1, length(c.code) - position('.' in reverse(c.code)))
  and c.parent_id is distinct from p.id;

-- -------------------------------------------------------------------------
-- 6. accounting_rules: imputación por tipo de percepción de venta (driver del
--    desglose contable de 0089). Fallback a las reglas lump de 0084.
-- -------------------------------------------------------------------------
insert into public.accounting_rules (source_type, rule_key, account_code, notes) values
  ('customer_invoice', 'percepcion_PERCEPCION_IVA',       '2.1.04', 'Percepción IVA a depositar'),
  ('customer_invoice', 'percepcion_PERCEPCION_IIBB',      '2.1.05', 'Percepción IIBB a depositar'),
  ('customer_invoice', 'percepcion_PERCEPCION_MUNICIPAL', '2.1.16', 'Percepción Municipal a depositar'),
  ('customer_invoice', 'percepcion_IMPUESTO_INTERNO',     '2.1.10', 'Impuesto interno / otros tributos'),
  ('customer_invoice', 'percepcion_OTRO',                 '2.1.10', 'Otros tributos')
on conflict (source_type, rule_key) do nothing;

notify pgrst, 'reload schema';
