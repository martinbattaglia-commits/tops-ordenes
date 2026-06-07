-- =========================================================================
-- 0056_rrhh_permission_module.sql — RRHH (Foundation · Gate R1).
-- Agrega el módulo 'rrhh' al enum permission_module_t (RBAC).
--
-- ⚠️ DEBE correrse AISLADA y COMMITEARSE antes de 0057. Postgres no permite
--    usar un valor nuevo de enum en la misma transacción que el ALTER TYPE
--    ("unsafe use of new value of enum type"). Mismo patrón que 0021 (wms),
--    0029 (pedidos) y 0052 (tesoreria).
--
-- ADDITIVE ONLY. No crea tablas ni toca datos. El seed RBAC del módulo
-- (permissions rrhh.* + roles RRHH + role_permissions) vive en 0057, que
-- requiere este valor de enum committeado.
--
-- Diseño congelado: docs/handoff/RRHH_MASTER_ARCHITECTURE_v2_0.md (§7, §8).
-- Plan de apertura: docs/handoff/RRHH_R1_IMPLEMENTATION_PLAN.md.
-- Autorización: Dirección — apertura R1 (RRHH Foundation).
-- =========================================================================

alter type public.permission_module_t add value if not exists 'rrhh';

notify pgrst, 'reload schema';
