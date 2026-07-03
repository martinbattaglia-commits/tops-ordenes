-- 0173_ai_module_enum.sql — F5.2-lite · Nexus AI Copilot read-only.
-- ✅ APLICADA EN PROD 2026-07-03 (ventana autorizada; ver F5-2-LITE-EXECUTION-LOG.md)
-- ─────────────────────────────────────────────────────────────────────────
-- Agrega el valor 'ai' al enum permission_module_t. AISLADA en su propia
-- migración: Postgres prohíbe USAR un valor de enum recién agregado dentro de
-- la misma transacción → el seed de permisos vive en 0175 (molde 0142/0146).
-- DEPENDE de: permission_module_t (0009_rbac.sql).
-- Rollback: los valores de enum NO se pueden quitar → ver ROLLBACK_0173_0175.md.
-- ─────────────────────────────────────────────────────────────────────────
alter type public.permission_module_t add value if not exists 'ai';

notify pgrst, 'reload schema';
