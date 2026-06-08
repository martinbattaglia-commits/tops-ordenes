# TOPS NEXUS — RRHH · R2 IMPLEMENTATION PLAN
## R2 — RBAC FOUNDATION · `0057_rrhh_rbac_seed`

> **Autorización:** Dirección — apertura R2 (alcance: permissions + roles + role_permissions).
> **Modelo:** `RRHH_R2_ARCHITECTURE_AMENDMENT.md` (OPCIÓN 1) + `RRHH_R2_AMENDMENT_AUDIT.md` (OPTION A).
> **Metodología:** Preflight → Diseño → Implementación → Auditoría → Verificación Producción → Cierre.
> **Producción:** `arsksytgdnzukbmfgkju`. **Fecha:** 2026-06-07.

---

## 1. Objetivo
Sembrar el catálogo RBAC del módulo RRHH (permisos gruesos + roles + mapeo), habilitando la
autorización de las funciones de RRHH que se construirán en R3+. **Nada más.**

## 2. Alcance estricto
**Incluye:** `0057_rrhh_rbac_seed` con INSERTs a `permissions`, `roles`, `role_permissions`.
**NO incluye:** tablas, RPCs, RLS, buckets, UI (R3+); modificación de `user_role_t`, de otros
dominios, ni de `permission_action_t`/`permission_module_t`.

## 3. Precondición obligatoria
`'rrhh'` presente en `permission_module_t` (migración `0056`, R1).
- Lado repo: ✅ `0056` agrega `'rrhh'`.
- Lado producción: atestado aplicado/verificado por Dirección (R1 CLOSED). **Reconfirmar en el
  preflight del operador** antes de aplicar `0057` (si faltara, el INSERT con `module='rrhh'` falla).

## 4. Diseño del seed (resumen; SQL en el artefacto)
- **permissions (5):** `rrhh.view/create/edit/export/admin` (omite `delete`=append-only, `sign`=N/A).
- **roles (4):** `rrhh_admin`, `rrhh_manager`, `rrhh_viewer`, `employee_self_service` (`is_system=true`).
- **role_permissions:** admin=todos · manager=view/create/edit/export · viewer=export · ess=ninguno.
- Idempotente (`on conflict do nothing`) + `notify pgrst`. Patrón `0053 §11`.

## 5. Procedimiento (referencia ERP-A / R1)
1. Rama dedicada · 2. Crear `0057` · 3. Commit aislado · 4. Aplicar manual en prod (controlado,
backup, ventana, operador único) · 5. Verificar (§6) · 6. Cierre.

## 6. Verificación post-aplicación (read-only, para el operador)
```
☐ 5 permisos rrhh.* presentes en permissions (module='rrhh')
☐ 4 roles rrhh_* presentes en roles
☐ role_permissions: admin=5, manager=4, viewer=1, ess=0
☐ unique(module,action) respetado (sin error de duplicado)
☐ Sin tablas/RPC/RLS/buckets RRHH (alcance R2)
☐ Dominios existentes intactos; producción estable
```

## 7. Riesgos
| Tipo | Riesgo | Sev. | Mitigación |
|------|--------|------|-----------|
| Técnico | `'rrhh'` no aplicado en prod → INSERT falla | Media | Reconfirmar precondición en preflight |
| Técnico | Número `0057` tomado por otra rama | Baja | Re-verificar libre antes de aplicar |
| Funcional | Esperar "RRHH funcionando" tras R2 | Baja | R2 es solo catálogo RBAC; sin datos/UI |
| Seguridad | Ninguno nuevo (sin datos/RLS/PII aún) | — | RLS/PII llegan en R3+ |
| Producción | Aplicar sin backup | Alta (si se omite) | Preflight exige backup + ventana + operador único |

## 8. GO / NO-GO
**GO si:** aprobación Dirección ✅ · `'rrhh'` en prod ✅ · `0057` libre ✅ · backup ✅.
**NO-GO si:** falta cualquiera, o desviación del alcance.

---
*Plan R2 — el artefacto se entrega listo; la aplicación en prod es paso manual controlado.*
