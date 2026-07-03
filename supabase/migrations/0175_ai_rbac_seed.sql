-- 0175_ai_rbac_seed.sql — F5.2-lite · Nexus AI Copilot read-only.
-- ✅ APLICADA EN PROD 2026-07-03 (ventana autorizada; ver F5-2-LITE-EXECUTION-LOG.md)
-- ─────────────────────────────────────────────────────────────────────────
-- 1. Permisos del módulo 'ai' en el catálogo RBAC (futuro-proofing: el gate
--    EFECTIVO del piloto es ai_pilot_users, decisión Dirección 2026-07-03;
--    NO se seedean role_permissions para no ensanchar acceso cuando RBAC
--    se active — eso será decisión explícita posterior).
-- 2. Seed de ai_pilot_users desde profiles por email REAL verificado
--    (re-verificación 2026-07-03: los 5 pilotos existen en profiles;
--    joseluis@logisticatops.com confirmado con role=admin, mismo id en
--    profiles y auth.users, email confirmado).
-- DEPENDE de: 0173 (enum 'ai'), 0174 (ai_pilot_users), permissions (0009).
-- IDEMPOTENTE (on conflict do nothing). Rollback: ROLLBACK_0173_0175.md.
-- ─────────────────────────────────────────────────────────────────────────

insert into public.permissions (slug, module, action, label, description) values
  ('ai.view',  'ai', 'view',  'Usar Nexus Copilot',       'Consultas read-only al Copilot (gate real del piloto: ai_pilot_users)'),
  ('ai.admin', 'ai', 'admin', 'Administrar Nexus Copilot', 'Ver auditoría ai_* completa y gestionar el piloto')
on conflict (slug) do nothing;

-- Pilotos aprobados por Dirección (D-F5-5, verificados en profiles 2026-07-03).
insert into public.ai_pilot_users (user_id, note)
select p.id, 'piloto F5.2-lite (D-F5-5)'
from public.profiles p
where lower(p.email) in (
  'martin.battaglia@logisticatops.com',
  'cynthia@logisticatops.com',
  'ruth@logisticatops.com',
  'martinrinas@logisticatops.com',
  'joseluis@logisticatops.com'
)
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';
