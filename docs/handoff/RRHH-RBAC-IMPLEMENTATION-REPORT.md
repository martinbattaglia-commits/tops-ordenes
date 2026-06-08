# RRHH-RBAC-IMPLEMENTATION-REPORT

**Fecha:** 2026-06-08 · **Base:** `RRHH-RBAC-ENFORCEMENT-PLAN.md` (Opción A, aprobado).
**Estado:** implementado en código (worktree servido `gracious-pasteur`). `tsc --noEmit` **EXIT 0**. Sin commit/push.
**NO se activó RBAC** (`RBAC_ENFORCE` sigue OFF), **NO se ejecutó SQL productivo**, **NO se asignaron roles**.

---

## 0) Decisión de diseño clave — guards DORMIDOS hasta activación (anti-lockout)

Auditoría previa: `hasPerm` usa el RPC `has_permission` (**fail-closed** en la base, con fallback `current_role()='admin'`). Gatear directamente con él **bloquearía RRHH y Mi Espacio para todos salvo `martin@`** (único `profiles.role='admin'`) **apenas se despliegue**, sin haber activado RBAC.

**Solución:** todos los guards pasan por `canAccess()` / `guard()`, que en **bootstrap** (`RBAC_ENFORCE` != "1") **devuelven acceso permitido** y recién con `RBAC_ENFORCE=1` exigen el permiso real. Así los guards se despliegan **dormidos** y se activan en el mismo switch que el resto del RBAC → **cero lockout hoy**, enforcement efectivo tras la activación.

Evidencia: con `RBAC_ENFORCE` ausente, `/rrhh`, `/rrhh/empleados`, `/rrhh/mi-espacio`, `/workspace`, `/rrhh/novedades` → **HTTP 307** (redirect de sesión), **sin 500** → compila y no bloquea.

---

## 1) Permiso creado

- **`mi_espacio.view`** (módulo `mi_espacio`, acción `view`) — vía migración **`supabase/migrations/0061_mi_espacio_permission.sql`** (idempotente, `on conflict do nothing`).
- **No aplicada a producción** (es archivo de migración; se aplica con el resto en la activación). No incluye grants (van con los 6 roles en `RBAC-ACTIVATION-PLAN.md`).
- Tipo `mi_espacio` ya presente en `src/lib/rbac/types.ts`.

---

## 2) Archivos modificados / creados

**Nuevos:**
- `src/lib/rbac/guard.ts` — `canAccess(slug)` (page guard, bootstrap-safe) + `denyReason(slug)`.
- `src/components/shell/AccesoRestringido.tsx` — pantalla "Acceso restringido".
- `supabase/migrations/0061_mi_espacio_permission.sql` — alta de `mi_espacio.view`.

**Modificados (guards de página, 9):**
| Archivo | Permiso |
|---|---|
| `app/(app)/rrhh/page.tsx` | `rrhh.view` |
| `app/(app)/rrhh/empleados/page.tsx` | `rrhh.view` |
| `app/(app)/rrhh/empleados/[id]/page.tsx` | `rrhh.view` |
| `app/(app)/rrhh/novedades/page.tsx` | `rrhh.view` |
| `app/(app)/rrhh/solicitudes/page.tsx` | `rrhh.view` |
| `app/(app)/rrhh/solicitudes/[id]/page.tsx` | `rrhh.view` |
| `app/(app)/rrhh/documentos/page.tsx` | `rrhh.view` |
| `app/(app)/rrhh/mi-espacio/page.tsx` | **`mi_espacio.view`** |
| `app/(app)/workspace/page.tsx` | **`mi_espacio.view`** (se convirtió a async + `force-dynamic`) |

**Modificado (server actions):** `src/lib/rrhh/actions.ts` — helper `guard()` + validación por acción.

---

## 3) Guards implementados (patrón)

