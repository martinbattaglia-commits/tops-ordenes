-- =========================================================================
-- 0082_accounting_enums.sql — Capa Contable · Prerequisito de enums (aislado)
--
-- Agrega el valor 'contabilidad' al enum permission_module_t. Va AISLADO en su
-- propia migración (y se commitea ANTES de 0084, que lo usa en el seed RBAC),
-- porque Postgres prohíbe usar un valor de enum nuevo en la misma transacción
-- del ALTER TYPE ("unsafe use of new value of enum type"). Mismo patrón que
-- 0056→0057 (cuentas_pagar) y 0052→0053 (tesoreria).
--
-- NATURALEZA: ADITIVA. No crea tablas ni toca datos.
-- =========================================================================

alter type public.permission_module_t add value if not exists 'contabilidad';

notify pgrst, 'reload schema';
