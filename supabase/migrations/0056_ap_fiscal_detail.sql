-- =========================================================================
-- 0056_ap_fiscal_detail.sql — ERP-B1 · Fundación de Datos AP (Gate 1)
--
-- Detalle fiscal de facturas de proveedor: la FUENTE DE VERDAD del IVA y las
-- percepciones pasa al DETALLE (vat_lines + other_taxes). La cabecera
-- supplier_invoices (0014) queda como CACHÉ reconciliada por la RPC de alta
-- (0058). Elimina la imposibilidad de multi-alícuota / Libro IVA detectada en
-- ERP_B_AUDIT_REPORT.md (P0-2, P0-3).
--
-- ALINEADO A CONVENCIONES EXISTENTES:
--   · Detail-only-via-RPC: guard ap.via_rpc (espejo de guard_allocation_insert, 0053:86).
--   · AFIP alic_iva_id (3=0,4=10.5,5=21,6=27,8=5,9=2.5) — espejo de 0011:220-221.
--   · numeric(14,2) para igualar la precisión de supplier_invoices (0014:64-67).
--   · RLS lectura/escritura roles internos (espejo de 0014:116-130).
--
-- NATURALEZA: ADITIVA. NO toca ERP-A (supplier_payments, payment_allocations,
--   tesoreria_register_payment, supplier_open_items). Solo agrega columnas a
--   supplier_invoices (additive) y crea tablas de detalle nuevas.
--
-- ⚠️ Esta migración AÑADE el valor 'cuentas_pagar' al enum permission_module_t
--   pero NO lo usa aquí (el seed RBAC vive en 0057). Postgres no permite usar un
--   valor nuevo de enum en la misma transacción del ALTER TYPE — mismo patrón
--   que 0052→0053. Por eso el ADD VALUE va aislado en esta migración previa.
-- =========================================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------------------
-- 0. Prerequisito RBAC (aislado, se usa recién en 0057)
-- -------------------------------------------------------------------------
alter type public.permission_module_t add value if not exists 'cuentas_pagar';

-- -------------------------------------------------------------------------
-- 1. Enum de otros tributos / percepciones
-- -------------------------------------------------------------------------
do $$ begin
  create type public.ap_other_tax_t as enum (
    'PERCEPCION_IVA',
    'PERCEPCION_IIBB',
    'PERCEPCION_GANANCIAS',
    'IMPUESTO_INTERNO',
    'OTRO'
  );
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------------------
-- 2. Cabecera: columnas de desglose fiscal faltantes (aditivas, default 0)
--    'neto' (0014) se interpreta como NETO GRAVADO. Se completan los
--    componentes que faltaban para la identidad financiera completa.
-- -------------------------------------------------------------------------
alter table public.supplier_invoices
  add column if not exists importe_no_gravado numeric(14,2) not null default 0,
  add column if not exists importe_exento     numeric(14,2) not null default 0,
  add column if not exists tributos           numeric(14,2) not null default 0;

comment on column public.supplier_invoices.neto is 'Neto Gravado (caché = Σ supplier_invoice_vat_lines.base_neto)';
comment on column public.supplier_invoices.iva  is 'IVA Pagado/Crédito Fiscal (caché = Σ supplier_invoice_vat_lines.importe_iva)';
comment on column public.supplier_invoices.percepciones is 'Caché = Σ other_taxes.importe WHERE tax_kind LIKE PERCEPCION_%';
comment on column public.supplier_invoices.tributos     is 'Caché = Σ other_taxes.importe WHERE tax_kind IN (IMPUESTO_INTERNO, OTRO)';
comment on column public.supplier_invoices.total        is 'Identidad: neto + importe_no_gravado + importe_exento + iva + percepciones + tributos';

-- -------------------------------------------------------------------------
-- 3. Guard: el detalle fiscal SOLO nace/edita vía RPC AP (ap.via_rpc='on').
--    Espejo de C3 (guard_allocation_insert, 0053:86-90). Garantiza que la
--    cabecera nunca diverja del detalle (la RPC reconcilia atómicamente).
-- -------------------------------------------------------------------------
create or replace function public.guard_ap_detail_write()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('ap.via_rpc', true), 'off') <> 'on' then
    raise exception
      'AP_DETAIL_VIA_RPC_ONLY: el detalle fiscal de facturas de proveedor solo se escribe vía RPC AP'
      using errcode = 'check_violation';
  end if;
  return new;
end; $$;

