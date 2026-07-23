-- 0177_knowledge_view_pilot_grant.sql — F5.1-b.0 · D3 (Dirección 2026-07-03, actualizada).
-- ENTREGADA, NO APLICADA (G3). Verificar numeración contra prod (última: 0175/0176).
-- ─────────────────────────────────────────────────────────────────────────────
-- OBJETIVO (D3 actualizada): dar a los usuarios piloto F5 el ACCESO DOCUMENTAL mínimo
-- para usar el Copilot documental bajo RLS — knowledge.view (gate de tabla) +
-- compliance.view (ver filas compliance) + comercial.view (ver filas contrato) — SIN
-- abrirlo a toda la empresa, SIN asignar 'gerencia' completa, SIN activar RBAC_ENFORCE.
-- IDEMPOTENTE y REVERSIBLE (ROLLBACK_0176_0177).
--
-- ACLARACIÓN DIRECCIÓN: `martin@logisticatops.com` y `martin.battaglia@logisticatops.com`
-- son LA MISMA PERSONA (Martín Battaglia, Dirección/superadmin/dev). Supabase los ve como
-- dos auth users distintos → ambos deben quedar ALINEADOS con acceso equivalente al piloto.
-- Ambos están en ai_pilot_users (verificado 2026-07-03), así que asignar el rol a
-- ai_pilot_users cubre las dos cuentas. (martin@ además es admin y ve todo por is_admin();
-- el grant explícito los deja alineados aunque cambie su rol.)
--
-- POR QUÉ UN ROL DEDICADO: el modelo RBAC no tiene permisos por-usuario (no existe
-- public.user_permissions; verificado). El único modo de dar un set de permisos a usuarios
-- puntuales sin ensanchar un rol funcional (p.ej. 'operaciones' o 'gerencia') es un rol
-- mínimo dedicado con ESE set, asignado sólo a los pilotos.
--
-- ESTADO VERIFICADO EN VIVO (2026-07-03): de los 6 pilotos, los supervisores (Cynthia/Ruth/
-- Rinas via 'gerencia') y joseluis@ (admin) YA tienen los 3 permisos; martin@ es admin
-- (ve todo). El único que hoy NO ve documentos es martin.battaglia@ (rol 'operaciones',
-- 0 asignaciones en user_roles). Este rol le da los 3 permisos; para el resto es redundante
-- e inofensivo (has_permission es OR sobre roles). NO amplía acceso a ningún NO-piloto.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Rol mínimo dedicado (acceso documental del piloto; no operativo; se retira al cerrar).
insert into public.roles (slug, name, description, is_system)
values (
  'ai_docs_pilot',
  'Piloto F5 · acceso documental',
  'Acceso documental mínimo para los pilotos del Copilot (D3, 2026-07-03): knowledge.view + compliance.view + comercial.view. No operativo; se retira al cerrar el piloto.',
  false
)
on conflict (slug) do nothing;

-- 2. Permisos del rol: EXACTAMENTE los 3 del acceso documental (ni más ni menos).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.slug in ('knowledge.view', 'compliance.view', 'comercial.view')
where r.slug = 'ai_docs_pilot'
on conflict do nothing;

-- 3. Asignar el rol EXACTAMENTE a los pilotos AI aprobados (ai_pilot_users, 0175).
--    Cubre AMBAS cuentas de Martín (verificado). Se ata a ai_pilot_users para no divergir
--    del set aprobado por Dirección.
insert into public.user_roles (user_id, role_id, assigned_by)
select apu.user_id, r.id, null
from public.ai_pilot_users apu
cross join public.roles r
where r.slug = 'ai_docs_pilot'
on conflict do nothing;

notify pgrst, 'reload schema';
