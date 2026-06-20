-- =========================================================================
-- 0088_supplier_withholdings.sql — Fase 10.B · Retenciones practicadas a
--                                  proveedores (al pagar)
--
-- Cierra la brecha "retenciones practicadas no modeladas": supplier_payments
-- (0053) registra el pago pero NO las retenciones que la empresa practica como
-- agente de retención. Esta migración agrega el DETALLE de retenciones por pago
-- (y, si aplica, por factura), generando deuda fiscal contra el organismo.
--
-- SEMÁNTICA (documentada, sin tocar tesorería):
--   · supplier_payments.amount = importe NETO efectivamente pagado al proveedor
--     (egreso bancario real; lo que ya registra tesorería).
--   · W = Σ retenciones practicadas (detalle de esta tabla).
--   · Obligación cancelada al proveedor (bruto) = amount + W.
--   · Asiento (0089): DEBE Proveedores (amount+W) / HABER Banco (amount) +
--     Retenciones a depositar (W, por tipo). Contablemente consistente:
--     la factura acreditó Proveedores por el bruto; los pagos lo debitan por
--     (amount + W) → al saldar, Proveedores cierra en 0.
--   · LIMITACIÓN CONOCIDA (documentada): supplier_open_items (vista de tesorería,
--     0054) reduce CxP por las allocations = amount (neto), por lo que puede
--     mostrar un residual = W hasta que tesorería soporte allocations por bruto.
--     Es un gap de tesorería, NO de contabilidad. Ver docs/contabilidad-nexus.md.
--
-- COMPATIBILIDAD: ADITIVA. No modifica supplier_payments, payment_allocations,
--   ni las RPC de tesorería (append-only intacto). Escritura solo vía RPC
--   (reutiliza el guard ap.via_rpc de 0056).
-- =========================================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------------------
-- 1. Enum de tipos de retención practicada
-- -------------------------------------------------------------------------
do $$ begin
  create type public.supplier_withholding_t as enum (
    'RETENCION_IVA',
    'RETENCION_GANANCIAS',
    'RETENCION_IIBB',
    'RETENCION_SUSS',
    'OTRA'
  );
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------------------
-- 2. supplier_payment_withholdings — retenciones practicadas por pago
-- -------------------------------------------------------------------------
create table if not exists public.supplier_payment_withholdings (
  id uuid primary key default gen_random_uuid(),
  supplier_payment_id uuid not null references public.supplier_payments(id) on delete restrict,
  -- vínculo opcional a la factura sobre la que se retiene (trazabilidad)
  supplier_invoice_id uuid references public.supplier_invoices(id) on delete set null,
  withholding_type   public.supplier_withholding_t not null,
  withholding_name   text,
  jurisdiction       text not null default '',
  tax_base           numeric(14,2) not null default 0,
  rate               numeric(7,4),
  amount             numeric(14,2) not null default 0,
  account_id         uuid references public.chart_of_accounts(id) on delete set null,
  certificate_number text,
  withheld_at        date not null default current_date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint spw_amount_pos_chk check (amount >= 0),
  constraint spw_iibb_jurisdiction_chk check (
    withholding_type <> 'RETENCION_IIBB' or length(trim(jurisdiction)) > 0
  )
);
create unique index if not exists spw_unique on public.supplier_payment_withholdings (supplier_payment_id, withholding_type, jurisdiction);
create index if not exists spw_payment_idx on public.supplier_payment_withholdings (supplier_payment_id);
create index if not exists spw_invoice_idx on public.supplier_payment_withholdings (supplier_invoice_id);
create index if not exists spw_type_idx    on public.supplier_payment_withholdings (withholding_type);

comment on table public.supplier_payment_withholdings is
  'Retenciones practicadas al pagar a proveedores. supplier_payments.amount = neto pagado; obligación = amount + Σ retenciones. Genera deuda fiscal (2.1.06/2.1.12-15). Tesorería (supplier_open_items) puede mostrar residual = Σ retenciones (gap conocido).';

drop trigger if exists trg_touch_spw on public.supplier_payment_withholdings;
create trigger trg_touch_spw
before update on public.supplier_payment_withholdings
for each row execute function public.touch_updated_at();

-- Guard: detalle solo vía RPC (reutiliza el guard de AP, 0056).
drop trigger if exists trg_guard_spw on public.supplier_payment_withholdings;
create trigger trg_guard_spw
before insert or update on public.supplier_payment_withholdings
for each row execute function public.guard_ap_detail_write();

-- Append-only: DELETE prohibido (reutiliza el guard financiero, 0053).
drop trigger if exists trg_spw_no_delete on public.supplier_payment_withholdings;
create trigger trg_spw_no_delete
before delete on public.supplier_payment_withholdings
for each row execute function public.tg_forbid_delete_financial();

-- -------------------------------------------------------------------------
-- 3. RLS — lectura interna; escritura admin (+ guard via_rpc). Alinea con la
--    confidencialidad de tesorería (0053: write admin).
-- -------------------------------------------------------------------------
alter table public.supplier_payment_withholdings enable row level security;
drop policy if exists "spw read" on public.supplier_payment_withholdings;
create policy "spw read" on public.supplier_payment_withholdings for select
  using (public.current_role() in ('admin','operaciones','supervisor')
         or public.has_permission('tesoreria.view')
         or public.has_permission('contabilidad.view'));
