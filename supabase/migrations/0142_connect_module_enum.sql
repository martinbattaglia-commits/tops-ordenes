-- 0142_connect_module_enum.sql — Nexus Link RC1.0.
-- ENTREGADA, NO APLICADA (G3) — verificar el siguiente número libre en prod
-- arsksytgdnzukbmfgkju (schema_migrations) antes de aplicar.
-- ─────────────────────────────────────────────────────────────────────────
-- Agrega el valor 'connect' al enum permission_module_t. AISLADA en su propia
-- migración: Postgres prohíbe USAR un valor de enum recién agregado dentro de
-- la misma transacción → el seed de permisos/roles vive en 0146 (molde 0021/0029/0052).
-- DEPENDE de: permission_module_t (0009_rbac.sql).
-- ─────────────────────────────────────────────────────────────────────────
alter type public.permission_module_t add value if not exists 'connect';

notify pgrst, 'reload schema';
