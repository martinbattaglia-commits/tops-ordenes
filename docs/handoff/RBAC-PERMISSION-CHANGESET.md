# RBAC-PERMISSION-CHANGESET — TOPS NEXUS

**Fecha:** 2026-06-08 · Cambios para Gerencia Comercial + Finanzas/Administración.

## ESTADO (actualizado tras aprobación)
- **Decisión 1 — Política:** ✅ **Nueva política (deroga F3)**. Ambos roles = casi-todo; bloqueado solo Sistema (`sistema.*`) + RRHH→Documentación (`rrhh.documentacion.view`). Se elimina la separación de poderes F3 por decisión explícita del usuario.
- **Decisión 2 — Activación:** ✅ **Estrategia B (dirigida, fallback per-usuario)**.
- **Código:** ✅ implementado (tsc PASS). Ver "Cambios de código" abajo (guard.ts, check.ts, Sidebar/Shell/layout, 8 page guards, 2 permisos en mock).
- **DB:** migración preparada `supabase/migrations/0070_rbac_gerencia_finanzas.sql` (**NO aplicada** — la aplicás vos). Falta `user_roles` con UUIDs reales (sin eso no hay enforcement efectivo).

### ⚠️ Nota de seguridad (trade-off Estrategia B)
`check.ts`/`guard.ts` pasaron de bootstrap **global** (fix R22: count con service-role) a bootstrap **per-usuario**: un usuario **sin asignación** queda en fail-open (ve todo), y solo los **asignados** se enforzan. Esto es lo que permite el rollout dirigido a 2 roles sin afectar al resto, pero significa que **un usuario nuevo sin rol asignado no queda fail-closed**. Para fail-closed global en el futuro: asignar a TODOS + `RBAC_ENFORCE=1`.

---

## Objetivo
Que `gerencia_comercial` y `administracion_finanzas` operen **todo Nexus** excepto **Sistema (completo)** y **RRHH→Documentación**, con enforcement **real** (sidebar + guards + middleware/URL + APIs), no solo UI.

---

## Decisión de diseño previa (BLOQUEANTE — necesito tu elección)

### Estrategia A — RBAC real system-wide (máxima fidelidad)
Seedear **todos** los roles (alineando taxonomía a `APP_ROLES`), todos los permisos, asignar **todos** los usuarios, y `RBAC_ENFORCE=1`.
- ✔ "RBAC real" pleno; ✔ consistente.
- ✘ **Blast radius global:** si falta asignar un usuario, queda sin acceso (incluida Presidencia). Mucho trabajo + alto riesgo.

### Estrategia B — Enforcement dirigido (recomendada para el alcance pedido)
1. Cambiar `check.ts`/`guard.ts` a **fallback por-usuario**: si el usuario logueado **no tiene** asignación → fallback-allow (como hoy); si **sí** tiene → se enforcea su set. Así se puede restringir SOLO a los 2 roles sin tocar a los demás.
2. Crear permisos granulares: `sistema.view`, `rrhh.documentacion.view`.
3. Seedear roles `gerencia_comercial` y `administracion_finanzas` con **todos los permisos MENOS** `sistema.*` y `rrhh.documentacion.view`.
4. Asignar los usuarios reales de esos 2 perfiles.
5. Gatear las superficies (abajo).
- ✔ Riesgo acotado a los 2 roles; ✔ no requiere asignar a toda la empresa.
- ✘ Modelo: usuarios sin asignación siguen viendo todo (aceptable en FASE 1).

> **Recomiendo B.** Define el alcance exacto pedido sin arriesgar el acceso del resto. Confirmá A o B antes de implementar.

---

## Cambios de CÓDIGO (los aplico yo, tras tu OK)

### C1 · Permisos nuevos (catálogo)
- `sistema.view` (gate de toda la sección Sistema).
- `rrhh.documentacion.view` (gate de RRHH→Documentación, separado de `rrhh.view`).
- (Estrategia B) agregar a `SEED_PERMISSIONS` + migración.

### C2 · Sidebar (`src/components/shell/Sidebar.tsx`)
- Gatear por permiso, no solo `exec`. Mínimo: items de **Sistema** requieren `sistema.view`; **RRHH→Documentación** requiere `rrhh.documentacion.view`.
- Recibir el set de permisos del usuario (nuevo util `getMyPermissions()` server-side) y filtrar `items`/`domains`.

### C3 · Guards de página (server components) — cerrar acceso por URL directa
- Agregar `canAccess("sistema.view")` en: `/organigrama`, `/settings`, `/settings/roles`, `/settings/users`, `/settings/centros-costo`, `/settings/tracking`, `/templates` → `<AccesoRestringido/>` si no.
- Agregar `canAccess("rrhh.documentacion.view")` en `/rrhh/documentos` (hoy usa `rrhh.view`).

### C4 · APIs relacionadas
- Gatear los route handlers de Sistema/Settings y de RRHH-documentos con `checkPermission(...)` (`sistema.view` / `rrhh.documentacion.view`). Inventariar `/api/settings/*`, `/api/rrhh/documentos/*` (si existen) y agregar el check.

### C5 · `check.ts` / `guard.ts` (solo si Estrategia B)
- Fallback **por-usuario**: si el caller no tiene rows en `user_roles` → allow (bootstrap); si tiene → enforcement real. Documentar el cambio de política.

## Cambios de BASE DE DATOS (los aplicás vos en SQL Editor — el asistente no escribe prod)
Migración nueva (ej. `0070_rbac_gerencia_finanzas.sql`), **idempotente**:
1. `insert` permisos `sistema.view`, `rrhh.documentacion.view` (si no existen).
2. `insert` roles `gerencia_comercial`, `administracion_finanzas` (si no existen).
3. `insert` `role_permissions`: a esos 2 roles, **todos los permisos** EXCEPTO `sistema.*` y `rrhh.documentacion.view`.
4. `insert` `user_roles`: asignar los usuarios reales de Comercial y Finanzas a su rol (necesito los user_id / emails).
5. (Estrategia A) además seedear el resto de roles+asignaciones.

## Variable de entorno
- `RBAC_ENFORCE`: en Estrategia B con fallback por-usuario, **no** hace falta `=1` global (el enforcement aplica a usuarios asignados). En Estrategia A, `RBAC_ENFORCE=1` tras seedear todo.

---

## Lo que NO se toca
- crm_units, reservas, Digital Twin, deep links, contratos, lógica comercial.
- Ningún cambio visual/navegación fuera del gating de permisos.
- Identificadores internos.

## Orden de implementación (tras aprobación)
1. Código (C1–C5) → tsc + build PASS.
2. Migración DB (vos, SQL Editor) + datos de usuarios reales.
3. Commit + push + redeploy.
4. QA (`RBAC-QA-REPORT.md`).

## Datos que necesito de vos
- Estrategia **A** o **B**.
- **Emails/IDs** de los usuarios de Gerencia Comercial y de Finanzas/Administración (para `user_roles`). Sin esto no hay enforcement real (solo quedaría el código + roles vacíos).
- ¿Alinear la taxonomía a `APP_ROLES` (recomendado) o mantener los slugs DB actuales?