-- -------------------------------------------------------------------------
-- 4. supplier_invoice_vat_lines — subtotales de IVA por alícuota (CANÓNICA)
-- -------------------------------------------------------------------------
create table if not exists public.supplier_invoice_vat_lines (
  id uuid primary key default gen_random_uuid(),
  supplier_invoice_id uuid not null references public.supplier_invoices(id) on delete cascade,
  alic_iva_id  smallint     not null,             -- AFIP: 3/4/5/6/8/9
  alicuota_iva numeric(5,2) not null,             -- 0/2.5/5/10.5/21/27
  base_neto    numeric(14,2) not null default 0,  -- neto gravado a esa alícuota
  importe_iva  numeric(14,2) not null default 0,
  -- (alic_iva_id ↔ alicuota_iva) debe ser un par AFIP válido
  constraint sivl_alic_pair_chk check (
    (alic_iva_id, alicuota_iva) in (
      (3, 0), (4, 10.5), (5, 21), (6, 27), (8, 5), (9, 2.5)
    )
  ),
  -- IVA coherente con base·alícuota (tolerancia de redondeo AFIP)
  constraint sivl_iva_coherente_chk check (
    abs(importe_iva - round(base_neto * alicuota_iva / 100, 2)) <= 0.02
  ),
  constraint sivl_base_pos_chk check (base_neto >= 0),
  constraint sivl_iva_pos_chk  check (importe_iva >= 0),
  -- una sola fila por alícuota en cada factura
  unique (supplier_invoice_id, alic_iva_id)
);
create index if not exists sivl_invoice_idx on public.supplier_invoice_vat_lines (supplier_invoice_id);
create index if not exists sivl_alic_idx    on public.supplier_invoice_vat_lines (alic_iva_id);

drop trigger if exists trg_guard_sivl on public.supplier_invoice_vat_lines;
create trigger trg_guard_sivl
  before insert or update on public.supplier_invoice_vat_lines
  for each row execute function public.guard_ap_detail_write();

-- -------------------------------------------------------------------------
-- 5. supplier_invoice_other_taxes — percepciones / IIBB / imp. internos
-- -------------------------------------------------------------------------
create table if not exists public.supplier_invoice_other_taxes (
  id uuid primary key default gen_random_uuid(),
  supplier_invoice_id uuid not null references public.supplier_invoices(id) on delete cascade,
  tax_kind     public.ap_other_tax_t not null,
  jurisdiction text,                               -- provincia (obligatorio en IIBB)
  base         numeric(14,2) not null default 0,
  alicuota     numeric(7,4),
  importe      numeric(14,2) not null default 0,
  constraint siot_iibb_jurisdiction_chk check (
    tax_kind <> 'PERCEPCION_IIBB' or (jurisdiction is not null and length(trim(jurisdiction)) > 0)
  ),
  constraint siot_importe_pos_chk check (importe >= 0)
);
create index if not exists siot_invoice_idx on public.supplier_invoice_other_taxes (supplier_invoice_id);
create index if not exists siot_kind_idx    on public.supplier_invoice_other_taxes (tax_kind);

drop trigger if exists trg_guard_siot on public.supplier_invoice_other_taxes;
create trigger trg_guard_siot
  before insert or update on public.supplier_invoice_other_taxes
  for each row execute function public.guard_ap_detail_write();

-- -------------------------------------------------------------------------
-- 6. supplier_invoice_items — renglones descriptivos (OPCIONAL, no fiscal)
-- -------------------------------------------------------------------------
create table if not exists public.supplier_invoice_items (
  id uuid primary key default gen_random_uuid(),
  supplier_invoice_id uuid not null references public.supplier_invoices(id) on delete cascade,
  descripcion     text not null,
  cantidad        numeric(12,2) not null default 1,
  precio_unitario numeric(14,2) not null default 0,
  alic_iva_id     smallint not null default 5,        -- enlaza el renglón a su alícuota
  importe_neto    numeric(14,2) not null default 0,
  importe_iva     numeric(14,2) not null default 0,
  importe_total   numeric(14,2) not null default 0,
  orden int not null default 0
);
create index if not exists siit_invoice_idx on public.supplier_invoice_items (supplier_invoice_id);

drop trigger if exists trg_guard_siit on public.supplier_invoice_items;
create trigger trg_guard_siit
  before insert or update on public.supplier_invoice_items
  for each row execute function public.guard_ap_detail_write();

-- =========================================================================
-- 7. RLS — lectura/escritura solo roles internos (espejo de 0014:116-130).
--    La escritura efectiva pasa además por el guard ap.via_rpc + la RPC.
-- =========================================================================
alter table public.supplier_invoice_vat_lines  enable row level security;
alter table public.supplier_invoice_other_taxes enable row level security;
alter table public.supplier_invoice_items       enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'supplier_invoice_vat_lines',
    'supplier_invoice_other_taxes',
    'supplier_invoice_items'
  ] loop
    execute format('drop policy if exists "%s read" on public.%I', t, t);
    execute format($f$create policy "%s read" on public.%I for select
      using (auth.role() = 'authenticated')$f$, t, t);

    execute format('drop policy if exists "%s write" on public.%I', t, t);
    execute format($f$create policy "%s write" on public.%I for all
      using (public.current_role() in ('admin','operaciones','supervisor'))
      with check (public.current_role() in ('admin','operaciones','supervisor'))$f$, t, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
