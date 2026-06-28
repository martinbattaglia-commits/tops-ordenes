-- ============================================================
-- Migración 0120 — Plan de Cuentas (baseline + cuentas Contadora)
-- ------------------------------------------------------------
-- Reconcilia a control de versiones las tablas chart_of_accounts
-- y accounting_rules, que fueron creadas DIRECTO en producción
-- (vía MCP) sin archivo de migración. Idempotente:
--   * En producción es NO-OP salvo por las cuentas de gasto
--     nuevas definidas por la Contadora (2026-06-28).
--   * En un entorno limpio reconstruye el catálogo completo.
--
-- ALCANCE: solo el CATÁLOGO (Plan de Cuentas) + reglas de
-- imputación por defecto. El motor de asientos (journal_entries,
-- acc_post_*) NO se toca aquí: permanece gestionado en prod y es
-- NO-GO sin contador.
-- ============================================================

-- ─── Enum de tipo de cuenta ──────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type_t') THEN
    CREATE TYPE account_type_t AS ENUM
      ('activo','pasivo','patrimonio_neto','ingreso','gasto','orden');
  END IF;
END $$;

-- ─── Catálogo: Plan de Cuentas ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  type        account_type_t NOT NULL,
  subtype     text,
  parent_id   uuid REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  is_postable boolean NOT NULL DEFAULT true,
  is_active   boolean NOT NULL DEFAULT true,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.chart_of_accounts IS
  'Plan de Cuentas jerárquico (GAAP AR). is_system protege cuentas estructurales; is_postable: solo hojas reciben asientos.';

-- ─── Reglas de imputación contable por defecto ───────────────
CREATE TABLE IF NOT EXISTS public.accounting_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type  text NOT NULL,
  rule_key     text NOT NULL,
  account_code text NOT NULL,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, rule_key)
);
COMMENT ON TABLE public.accounting_rules IS
  'Mapeo source_type+rule_key → cuenta contable (por código). Fallback de imputación; el legajo puede sobreescribir con cuenta_contable.';

