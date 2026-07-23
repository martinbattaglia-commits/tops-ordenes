-- 0155_connect_rbac_pilot_grants.sql — Fase 3 (Integración Productiva de Nexus Link).
-- ENTREGADA, NO APLICADA (G3). Aprobada por Dirección (cierre RBAC F3.2A, 2026-06-30).
-- ─────────────────────────────────────────────────────────────────────────
-- ÚNICA responsabilidad: ampliar el CATÁLOGO RBAC (public.role_permissions) al alcance del PILOTO
-- aprobado por Dirección — suma los roles gerencia, jefe_deposito y rrhh_admin a connect.*.
-- NO modifica 0146 (intacta, historial). Estrategia B (nueva migración correctiva, append-only).
-- IDEMPOTENTE: on conflict do nothing (árbitro = PK role_permissions(role_id, permission_id), verificado en prod).
-- NO toca tablas funcionales, RLS, RPC, triggers, realtime ni estructuras existentes. Solo catálogo.
-- Fail-closed: externos (cliente_b2b/employee_self_service/rrhh_manager/rrhh_viewer) NO reciben connect.*.
-- Decisiones de Dirección: rrhh_admin y seguridad = view+create (sin edit/admin/delete).
-- DEPENDE de: 0146 (permisos connect.* + grants base) · 0009 (roles/permissions/role_permissions).
-- ─────────────────────────────────────────────────────────────────────────

-- view + create (participación base): roles operativos/management nuevos del piloto.
insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id
from public.roles ro
join public.permissions p on p.slug in ('connect.view','connect.create')
where ro.slug in ('gerencia','jefe_deposito','rrhh_admin')
on conflict do nothing;

-- edit (moderar / vincular entidades): management + jefatura operativa.
-- rrhh_admin y seguridad NO moderan (Decisión Dirección 1 y 2).
insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id
from public.roles ro
join public.permissions p on p.slug = 'connect.edit'
where ro.slug in ('gerencia','jefe_deposito')
on conflict do nothing;

-- admin / delete: SIN cambios (solo admin + director_ops, definido en 0146). NO se amplía (mínimo privilegio).

notify pgrst, 'reload schema';
