-- =========================================================================
-- 0029_pedidos_permission_module.sql — FASE 9B (Gate 1).
-- Agrega el módulo 'pedidos' al enum permission_module_t (RBAC).
--
-- ⚠️ DEBE correrse AISLADA y COMMITEARSE antes de 0030. Postgres no permite
--    usar un valor nuevo de enum en la misma transacción que el ALTER TYPE
--    ("unsafe use of new value of enum type"). Mismo patrón que 0021 (wms).
--
-- ADDITIVE ONLY. No crea tablas ni toca datos. El seed RBAC del módulo
-- (permissions + role_permissions de 'pedidos') vive en 0030, ya que requiere
-- este valor de enum committeado.
-- =========================================================================

alter type public.permission_module_t add value if not exists 'pedidos';

notify pgrst, 'reload schema';