-- ─── Seed del catálogo (idempotente) ─────────────────────────
-- Paso 1: alta de nodos sin parent (ON CONFLICT preserva prod).
WITH seed(code, name, atype, subtype, is_postable, is_system, parent_code) AS (
  VALUES
    -- 1 ACTIVO
    ('1','ACTIVO','activo',NULL,false,true,NULL),
    ('1.1','Activo Corriente','activo','corriente',false,true,'1'),
    ('1.1.01','Caja','activo','corriente',true,true,'1.1'),
    ('1.1.02','Bancos','activo','corriente',true,true,'1.1'),
    ('1.1.03','Deudores por Ventas','activo','corriente',true,true,'1.1'),
    ('1.1.04','Deudores Morosos / En Gestión','activo','corriente',true,true,'1.1'),
    ('1.1.05','IVA Crédito Fiscal','activo','corriente',true,true,'1.1'),
    ('1.1.06','Percepciones IVA sufridas','activo','corriente',true,true,'1.1'),
    ('1.1.07','Percepciones IIBB sufridas','activo','corriente',true,true,'1.1'),
    ('1.1.08','Retenciones sufridas','activo','corriente',true,true,'1.1'),
    ('1.1.09','Anticipos a Proveedores','activo','corriente',true,true,'1.1'),
    ('1.2','Activo No Corriente','activo','no_corriente',false,true,'1'),
    ('1.2.01','Bienes de Uso','activo','no_corriente',true,true,'1.2'),
    ('1.2.02','Amortización Acumulada Bienes de Uso','activo','no_corriente',true,true,'1.2'),
    -- 2 PASIVO
    ('2','PASIVO','pasivo',NULL,false,true,NULL),
    ('2.1','Pasivo Corriente','pasivo','corriente',false,true,'2'),
    ('2.1.01','Proveedores','pasivo','corriente',true,true,'2.1'),
    ('2.1.02','IVA Débito Fiscal','pasivo','corriente',true,true,'2.1'),
    ('2.1.03','IVA Saldo a Pagar','pasivo','corriente',true,true,'2.1'),
    ('2.1.04','Percepciones IVA a depositar','pasivo','corriente',true,true,'2.1'),
    ('2.1.05','Percepciones IIBB a depositar','pasivo','corriente',true,true,'2.1'),
    ('2.1.06','Retenciones practicadas a depositar','pasivo','corriente',true,true,'2.1'),
    ('2.1.07','Cargas Sociales a Pagar','pasivo','corriente',true,true,'2.1'),
    ('2.1.08','Sueldos a Pagar','pasivo','corriente',true,true,'2.1'),
    ('2.1.09','Anticipos de Clientes','pasivo','corriente',true,true,'2.1'),
    ('2.1.10','Otros Tributos a depositar','pasivo','corriente',true,true,'2.1'),
    ('2.2','Pasivo No Corriente','pasivo','no_corriente',false,true,'2'),
    ('2.2.01','Deudas Financieras a Largo Plazo','pasivo','no_corriente',true,true,'2.2'),
    -- 3 PATRIMONIO NETO
    ('3','PATRIMONIO NETO','patrimonio_neto',NULL,false,true,NULL),
    ('3.1','Capital','patrimonio_neto',NULL,false,true,'3'),
    ('3.1.01','Capital Social','patrimonio_neto',NULL,true,true,'3.1'),
    ('3.2','Resultados','patrimonio_neto',NULL,false,true,'3'),
    ('3.2.01','Resultados No Asignados','patrimonio_neto',NULL,true,true,'3.2'),
    ('3.2.02','Resultado del Ejercicio','patrimonio_neto',NULL,true,true,'3.2'),
    -- 4 INGRESOS
    ('4','INGRESOS','ingreso',NULL,false,true,NULL),
    ('4.1','Ingresos Operativos','ingreso','operativo',false,true,'4'),
    ('4.1.01','Ventas - Almacenaje Cargas Generales','ingreso','operativo',true,true,'4.1'),
    ('4.1.02','Ventas - Almacenaje ANMAT','ingreso','operativo',true,true,'4.1'),
    ('4.1.03','Ventas - Alquiler de Oficinas','ingreso','operativo',true,true,'4.1'),
    ('4.1.04','Ventas - Coworking','ingreso','operativo',true,true,'4.1'),
    ('4.1.05','Ventas - Servicios Logísticos','ingreso','operativo',true,true,'4.1'),
    ('4.1.06','Ventas - Transporte / Distribución','ingreso','operativo',true,true,'4.1'),
    ('4.1.07','Ventas No Gravadas / Exentas','ingreso','operativo',true,true,'4.1'),
    ('4.2','Otros Ingresos','ingreso',NULL,false,true,'4'),
    ('4.2.01','Otros Ingresos Operativos','ingreso',NULL,true,true,'4.2'),
    ('4.2.02','Intereses Ganados','ingreso','financiero',true,true,'4.2'),
    -- 5 COSTOS
    ('5','COSTOS','gasto','costo',false,true,NULL),
    ('5.1','Costo de Servicios','gasto','costo',false,true,'5'),
    ('5.1.01','Costo de Servicios Logísticos','gasto','costo',true,true,'5.1'),
    ('5.1.02','Costo de Transporte','gasto','costo',true,true,'5.1'),
    ('5.1.03','Costo de Depósito','gasto','costo',true,true,'5.1'),
    ('5.1.04','Costo de Personal Operativo','gasto','costo',true,true,'5.1'),
    -- 6 GASTOS
    ('6','GASTOS','gasto','operativo',false,true,NULL),
    ('6.1','Gastos Operativos','gasto','operativo',false,true,'6'),
    ('6.1.01','Gastos de Administración','gasto','operativo',true,true,'6.1'),
    ('6.1.02','Gastos Comerciales','gasto','operativo',true,true,'6.1'),
    ('6.1.03','Sueldos y Jornales','gasto','operativo',true,true,'6.1'),
    ('6.1.04','Cargas Sociales','gasto','operativo',true,true,'6.1'),
    ('6.1.05','Servicios Públicos','gasto','operativo',true,true,'6.1'),
    ('6.1.06','Seguridad','gasto','operativo',true,true,'6.1'),
    ('6.1.07','Mantenimiento','gasto','operativo',true,true,'6.1'),
    ('6.1.08','Honorarios Profesionales','gasto','operativo',true,true,'6.1'),
    ('6.1.09','Seguros','gasto','operativo',true,true,'6.1'),
    ('6.1.10','Otros Gastos Operativos','gasto','operativo',true,true,'6.1'),
    ('6.1.11','Impuestos, Tasas y Contribuciones','gasto','operativo',true,true,'6.1'),
    ('6.1.12','Gastos Bancarios y Financieros','gasto','financiero',true,true,'6.1'),
    ('6.1.13','Amortizaciones del Ejercicio','gasto','operativo',true,true,'6.1'),
    -- 6.1.14+ Cuentas de gasto definidas por la Contadora (gestionables, is_system=false)
    ('6.1.14','Alquileres','gasto','operativo',true,false,'6.1'),
    ('6.1.15','Combustible','gasto','operativo',true,false,'6.1'),
    ('6.1.16','Gastos de Representación','gasto','operativo',true,false,'6.1'),
    ('6.1.17','Telefonía','gasto','operativo',true,false,'6.1'),
    ('6.1.18','Internet','gasto','operativo',true,false,'6.1'),
    ('6.1.19','Celulares','gasto','operativo',true,false,'6.1'),
    ('6.1.20','Mantenimiento de Software','gasto','operativo',true,false,'6.1'),
    ('6.1.21','Medicina Laboral','gasto','operativo',true,false,'6.1'),
    ('6.1.22','Ropa de Trabajo','gasto','operativo',true,false,'6.1'),
    ('6.1.23','Movilidad','gasto','operativo',true,false,'6.1'),
    ('6.1.24','Viáticos','gasto','operativo',true,false,'6.1'),
    ('6.1.25','Publicidad','gasto','operativo',true,false,'6.1')
)
INSERT INTO public.chart_of_accounts (code, name, type, subtype, is_postable, is_system)
SELECT code, name, atype::account_type_t, subtype, is_postable, is_system
FROM seed
ON CONFLICT (code) DO NOTHING;

