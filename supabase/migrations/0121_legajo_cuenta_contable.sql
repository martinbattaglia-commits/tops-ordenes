-- ============================================================
-- Migración 0121 — Cuenta contable en legajos (clientes y proveedores)
-- ------------------------------------------------------------
-- Agrega la cuenta de imputación contable por defecto al legajo de
-- proveedores y clientes. Es la base para la clasificación/imputación
-- automática de gastos e ingresos.
--
-- "Cuenta" / "Plan de Cuentas" del requerimiento  → cuenta_contable
--   (código de chart_of_accounts; sin FK dura — se valida app-side,
--    igual que accounting_rules.account_code).
-- "Categoría Fiscal" del requerimiento → ya existe:
--   clients.condicion_iva (enum condicion_iva_t) / vendors.cond_iva (texto).
--   No se duplica para evitar dos fuentes de verdad.
-- ============================================================

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS cuenta_contable text;
COMMENT ON COLUMN public.vendors.cuenta_contable IS
  'Cuenta de imputación por defecto (código de chart_of_accounts, ej. 6.1.10). Override del fallback accounting_rules para compras de este proveedor.';

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS cuenta_contable text;
COMMENT ON COLUMN public.clients.cuenta_contable IS
  'Cuenta de imputación por defecto (código de chart_of_accounts, ej. 4.1.05). Override del fallback accounting_rules para ventas a este cliente.';
