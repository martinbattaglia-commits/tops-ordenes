-- =========================================================================
-- 0084_accounting_seed.sql — Capa Contable · Plan de cuentas base + reglas de
--                            imputación + RBAC 'contabilidad'
--
-- Plan de cuentas mínimo viable para una empresa argentina de logística/3PL
-- (Logística TOPS / VEROTIN S.A.). Es SEED idempotente y EDITABLE desde la DB
-- (is_system protege la estructura; el resto es gestionable). Las cuentas hoja
-- (is_postable=true) reciben asientos; los rubros son contenedores.
--
-- ⚠️ Las cuentas marcadas con (*) son DEFAULTS de imputación pendientes de
--    validación con el contador externo (ver docs/contabilidad-nexus.md §
--    "Recomendaciones para validación con contador"). La estructura es flexible:
--    se ajustan editando accounting_rules sin tocar código.
--
-- Requiere 0082 (permission_module_t='contabilidad') y 0083 (tablas).
-- NATURALEZA: ADITIVA e idempotente.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Plan de cuentas (sin parent_id; se enlaza por prefijo en el paso 2)
-- -------------------------------------------------------------------------
insert into public.chart_of_accounts (code, name, type, subtype, is_postable, is_system) values
  -- ACTIVO
  ('1',      'ACTIVO',                                'activo',          null,            false, true),
  ('1.1',    'Activo Corriente',                      'activo',          'corriente',     false, true),
  ('1.1.01', 'Caja',                                  'activo',          'corriente',     true,  true),
  ('1.1.02', 'Bancos',                                'activo',          'corriente',     true,  true),
  ('1.1.03', 'Deudores por Ventas',                   'activo',          'corriente',     true,  true),
  ('1.1.04', 'Deudores Morosos / En Gestión',         'activo',          'corriente',     true,  true),
  ('1.1.05', 'IVA Crédito Fiscal',                    'activo',          'corriente',     true,  true),
  ('1.1.06', 'Percepciones IVA sufridas',             'activo',          'corriente',     true,  true),
  ('1.1.07', 'Percepciones IIBB sufridas',            'activo',          'corriente',     true,  true),
  ('1.1.08', 'Retenciones sufridas',                  'activo',          'corriente',     true,  true),
  ('1.1.09', 'Anticipos a Proveedores',               'activo',          'corriente',     true,  true),
  ('1.2',    'Activo No Corriente',                   'activo',          'no_corriente',  false, true),
  ('1.2.01', 'Bienes de Uso',                         'activo',          'no_corriente',  true,  true),
  ('1.2.02', 'Amortización Acumulada Bienes de Uso',  'activo',          'no_corriente',  true,  true),
  -- PASIVO
  ('2',      'PASIVO',                                'pasivo',          null,            false, true),
  ('2.1',    'Pasivo Corriente',                      'pasivo',          'corriente',     false, true),
  ('2.1.01', 'Proveedores',                           'pasivo',          'corriente',     true,  true),
  ('2.1.02', 'IVA Débito Fiscal',                     'pasivo',          'corriente',     true,  true),
  ('2.1.03', 'IVA Saldo a Pagar',                     'pasivo',          'corriente',     true,  true),
  ('2.1.04', 'Percepciones IVA a depositar',          'pasivo',          'corriente',     true,  true),
  ('2.1.05', 'Percepciones IIBB a depositar',         'pasivo',          'corriente',     true,  true),
  ('2.1.06', 'Retenciones practicadas a depositar',   'pasivo',          'corriente',     true,  true),
  ('2.1.07', 'Cargas Sociales a Pagar',               'pasivo',          'corriente',     true,  true),
  ('2.1.08', 'Sueldos a Pagar',                       'pasivo',          'corriente',     true,  true),
  ('2.1.09', 'Anticipos de Clientes',                 'pasivo',          'corriente',     true,  true),
  ('2.1.10', 'Otros Tributos a depositar',            'pasivo',          'corriente',     true,  true),
  ('2.2',    'Pasivo No Corriente',                   'pasivo',          'no_corriente',  false, true),
  ('2.2.01', 'Deudas Financieras a Largo Plazo',      'pasivo',          'no_corriente',  true,  true),
  -- PATRIMONIO NETO
  ('3',      'PATRIMONIO NETO',                       'patrimonio_neto', null,            false, true),
  ('3.1',    'Capital',                               'patrimonio_neto', null,            false, true),
  ('3.1.01', 'Capital Social',                        'patrimonio_neto', null,            true,  true),
  ('3.2',    'Resultados',                            'patrimonio_neto', null,            false, true),
  ('3.2.01', 'Resultados No Asignados',               'patrimonio_neto', null,            true,  true),
  ('3.2.02', 'Resultado del Ejercicio',              'patrimonio_neto', null,            true,  true),
  -- INGRESOS
  ('4',      'INGRESOS',                              'ingreso',         null,            false, true),
  ('4.1',    'Ingresos Operativos',                   'ingreso',         'operativo',     false, true),
  ('4.1.01', 'Ventas - Almacenaje Cargas Generales',  'ingreso',         'operativo',     true,  true),
  ('4.1.02', 'Ventas - Almacenaje ANMAT',             'ingreso',         'operativo',     true,  true),
  ('4.1.03', 'Ventas - Alquiler de Oficinas',         'ingreso',         'operativo',     true,  true),
  ('4.1.04', 'Ventas - Coworking',                    'ingreso',         'operativo',     true,  true),
  ('4.1.05', 'Ventas - Servicios Logísticos',         'ingreso',         'operativo',     true,  true),
  ('4.1.06', 'Ventas - Transporte / Distribución',    'ingreso',         'operativo',     true,  true),
  ('4.1.07', 'Ventas No Gravadas / Exentas',          'ingreso',         'operativo',     true,  true),
  ('4.2',    'Otros Ingresos',                        'ingreso',         null,            false, true),
  ('4.2.01', 'Otros Ingresos Operativos',             'ingreso',         null,            true,  true),
  ('4.2.02', 'Intereses Ganados',                     'ingreso',         'financiero',    true,  true),
  -- COSTOS (type gasto)
  ('5',      'COSTOS',                                'gasto',           'costo',         false, true),
  ('5.1',    'Costo de Servicios',                    'gasto',           'costo',         false, true),
  ('5.1.01', 'Costo de Servicios Logísticos',         'gasto',           'costo',         true,  true),
  ('5.1.02', 'Costo de Transporte',                   'gasto',           'costo',         true,  true),
  ('5.1.03', 'Costo de Depósito',                     'gasto',           'costo',         true,  true),
  ('5.1.04', 'Costo de Personal Operativo',           'gasto',           'costo',         true,  true),
  -- GASTOS
  ('6',      'GASTOS',                                'gasto',           'operativo',     false, true),
  ('6.1',    'Gastos Operativos',                     'gasto',           'operativo',     false, true),
  ('6.1.01', 'Gastos de Administración',              'gasto',           'operativo',     true,  true),
  ('6.1.02', 'Gastos Comerciales',                    'gasto',           'operativo',     true,  true),
  ('6.1.03', 'Sueldos y Jornales',                    'gasto',           'operativo',     true,  true),
  ('6.1.04', 'Cargas Sociales',                       'gasto',           'operativo',     true,  true),
  ('6.1.05', 'Servicios Públicos',                    'gasto',           'operativo',     true,  true),
  ('6.1.06', 'Seguridad',                             'gasto',           'operativo',     true,  true),
  ('6.1.07', 'Mantenimiento',                         'gasto',           'operativo',     true,  true),
  ('6.1.08', 'Honorarios Profesionales',              'gasto',           'operativo',     true,  true),
  ('6.1.09', 'Seguros',                               'gasto',           'operativo',     true,  true),
  ('6.1.10', 'Otros Gastos Operativos',               'gasto',           'operativo',     true,  true),
  ('6.1.11', 'Impuestos, Tasas y Contribuciones',     'gasto',           'operativo',     true,  true),
  ('6.1.12', 'Gastos Bancarios y Financieros',        'gasto',           'financiero',    true,  true),
  ('6.1.13', 'Amortizaciones del Ejercicio',          'gasto',           'operativo',     true,  true)