-- Paso 2: resolver parent_id por código (no-op donde ya está correcto).
WITH seed(code, parent_code) AS (
  VALUES
    ('1.1','1'),('1.1.01','1.1'),('1.1.02','1.1'),('1.1.03','1.1'),('1.1.04','1.1'),
    ('1.1.05','1.1'),('1.1.06','1.1'),('1.1.07','1.1'),('1.1.08','1.1'),('1.1.09','1.1'),
    ('1.2','1'),('1.2.01','1.2'),('1.2.02','1.2'),
    ('2.1','2'),('2.1.01','2.1'),('2.1.02','2.1'),('2.1.03','2.1'),('2.1.04','2.1'),
    ('2.1.05','2.1'),('2.1.06','2.1'),('2.1.07','2.1'),('2.1.08','2.1'),('2.1.09','2.1'),
    ('2.1.10','2.1'),('2.2','2'),('2.2.01','2.2'),
    ('3.1','3'),('3.1.01','3.1'),('3.2','3'),('3.2.01','3.2'),('3.2.02','3.2'),
    ('4.1','4'),('4.1.01','4.1'),('4.1.02','4.1'),('4.1.03','4.1'),('4.1.04','4.1'),
    ('4.1.05','4.1'),('4.1.06','4.1'),('4.1.07','4.1'),('4.2','4'),('4.2.01','4.2'),('4.2.02','4.2'),
    ('5.1','5'),('5.1.01','5.1'),('5.1.02','5.1'),('5.1.03','5.1'),('5.1.04','5.1'),
    ('6.1','6'),('6.1.01','6.1'),('6.1.02','6.1'),('6.1.03','6.1'),('6.1.04','6.1'),
    ('6.1.05','6.1'),('6.1.06','6.1'),('6.1.07','6.1'),('6.1.08','6.1'),('6.1.09','6.1'),
    ('6.1.10','6.1'),('6.1.11','6.1'),('6.1.12','6.1'),('6.1.13','6.1'),('6.1.14','6.1'),
    ('6.1.15','6.1'),('6.1.16','6.1'),('6.1.17','6.1'),('6.1.18','6.1'),('6.1.19','6.1'),
    ('6.1.20','6.1'),('6.1.21','6.1'),('6.1.22','6.1'),('6.1.23','6.1'),('6.1.24','6.1'),('6.1.25','6.1')
)
UPDATE public.chart_of_accounts c
SET parent_id = p.id
FROM seed s
JOIN public.chart_of_accounts p ON p.code = s.parent_code
WHERE c.code = s.code
  AND c.parent_id IS DISTINCT FROM p.id;

