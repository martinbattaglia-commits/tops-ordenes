-- 0167_connect_tasks_enums_permissions.sql — Nexus Link F4.3A (Tareas colaborativas).
-- ENTREGADA, NO APLICADA (G3). Aplicar a mano en el SQL Editor de prod (arsksytgdnzukbmfgkju).
-- ─────────────────────────────────────────────────────────────────────────
-- Migración AISLADA de valores de enum (regla: un valor de enum nuevo NO puede
-- usarse en la misma transacción que lo crea — patrón 0021/0029/0052 + lección
-- C-1 de F4.2). Contiene SOLO:
--   · 'task' en connect_conversation_kind_t → hilo lazy de tareas (ADR §10).
--   · 'task_admin' en permission_action_t → acción del permiso nuevo
--     connect.task_admin. NO se puede usar action='admin': `permissions` tiene
--     UNIQUE (module, action) y ('connect','admin') lo ocupa connect.admin
--     (0146) — gotcha VERIFICADO en la ventana F4.2 (('connect','incident_admin')
--     ídem para incidentes).
-- ⚠️ El SEED del permiso connect.task_admin + grants va en 0168 (tx separada).
--    El mandato de ventana nombró esta migración "enums_permissions": los
--    permisos entran acá como VALOR DE ENUM; el catálogo (INSERT) es imposible
--    en esta tx por la regla de Postgres — ajuste técnico documentado.
-- Los enums PROPIOS de tareas (status/priority) van en 0168 con su tabla
-- (creación normal, no son valores agregados a enums existentes).
-- IDEMPOTENTE (add value if not exists). Rollback: los valores de enum NO son
-- dropeables — residuo aceptado documentado en ROLLBACK_0167_0170.md.
-- ─────────────────────────────────────────────────────────────────────────

alter type public.connect_conversation_kind_t add value if not exists 'task';

alter type public.permission_action_t add value if not exists 'task_admin';

notify pgrst, 'reload schema';
