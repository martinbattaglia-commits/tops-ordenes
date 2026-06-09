# RBAC-PERMISSION-AUDIT — TOPS NEXUS

**Fecha:** 2026-06-08 · Auditoría RBAC previa al cambio de permisos de **Gerencia Comercial** y **Finanzas y Administración**.
**Sin modificar nada.** Evidencia con file:line.

---

## 0. Hallazgo crítico (cambia el alcance)
El sistema RBAC está **dormido** (`user_roles`=0 → fail-open global; `RBAC_ENFORCE` sin setear). "Gerencia Comercial" y "Finanzas y Administración" **no existen como roles en la base**. No es un ajuste de 2 roles: requiere crear roles/permisos y activar enforcement.

## 0.bis ⚠️ CONFLICTO con spec aprobado previo (decisión de gobernanza)
Existe un spec **previo y aprobado** — `RBAC-PERMISSIONS-UPDATE-REPORT.md` (F3 §8) — que ya define la matriz de estos 2 roles con **SEPARACIÓN DE PODERES**:
- **GERENCIA_COMERCIAL bloqueado en:** `tesoreria.*`, `cuentas_pagar.*`, `analytics.view`, `compliance.*`, `documental.*` (Drive), `pedidos.*`, `cctv.*`, `rrhh.*` (salvo `mi_espacio.view`), `sistema.admin`. Habilitado: cockpit.view, comercial.*, compras.*, servicios/operaciones.*, wms.*, mi_espacio.view.
- **ADMIN_FINANZAS bloqueado en:** `comercial.*`, `compliance.*`, `documental.*`, `pedidos.*`, `cctv.*`, `rrhh.*` (salvo mi_espacio), `sistema.admin`. Habilitado: cockpit/analytics/tesoreria/cuentas_pagar/compras, servicios/operaciones.*, wms.*, mi_espacio.view.

**Tu pedido actual contradice eso:** otorga a AMBOS roles casi-todo (incluye Compliance, Drive, Pedidos, Tesorería, Facturación, Cockpit completo, Comercial completo, RRHH salvo Documentación), bloqueando solo **Sistema** + **RRHH→Documentación**. Es decir, **elimina la separación de poderes** (Comercial⟂Finanzas) que el spec F3 había aprobado como control de seguridad.

→ **Decisión requerida (tuya):** ¿el pedido nuevo **deroga** la matriz F3 (acceso casi-total para ambos), o se mantiene la separación de poderes? No implemento sin que lo confirmes explícitamente, porque elimina un control de seguridad previamente aprobado.

---

## 1. Roles actuales — 3 taxonomías distintas
| Fuente | Roles | Estado |
|---|---|---|
| `src/lib/rbac/types.ts` `APP_ROLES` | super_admin, admin_operativo, **gerencia_comercial**, **administracion_finanzas**, jefe_deposito_central, jefe_deposito_anexa, cliente_b2b | solo TypeScript |
| `src/lib/rbac/data.ts` `SEED_ROLES` (mock) | director, administracion, operaciones, comercial, deposito, auditor | mock fallback |
| **Prod DB real** (auditado service-role, ver `RBAC-QA-REPORT.md`) | **11 roles legacy:** admin, cliente_b2b, comercial, compliance, director_ops, employee_self_service, operaciones, rrhh_admin, rrhh_manager, rrhh_viewer, seguridad · `role_permissions`=141 | **lo que está en prod** |

→ **`gerencia_comercial` / `administracion_finanzas` NO existen en la DB** (confirmado contra prod: ausentes; y `grep` migraciones = 0). Solo existen como literal en `types.ts`. La matriz "definitiva" de los 6 roles vive en el spec `RBAC-PERMISSIONS-UPDATE-REPORT.md`, nunca migrada.

## 2. Catálogo de permisos actual
- **Prod DB real = 52 permisos** seedeados (catálogo OK; incluye cockpit/compras/servicios/comercial/compliance/cctv/documental/analytics/sistema/wms/pedidos/tesoreria/cuentas_pagar/rrhh/mi_espacio). (El `SEED_PERMISSIONS` mock de `data.ts` solo lista 22 — desactualizado vs. DB.)
- **NO existe** `rrhh.documentacion` granular (RRHH→Documentación se gatea con `rrhh.view`, igual que todo RRHH).
- **NO existe** `sistema.view` por subítem (solo `sistema.admin`, que el sidebar **no** usa).
- tracking: sin permisos explícitos.

