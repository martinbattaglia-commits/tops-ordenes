-- =========================================================================
-- 0092_cost_centers_dimension.sql — Fase 12.B/C · Centro de costo / unidad de
--   negocio como dimensión transversal (ventas + tesorería + contabilidad)
--
-- cost_centers ya existe (0014: code/name/description/parent_id/depot/active).
-- Esta migración lo EXTIENDE (type + updated_at) y agrega la dimensión
-- cost_center_id donde faltaba (customer_invoices, treasury_movements).
-- journal_entry_lines (0083) y supplier_invoices (0014) YA tienen cost_center_id.
--
-- NATURALEZA: ADITIVA e idempotente. No rompe el ABM existente de centros de
-- costo (settings/centros-costo) — las columnas nuevas son nullables/con default.
-- No aplica migraciones (las aplica Martín).
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Extender cost_centers: type (clasificación) + updated_at.
--    Se conserva 'active' (no se duplica con is_active).
-- -------------------------------------------------------------------------
alter table public.cost_centers
  add column if not exists type text,
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  alter table public.cost_centers
    add constraint cost_centers_type_chk check (
      type is null or type in (
        'unidad_negocio','sede','deposito','servicio','cliente_estrategico',
        'proyecto','centro_operativo','centro_administrativo'
      )
    );
exception when duplicate_object then null; end $$;

comment on column public.cost_centers.type is
  'Clasificación: unidad_negocio | sede | deposito | servicio | cliente_estrategico | proyecto | centro_operativo | centro_administrativo. NULL = sin clasificar (legacy).';

drop trigger if exists trg_cost_centers_updated_at on public.cost_centers;
create trigger trg_cost_centers_updated_at
before update on public.cost_centers
for each row execute function public.touch_updated_at();

-- Clasificar los centros base de 0014 (idempotente: solo si type es NULL).
update public.cost_centers set type = 'centro_operativo'     where code = 'CC-OPER'   and type is null;
update public.cost_centers set type = 'centro_operativo'     where code = 'CC-FLOTA'  and type is null;
update public.cost_centers set type = 'centro_administrativo' where code = 'CC-ADMIN'  and type is null;
update public.cost_centers set type = 'centro_operativo'     where code = 'CC-COMERC' and type is null;
update public.cost_centers set type = 'centro_operativo'     where code = 'CC-MANT'   and type is null;

-- -------------------------------------------------------------------------
-- 2. Seed de UNIDADES DE NEGOCIO y SEDES para 3PL (Logística TOPS).
--    Configurables/editables; gestionables desde settings/centros-costo.
-- -------------------------------------------------------------------------
insert into public.cost_centers (code, name, description, type, active) values
  ('UN-ALMACENAJE', 'Almacenaje',                  'Ingresos/costos de almacenaje',            'unidad_negocio', true),
  ('UN-ANMAT',      'ANMAT',                        'Unidad regulada ANMAT',                    'unidad_negocio', true),
  ('UN-CARGAS',     'Cargas Generales',             'Almacenaje y movimiento de cargas grales', 'unidad_negocio', true),
  ('UN-LOGISTICA',  'Servicios Logísticos',         'Servicios logísticos / 3PL',               'unidad_negocio', true),
  ('UN-TRANSPORTE', 'Transporte / Distribución',    'Transporte y distribución',                'unidad_negocio', true),
  ('UN-OFICINAS',   'Oficinas y Coworking',         'Alquiler de oficinas y coworking',         'unidad_negocio', true),
  ('SEDE-MAGALDI',  'Sede Magaldi 1765',            'Casa central Magaldi',                     'sede',           true),
  ('SEDE-LUJAN',    'Sede Luján 3159',              'Depósito Luján',                           'sede',           true)
on conflict (code) do nothing;

-- -------------------------------------------------------------------------
-- 3. Dimensión cost_center_id donde faltaba.
--    customer_invoices: para rentabilidad de INGRESOS por unidad de negocio.
--    treasury_movements: informativo (ej. gastos bancarios 'ajuste' por CC).
-- -------------------------------------------------------------------------
alter table public.customer_invoices
  add column if not exists cost_center_id uuid references public.cost_centers(id) on delete set null;
create index if not exists customer_invoices_cc_idx on public.customer_invoices (cost_center_id);

alter table public.treasury_movements
  add column if not exists cost_center_id uuid references public.cost_centers(id) on delete set null;
create index if not exists treasury_movements_cc_idx on public.treasury_movements (cost_center_id);

comment on column public.customer_invoices.cost_center_id is
  'Centro de costo / unidad de negocio del ingreso. Lo usa el asiento de venta (0094) para imputar las líneas de Ventas. Asignar ANTES de contabilizar.';

notify pgrst, 'reload schema';