```tsx
// páginas RRHH
if (!(await canAccess("rrhh.view"))) return <AccesoRestringido modulo="RRHH · …" />;
// autoservicio
if (!(await canAccess("mi_espacio.view"))) return <AccesoRestringido modulo="Mi Espacio" />;
```
`canAccess`: `RBAC_ENFORCE` off → `true`; on → `has_permission(slug)`.

---

## 4) Acciones protegidas (`lib/rrhh/actions.ts`)

| Acción | Permiso exigido (con enforce on) | Tipo |
|---|---|---|
| `crearSolicitud` | `mi_espacio.view` | autoservicio |
| `enviarSolicitud` | `mi_espacio.view` | autoservicio |
| `cancelarSolicitud` | `mi_espacio.view` | autoservicio |
| `getDocumentoSignedUrl` | `mi_espacio.view` | autoservicio (RLS owner-aware) |
| `aprobarL1` | `rrhh.edit` | aprobación |
| `aprobarL2` | `rrhh.edit` | aprobación |
| `rechazarSolicitud` | `rrhh.edit` | aprobación |
| `anularSolicitud` | `rrhh.edit` | admin/anulación |

> Defensa en profundidad: las acciones ya eran **RPC-first fail-closed** en la base (RLS R3–R5). El `guard()` agrega control a nivel app, dormido hasta enforce.

---

## 5) RLS — verificación

- RLS de RRHH ya existe (migraciones 0056–0060): empleado ve lo suyo, supervisor su equipo, RRHH según permiso, operaciones nada. Dato bancario restringido a `rrhh.admin` o dueño (`lib/rrhh/data.ts:78`).
- Los RPCs de transición (`rrhh_solicitud_*`, `emit_rrhh_signed_url`) son fail-closed/append-only/auditados.
- **No se modificó RLS** (ya cubre el ownership). Recomendación de QA: verificar por rol que las tablas (`rrhh_empleados`, `rrhh_solicitudes`, documentos, bancario) sólo devuelvan filas autorizadas.

---

## 6) Validaciones realizadas

- `tsc --noEmit` → **EXIT 0**.
- Dev server recompila; rutas RRHH/workspace → **307** (sin 500).
- `RBAC_ENFORCE` ausente → guards **dormidos** (sin cambio de acceso hoy; sin lockout).
- Sin commit/push; producción intacta.

**QA pendiente (requiere activación real):** con `RBAC_ENFORCE=1` + roles/`user_roles` seedeados, verificar por rol:
- super_admin / admin_operativo → RRHH completo + Mi Espacio.
- gerencia_comercial / administracion_finanzas / jefe_dep_* → `/rrhh/*` (empleados/novedades/solicitudes/documentos/dashboard) = **Acceso restringido**; `/rrhh/mi-espacio` + `/workspace` = **OK**.
- Probar **URL directa** y **server action** (crear/aprobar) por rol.

---

## 7) Consideraciones / decisiones abiertas

- **`solicitudes/[id]` gateado por `rrhh.view`:** un empleado limitado ve/gestiona sus solicitudes desde **`/rrhh/mi-espacio`** (autoservicio), no desde el detalle RRHH. Si se quiere que el limitado abra el detalle de su propia solicitud, habría que ampliar el gate a `mi_espacio.view` para el dueño (decisión de QA).
- **`admin_operativo` = RRHH completo** (confirmado en esta ronda): recibe `rrhh.*` por su regla `módulo<>sistema` en el plan de activación.
- **Mi Espacio debe mostrar solo datos propios** (RLS/owner) — verificar en QA.

---

## Próximo paso (volver para aprobación final antes de activar)
Implementación de código completa y dormida. Para que surta efecto:
1. Aplicar migración `0061` + las del plan de activación (roles, grants, `mi_espacio.view` grants).
2. Seedear `user_roles` (incl. `mi_espacio.view` a los 4 roles limitados; `rrhh.*` a super_admin/admin_operativo).
3. `RBAC_ENFORCE=1` → recién aquí los guards y las acciones enforced.
4. QA §6.

> **Pendiente tu aprobación final** (per tu instrucción) antes de activar RBAC. No se ejecutó nada en producción.
