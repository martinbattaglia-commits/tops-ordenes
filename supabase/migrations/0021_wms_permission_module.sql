-- =========================================================================
-- 0021_wms_permission_module.sql
-- Agrega el módulo 'wms' al enum permission_module_t (RBAC).
--
-- ⚠️ DEBE correrse AISLADA y COMMITEARSE antes de 0022. Postgres no permite
--    usar un valor nuevo de enum en la misma transacción que el ALTER TYPE
--    ("unsafe use of new value of enum type"). Mismo patrón que 0016/0019.
--
-- El módulo 'pedidos' se agrega en su propia migración en FASE 6.
-- =========================================================================

alter type public.permission_module_t add value if not exists 'wms';

notify pgrst, 'reload schema';