## 3. Realidad de enforcement (dónde se aplica HOY)
| Superficie | Enforcement | Evidencia |
|---|---|---|
| **Middleware** (`src/lib/supabase/middleware.ts`) | **Solo auth/sesión.** Sin checks de permiso. | updateSession: 401/redirect si no hay sesión |
| **Sidebar** (`Sidebar.tsx`) | **Un solo flag** `canViewExecutive` (= `cockpit.view`) oculta 2 ítems (`exec:true`: Cockpit ejecutivo, Analytics). **Todo lo demás siempre visible.** | filtro `.filter(i => canViewExecutive || !i.exec)` |
| **Sistema (sección)** | **Sin gating en sidebar.** Roles/Usuarios/Centros/Tracking/Plantillas/Config **siempre visibles**. | sin prop de permiso |
| **RRHH → Documentación** | Gateada a nivel **página** con `canAccess("rrhh.view")` (igual que todas las páginas RRHH). | `rrhh/documentos/page.tsx:13` |
| **Guards de página** (`guard.ts`) | Solo en páginas **RRHH** + `/workspace`. `canAccess` devuelve `true` si `RBAC_ENFORCE != 1` (bootstrap). | `guard.ts:16` |
| **APIs** | Solo 3 rutas gateadas: `/api/drive/*`→`compliance.view`, `/api/compras/libro-iva/export`→`cuentas_pagar.export`. | `check.ts`, route handlers |
| **Fallback** | `user_roles` global vacía + `RBAC_ENFORCE≠1` → **fallback-allow** (todos ven todo). | `check.ts:178-214` |

**Conclusión de enforcement:** Hoy RBAC está **dormido**. Ambos perfiles (y todos) **ven y acceden a todo**, incluido Sistema y RRHH→Documentación. La mayoría de los ítems del sidebar **no están gateados por permiso**.

## 4. Matriz ANTES / DESPUÉS (objetivo del pedido)
Para **gerencia_comercial** y **administracion_finanzas** (idéntico para ambos):

| Sección / ítem | ANTES (hoy) | DESPUÉS (objetivo) |
|---|---|---|
| Cockpit (Ejecutivo, Analytics, Mapa Operativo, Mapa Inteligente, Tracking flota) | ✅ visible (dormido) | ✅ permitir |
| Comercial (Contactos, Pipeline, Oportunidades, Mapa Luján, Mapa Magaldi, Vacancia, Herramientas, Cotizador) | ✅ | ✅ permitir |
| Compras (total) | ✅ | ✅ permitir |
| Operaciones / Servicios (total) | ✅ | ✅ permitir |
| WMS (total) | ✅ | ✅ permitir |
| Pedidos (total) | ✅ | ✅ permitir |
| Compliance (total) | ✅ | ✅ permitir |
| Drive TOPS (total) | ✅ | ✅ permitir |
| Facturación (total) | ✅ | ✅ permitir |
| Tesorería (total) | ✅ | ✅ permitir |
| RRHH → Dashboard, Empleados, Solicitudes, Novedades, Mi Espacio | ✅ | ✅ permitir |
| **RRHH → Documentación** | ✅ | 🚫 **BLOQUEAR** |
| **SISTEMA → Organigrama, Roles, Usuarios, Centros de costo, Tracking, Plantillas, Configuración** | ✅ | 🚫 **BLOQUEAR (toda la sección)** |

> El cambio neto = **bloquear** Sistema (completo) + RRHH→Documentación para esos 2 roles, con el resto permitido, **y hacerlo enforced de verdad** (sidebar + guards + middleware + APIs).

## 5. Brechas que impiden el "RBAC real" pedido (a resolver en el changeset)
1. **Roles inexistentes:** hay que crear/seedear `gerencia_comercial` y `administracion_finanzas` (o decidir alinear taxonomía).
2. **Permisos faltantes:** no hay `rrhh.documentacion` ni `sistema.view`; hay que crearlos (o gatear por ausencia de `sistema.admin` / por `rrhh.view` vs subítem).
3. **Sidebar casi sin gating:** hoy solo `exec`. Hay que gatear cada ítem por permiso (Sistema + RRHH→Documentación como mínimo).
4. **Sistema sin guard de página/URL:** `/settings/*`, `/organigrama`, `/templates` no validan permiso → accesibles por URL directa. Hay que agregar guards + (idealmente) gating de API.
5. **Activación system-wide:** asignar usuarios a estos 2 roles hace que `user_roles` deje de estar vacía → **se apaga el fallback-allow GLOBAL** → cualquier usuario sin asignación pierde acceso en las superficies gateadas. ⇒ **hay que seedear TODOS los roles + asignar TODOS los usuarios** y setear `RBAC_ENFORCE=1`, no solo los 2 roles.

## 6. Riesgo
Activar RBAC es **system-wide** y puede **dejar sin acceso** a usuarios no asignados (incluida Presidencia/super_admin). Por eso el changeset debe seedear el set completo de roles+permisos+asignaciones antes de `RBAC_ENFORCE=1`. Cambio de **alto riesgo** sobre sistema productivo → requiere aprobación del plan (changeset) antes de implementar.