on conflict (code) do nothing;

-- -------------------------------------------------------------------------
-- 2. Enlazar parent_id por prefijo de código ('1.1.03' → '1.1' → '1').
--    Idempotente (solo escribe si cambia).
-- -------------------------------------------------------------------------
update public.chart_of_accounts c
set parent_id = p.id
from public.chart_of_accounts p
where position('.' in c.code) > 0
  and p.code = substr(c.code, 1, length(c.code) - position('.' in reverse(c.code)))
  and c.parent_id is distinct from p.id;

-- -------------------------------------------------------------------------
-- 3. accounting_rules — mapeo configurable evento → cuenta (por código).
--    Las RPC de posteo (0085) resuelven la cuenta por (source_type, rule_key).
--    Editar acá reimputa SIN tocar código.
-- -------------------------------------------------------------------------
create table if not exists public.accounting_rules (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  rule_key text not null,
  account_code text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, rule_key)
);

drop trigger if exists trg_accounting_rules_updated_at on public.accounting_rules;
create trigger trg_accounting_rules_updated_at
before update on public.accounting_rules
for each row execute function public.touch_updated_at();

alter table public.accounting_rules enable row level security;
drop policy if exists "acc_rules read internal" on public.accounting_rules;
create policy "acc_rules read internal" on public.accounting_rules for select
  using (public.current_role() in ('admin','operaciones','supervisor')
         or public.has_permission('contabilidad.view'));