drop policy if exists "spw write admin" on public.supplier_payment_withholdings;
create policy "spw write admin" on public.supplier_payment_withholdings for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- -------------------------------------------------------------------------
-- 4. RPC de alta del detalle (idempotente). Gate por permiso tesoreria.create.
-- -------------------------------------------------------------------------
create or replace function public.ap_register_payment_withholdings(
  p_payment_id uuid,
  p_withholdings jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_n int; v_inserted int; v_status public.treasury_doc_status_t;
begin
  if not (public.has_permission('tesoreria.create') or public.current_role() = 'admin') then
    raise exception 'AP_WH_DENIED: requiere permiso tesoreria.create' using errcode = 'insufficient_privilege';
  end if;
  select status into v_status from public.supplier_payments where id = p_payment_id;
  if v_status is null then
    raise exception 'AP_WH_PAYMENT_NOT_FOUND: pago % inexistente', p_payment_id using errcode = 'no_data_found';
  end if;
  if v_status <> 'confirmado' then
    raise exception 'AP_WH_PAYMENT_NOT_CONFIRMED: el pago % no está confirmado (%).', p_payment_id, v_status using errcode = 'check_violation';
  end if;

  perform set_config('ap.via_rpc', 'on', true);

  with src as (
    select
      p_payment_id as supplier_payment_id,
      nullif(r->>'supplier_invoice_id','')::uuid as supplier_invoice_id,
      (r->>'withholding_type')::public.supplier_withholding_t as withholding_type,
      nullif(r->>'withholding_name','') as withholding_name,
      coalesce(r->>'jurisdiction','') as jurisdiction,
      coalesce((r->>'tax_base')::numeric, 0) as tax_base,
      nullif(r->>'rate','')::numeric as rate,
      coalesce((r->>'amount')::numeric, 0) as amount,
      nullif(r->>'account_id','')::uuid as account_id,
      nullif(r->>'certificate_number','') as certificate_number,
      coalesce(nullif(r->>'withheld_at','')::date, current_date) as withheld_at
    from jsonb_array_elements(coalesce(p_withholdings, '[]'::jsonb)) r
  ),
  ins as (
    insert into public.supplier_payment_withholdings
      (supplier_payment_id, supplier_invoice_id, withholding_type, withholding_name,
       jurisdiction, tax_base, rate, amount, account_id, certificate_number, withheld_at)
    select supplier_payment_id, supplier_invoice_id, withholding_type, withholding_name,
           jurisdiction, tax_base, rate, amount, account_id, certificate_number, withheld_at
    from src
    on conflict (supplier_payment_id, withholding_type, jurisdiction) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  select count(*) into v_n from jsonb_array_elements(coalesce(p_withholdings, '[]'::jsonb));
  return jsonb_build_object('ok', true, 'payment_id', p_payment_id, 'recibidos', v_n, 'insertados', v_inserted);
end; $$;
revoke all on function public.ap_register_payment_withholdings(uuid, jsonb) from public;
grant execute on function public.ap_register_payment_withholdings(uuid, jsonb) to authenticated;

-- -------------------------------------------------------------------------
-- 5. Plan de cuentas: retenciones a depositar por tipo (2.1.06 "Retenciones
--    practicadas a depositar" ya existe en 0084 → queda como fallback/OTRA).
-- -------------------------------------------------------------------------
insert into public.chart_of_accounts (code, name, type, subtype, is_postable, is_system) values
  ('2.1.12', 'Retenciones Ganancias a depositar', 'pasivo', 'corriente', true, true),
  ('2.1.13', 'Retenciones IVA a depositar',       'pasivo', 'corriente', true, true),
  ('2.1.14', 'Retenciones IIBB a depositar',      'pasivo', 'corriente', true, true),
  ('2.1.15', 'Retenciones SUSS a depositar',      'pasivo', 'corriente', true, true)
on conflict (code) do nothing;

update public.chart_of_accounts c
set parent_id = p.id
from public.chart_of_accounts p
where position('.' in c.code) > 0
  and p.code = substr(c.code, 1, length(c.code) - position('.' in reverse(c.code)))
  and c.parent_id is distinct from p.id;

-- -------------------------------------------------------------------------
-- 6. accounting_rules: imputación por tipo de retención (driver del desglose
--    contable de 0089). Fallback a 'retencion_practicada' (2.1.06, 0084).
-- -------------------------------------------------------------------------
insert into public.accounting_rules (source_type, rule_key, account_code, notes) values
  ('supplier_payment', 'withholding_RETENCION_GANANCIAS', '2.1.12', 'Retención Ganancias a depositar'),
  ('supplier_payment', 'withholding_RETENCION_IVA',       '2.1.13', 'Retención IVA a depositar'),
  ('supplier_payment', 'withholding_RETENCION_IIBB',      '2.1.14', 'Retención IIBB a depositar'),
  ('supplier_payment', 'withholding_RETENCION_SUSS',      '2.1.15', 'Retención SUSS a depositar'),
  ('supplier_payment', 'withholding_OTRA',                '2.1.06', 'Otras retenciones a depositar')
on conflict (source_type, rule_key) do nothing;

notify pgrst, 'reload schema';