-- ─── Seed de reglas de imputación por defecto (idempotente) ───
INSERT INTO public.accounting_rules (source_type, rule_key, account_code, notes) VALUES
  ('customer_invoice','receivable','1.1.03','Deudores por Ventas'),
  ('customer_invoice','revenue','4.1.05','(*) Ventas — default servicios logísticos'),
  ('customer_invoice','revenue_exento','4.1.07','No gravado / exento'),
  ('customer_invoice','iva_debito','2.1.02','IVA Débito Fiscal'),
  ('customer_invoice','percepciones_a_depositar','2.1.04','(*) Percepciones IVA a depositar (agente percepción)'),
  ('customer_invoice','otros_tributos_a_depositar','2.1.10','(*) Otros tributos a depositar'),
  ('customer_receipt','receivable','1.1.03','Deudores por Ventas'),
  ('customer_receipt','bank','1.1.02','Bancos'),
  ('customer_receipt','caja','1.1.01','Caja'),
  ('customer_receipt','retencion_sufrida','1.1.08','Retenciones sufridas'),
  ('supplier_invoice','payable','2.1.01','Proveedores'),
  ('supplier_invoice','expense','6.1.10','(*) Gasto — default otros gastos operativos'),
  ('supplier_invoice','iva_credito','1.1.05','IVA Crédito Fiscal'),
  ('supplier_invoice','percepciones_sufridas','1.1.06','(*) Percepciones sufridas (a computar)'),
  ('supplier_payment','payable','2.1.01','Proveedores'),
  ('supplier_payment','bank','1.1.02','Bancos'),
  ('supplier_payment','caja','1.1.01','Caja'),
  ('supplier_payment','retencion_practicada','2.1.06','Retenciones practicadas a depositar (cuando exista el dato)')
ON CONFLICT (source_type, rule_key) DO NOTHING;

-- ─── RLS (reconcilia las políticas vigentes en prod) ─────────
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_rules  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coa read internal" ON public.chart_of_accounts;
CREATE POLICY "coa read internal" ON public.chart_of_accounts FOR SELECT
  USING ("current_role"() = ANY (ARRAY['admin','operaciones','supervisor']::user_role_t[])
         OR has_permission('contabilidad.view'));

DROP POLICY IF EXISTS "coa write" ON public.chart_of_accounts;
CREATE POLICY "coa write" ON public.chart_of_accounts FOR ALL
  USING ("current_role"() = 'admin'::user_role_t OR has_permission('contabilidad.edit'))
  WITH CHECK ("current_role"() = 'admin'::user_role_t OR has_permission('contabilidad.edit'));

DROP POLICY IF EXISTS "acc_rules read internal" ON public.accounting_rules;
CREATE POLICY "acc_rules read internal" ON public.accounting_rules FOR SELECT
  USING ("current_role"() = ANY (ARRAY['admin','operaciones','supervisor']::user_role_t[])
         OR has_permission('contabilidad.view'));

DROP POLICY IF EXISTS "acc_rules write" ON public.accounting_rules;
CREATE POLICY "acc_rules write" ON public.accounting_rules FOR ALL
  USING ("current_role"() = 'admin'::user_role_t OR has_permission('contabilidad.edit'))
  WITH CHECK ("current_role"() = 'admin'::user_role_t OR has_permission('contabilidad.edit'));

-- Índice de apoyo para lecturas jerárquicas.
CREATE INDEX IF NOT EXISTS chart_of_accounts_parent_idx ON public.chart_of_accounts(parent_id);
CREATE INDEX IF NOT EXISTS chart_of_accounts_type_idx   ON public.chart_of_accounts(type);