drop policy if exists "acc_rules write" on public.accounting_rules;
create policy "acc_rules write" on public.accounting_rules for all
  using (public.current_role() = 'admin' or public.has_permission('contabilidad.edit'))
  with check (public.current_role() = 'admin' or public.has_permission('contabilidad.edit'));

insert into public.accounting_rules (source_type, rule_key, account_code, notes) values
  -- Factura de venta (débito fiscal). revenue (*) default; en el futuro se
  -- desglosa por tipo de servicio / centro de costo.
  ('customer_invoice', 'receivable',                '1.1.03', 'Deudores por Ventas'),
  ('customer_invoice', 'revenue',                   '4.1.05', '(*) Ventas — default servicios logísticos'),
  ('customer_invoice', 'revenue_exento',            '4.1.07', 'No gravado / exento'),
  ('customer_invoice', 'iva_debito',                '2.1.02', 'IVA Débito Fiscal'),
  ('customer_invoice', 'percepciones_a_depositar',  '2.1.04', '(*) Percepciones IVA a depositar (agente percepción)'),
  ('customer_invoice', 'otros_tributos_a_depositar','2.1.10', '(*) Otros tributos a depositar'),
  -- Factura de compra (crédito fiscal). expense (*) default; se desglosa luego.
  ('supplier_invoice', 'payable',                   '2.1.01', 'Proveedores'),
  ('supplier_invoice', 'expense',                   '6.1.10', '(*) Gasto — default otros gastos operativos'),
  ('supplier_invoice', 'iva_credito',               '1.1.05', 'IVA Crédito Fiscal'),
  ('supplier_invoice', 'percepciones_sufridas',     '1.1.06', '(*) Percepciones sufridas (a computar)'),
  -- Cobranza de cliente
  ('customer_receipt', 'receivable',                '1.1.03', 'Deudores por Ventas'),
  ('customer_receipt', 'bank',                      '1.1.02', 'Bancos'),
  ('customer_receipt', 'caja',                      '1.1.01', 'Caja'),
  ('customer_receipt', 'retencion_sufrida',         '1.1.08', 'Retenciones sufridas'),
  -- Pago a proveedor
  ('supplier_payment', 'payable',                   '2.1.01', 'Proveedores'),
  ('supplier_payment', 'bank',                      '1.1.02', 'Bancos'),
  ('supplier_payment', 'caja',                      '1.1.01', 'Caja'),
  ('supplier_payment', 'retencion_practicada',      '2.1.06', 'Retenciones practicadas a depositar (cuando exista el dato)')
on conflict (source_type, rule_key) do nothing;

-- -------------------------------------------------------------------------
-- 4. RBAC — catálogo de permisos 'contabilidad' + mapeo a roles.
--    Requiere permission_module_t='contabilidad' (0082). Acciones del enum
--    fijo permission_action_t. unique(module,action) → 1 permiso por acción.
-- -------------------------------------------------------------------------
insert into public.permissions (slug, module, action, label, description) values
  ('contabilidad.view',   'contabilidad', 'view',   'Ver contabilidad',          'Plan de cuentas, libro diario, mayor, balance, posición IVA'),
  ('contabilidad.create', 'contabilidad', 'create', 'Contabilizar / asientos',   'Generar asientos automáticos y manuales, backfill'),
  ('contabilidad.edit',   'contabilidad', 'edit',   'Editar plan de cuentas',    'ABM de cuentas y reglas de imputación'),
  ('contabilidad.export', 'contabilidad', 'export', 'Exportar contabilidad',     'Exportar libros y reportes contables'),
  ('contabilidad.admin',  'contabilidad', 'admin',  'Administrar / cerrar período','Cierre/bloqueo de períodos contables')
on conflict (slug) do nothing;

-- director_ops y admin: control total contable
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug in ('director_ops','admin') and p.module = 'contabilidad'
on conflict do nothing;

-- administracion_finanzas (rol financiero, 0070): control total contable (si existe)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'administracion_finanzas' and p.module = 'contabilidad'
on conflict do nothing;

-- compliance: ver + exportar
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'compliance' and p.slug in ('contabilidad.view','contabilidad.export')
on conflict do nothing;

notify pgrst, 'reload schema';
