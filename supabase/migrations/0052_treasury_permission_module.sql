-- =========================================================================
-- 0052_treasury_permission_module.sql — ERP-A1 (Tesorería · Gate 1).
-- Agrega el módulo 'tesoreria' al enum permission_module_t (RBAC).
--
-- ⚠️ DEBE correrse AISLADA y COMMITEARSE antes de 0053. Postgres no permite
--    usar un valor nuevo de enum en la misma transacción que el ALTER TYPE
--    ("unsafe use of new value of enum type"). Mismo patrón que 0021 (wms)
--    y 0029 (pedidos).
--
-- ADDITIVE ONLY. No crea tablas ni toca datos. El seed RBAC del módulo
-- (permissions + role_permissions de 'tesoreria') vive en 0053, que requiere
-- este valor de enum committeado.
-- =========================================================================

alter type public.permission_module_t add value if not exists 'tesoreria';

notify pgrst, 'reload schema';
