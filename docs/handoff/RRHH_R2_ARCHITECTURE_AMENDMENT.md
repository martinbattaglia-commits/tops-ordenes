# TOPS NEXUS — RRHH · R2 ARCHITECTURE AMENDMENT (RBAC FOUNDATION)

> **Propósito:** resolver el conflicto detectado por la auditoría inicial de R2 entre el catálogo de
> permisos del diseño congelado (v2.0 §7, fino) y el esquema real de RBAC
> (`permissions.unique(module, action)` + `permission_action_t` fijo de 7 valores).
> **Decisión de Dirección:** **OPCIÓN 1** — permisos gruesos + RLS + RPC + propiedad/jerarquía.
> **Alcance:** enmienda **solo** §5 (Seguridad), §7 (Permisos) y la **Matriz de Roles** del maestro.
> El resto de `RRHH_MASTER_ARCHITECTURE_v2_0.md` queda **sin cambios**. Donde haya conflicto con
> v2.0 §5/§7/matriz, **esta enmienda prevalece**.
> **Restricciones:** sin SQL, sin seed, sin migraciones, sin implementación. **Primero enmienda →
> auditoría → aprobación → seed R2.**
> **Fecha:** 2026-06-07. **Versión:** v2.0 + Amendment R2.

---

## 0. Decisión congelada (Dirección)

- ✅ RRHH usa **permisos gruesos** `módulo × acción`, como el resto del sistema (Tesorería,
  Compliance, Documental, Custody).
- ❌ **No** extender `permission_action_t`. ❌ **No** crear submódulos (`rrhh_salud`/`rrhh_recibos`/
  `rrhh_bancario`/…). ❌ **No** multiplicar enums. ❌ **No** crear excepciones para RRHH.
- ✅ La **granularidad fina** se resuelve con **RLS + RPC + propiedad + jerarquía + workflow_state**,
  **no** con permisos nuevos.

---

## 1. Auditoría confirmatoria (acciones realmente usadas)

`permission_action_t` (fijo) = `view, create, edit, delete, sign, export, admin` (`0009_rbac.sql`).
Uso real por módulo: Tesorería = `view/create/edit/export/admin`; otros módulos varían
(`compras` usa `delete`/`sign`; `documental` usa `delete`).

**Catálogo aprobado para RRHH (5 acciones):**

| Acción | ¿RRHH? | Justificación |
|--------|--------|---------------|
| `view` | ✅ | lectura de RRHH |
| `create` | ✅ | alta de solicitudes/novedades/legajo |
| `edit` | ✅ | edición + **anulación lógica** (void) — append-only |
| `export` | ✅ | reportes/dashboard |
| `admin` | ✅ | datos sensibles (salud/bancario) + gestión de legajo |
| `delete` | ❌ omitido | RRHH es **append-only** (FD-10): no hay borrado físico; la baja es `edit`/void |
| `sign` | ❌ N/A | RRHH no firma documentos en este alcance |

> Igual criterio que Tesorería (que también omite `delete`/`sign`). Esto debe confirmarse en la
> auditoría posterior a la enmienda antes del seed.

---

## 2. §7 — Permisos (REEMPLAZA §7 de v2.0)

### 2.1 Catálogo RBAC de RRHH (gruesos)
```
rrhh.view     (module='rrhh', action='view')      Ver RRHH (alcance acotado por RLS)
rrhh.create   (module='rrhh', action='create')    Alta de solicitudes/novedades/legajo
rrhh.edit     (module='rrhh', action='edit')      Editar / anular (void) / aprobar L2
rrhh.export   (module='rrhh', action='export')    Reportes y dashboard (agregados)
rrhh.admin    (module='rrhh', action='admin')     PII sensible (salud/bancario) + gestión legajo
```
**Eliminados** (no representables / reemplazados por RLS+propiedad+jerarquía):
`rrhh.empleado.*`, `rrhh.bancario.*`, `rrhh.legajo.*`, `rrhh.recibos.read/read_all/upload`,
`rrhh.salud.read`, `rrhh.novedad.*`, `rrhh.solicitud.read/create/approve_l1/approve_l2/reject/cancel/anular`,
`rrhh.reporte.read`, `rrhh.dashboard.read`, `rrhh.audit.read`.

> Nota: `rrhh.audit.read` (lectura de auditoría por compliance) se resuelve con la auditoría
> transversal existente del sistema + `rrhh.admin`/rol compliance vía RLS; no es un permiso nuevo.

### 2.2 Mapeo role_permissions (a sembrar en R2)
| Rol (tabla `roles`) | rrhh.view | rrhh.create | rrhh.edit | rrhh.export | rrhh.admin |
|---------------------|:---------:|:-----------:|:---------:|:-----------:|:----------:|
| `rrhh_admin` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `rrhh_manager` | ✅ | ✅ | ✅ | ✅ | — |
| `rrhh_viewer` | — | — | — | ✅ | — |
| `employee_self_service` | — | — | — | — | — |

- `rrhh_viewer` (Dirección): **solo `rrhh.export`** → dashboard/reportes **agregados**; **sin**
  `rrhh.view` ⇒ **sin** acceso a registros individuales (PII).
- `employee_self_service`: **ningún** permiso `rrhh.*` → su acceso es **100% por propiedad** en RLS
  (ve solo lo suyo).
- `rrhh_admin` superusuario de RRHH (incluye `admin` ⇒ salud/bancario).
- `rrhh_manager` operativo **sin `admin`** ⇒ **sin** salud/bancario (RLS lo exige).

---

## 3. §5 — Seguridad (REEMPLAZA §5 de v2.0)

### 3.1 Principio (sin cambios de objetivo)
Autorización = **`coalesce(has_permission('rrhh.<acción>'), false)`** (fail-closed, FD-4) **+
propiedad / jerarquía / workflow_state**. **Prohibido `current_role()`** como autorización (FD-5).
Los **objetivos** de FD-1…FD-10 **no cambian**; cambia **cómo** se expresan (permiso grueso en vez de
slug fino).

### 3.2 Guard canónico (actualizado a permisos gruesos)
```sql
-- FAIL-CLOSED. Acción gruesa + (propiedad | jerarquía) según el recurso.
if not (
     coalesce(public.has_permission('rrhh.view'), false)             -- staff RRHH (admin/manager)
  or exists (select 1 from public.rrhh_empleados e                    -- o el dueño
             where e.id = v_empleado_id and e.profile_id = auth.uid())
) then
   raise exception 'ACCESS_DENIED' using errcode = '42501';
end if;
```

### 3.3 Mapa de autorización por recurso (granularidad fina vía RLS/propiedad/jerarquía)
| Recurso | Regla de acceso (Opción 1) |
|---------|----------------------------|
| **Legajo / empleados (PII general)** | propiedad **o** `coalesce(has_permission('rrhh.view'), false)` ⇒ dueño + admin + manager |
| **Datos bancarios (CBU)** 🔒 | propiedad **o** `coalesce(has_permission('rrhh.admin'), false)` ⇒ dueño + **solo admin** |
| **Documentación de salud / ART** 🔒 | propiedad **o** `coalesce(has_permission('rrhh.admin'), false)` ⇒ dueño + **solo admin** (manager excluido) |
| **Recibos** | propiedad **o** `coalesce(has_permission('rrhh.view'), false)` ⇒ dueño + admin + manager |
| **Dashboard / reportes (agregados, sin PII de fila)** | `coalesce(has_permission('rrhh.export'), false) or coalesce(has_permission('rrhh.view'), false)` ⇒ viewer + manager + admin |
| **Crear solicitud (empleado, lo propio)** | propiedad (`empleado.profile_id = auth.uid()`) en la RPC — **no** requiere permiso |
| **Crear novedad / carga RRHH** | `coalesce(has_permission('rrhh.create'), false)` |
| **Aprobación L1 (supervisor)** | `caller.empleado.id = solicitud.empleado.supervisor_id` **+** `workflow_state = pendiente_supervisor` (jerarquía; **sin** permiso) |
| **Aprobación L2 (RRHH)** | `coalesce(has_permission('rrhh.edit'), false)` **+** `workflow_state = pendiente_rrhh` |
| **Cancelar (pre-aprobación)** | propiedad **+** `workflow_state ∈ {borrador, pendiente_*}` |
| **Anular (post-aprobación)** | `coalesce(has_permission('rrhh.edit'), false)` (+ contrapartida/restitución) |
| **Subir recibo / documento** | `coalesce(has_permission('rrhh.create'), false)` |
| **Emitir signed URL (recibo/doc)** | RPC `emit_rrhh_signed_url`: aplica las reglas de arriba según el `target` (recibo/legajo/salud) + audita la lectura (FD-3) |
| **Operaciones / Supervisor (no jerárquico) / otros** | **sin** permiso `rrhh.*` y **sin** propiedad ⇒ **acceso nulo** |

> **Clave de la Opción 1:** la sensibilidad se gradúa con la **acción gruesa** —`admin` para lo más
> sensible (salud/bancario), `view` para registros generales, `export` para agregados— y el resto de
> la finura (dueño, supervisor, estado del workflow) vive en RLS/RPC. Sin permisos finos nuevos.

### 3.4 Aprobaciones — sin permisos `approve_l1`/`approve_l2`
- **L1** = jerarquía (`supervisor_id`) + `workflow_state`. **L2** = `rrhh.edit` + `workflow_state`.
- No existen permisos de aprobación; se resuelve por **propiedad + jerarquía + workflow_state**
  (Dirección).

---

## 4. Matriz de Roles (REEMPLAZA §5.6 de v2.0)

| Actor | Legajo PII | Bancario 🔒 | Salud 🔒 | Recibos | Dashboard/Reportes | Mecanismo |
|-------|-----------|-------------|----------|---------|--------------------|-----------|
| **Empleado** (`employee_self_service`) | propio | propio | propia | propios | — | propiedad (sin permiso) |
| **`rrhh_manager`** | ✅ (todos) | ❌ | ❌ | ✅ (todos) | ✅ | `rrhh.view`+create/edit/export |
| **`rrhh_admin`** | ✅ | ✅ | ✅ | ✅ | ✅ | + `rrhh.admin` |
| **`rrhh_viewer`** (Dirección) | ❌ individual | ❌ | ❌ | ❌ individual | ✅ agregados | solo `rrhh.export` |
| **Supervisor (jerárquico)** | — (datos laborales del equipo en vistas, no PII) | ❌ | ❌ | ❌ | — | `supervisor_id` (aprobación L1) |
| **Operaciones** | ❌ | ❌ | ❌ | ❌ | ❌ | sin permiso ⇒ nulo |
| **Compliance** | — | ❌ | excepción reglada + auditada | ❌ | — | rol compliance vía RLS (sin permiso `rrhh.*`) |

**Objetivos de seguridad preservados:** empleado solo lo suyo · manager sin salud/bancario · viewer
solo agregados (sin PII individual) · operaciones acceso nulo · salud/bancario solo admin · todo
fail-closed y auditado. (FD-1…FD-10 intactas en objetivo.)

---

## 5. Impacto y trazabilidad

| Elemento | Estado |
|----------|--------|
| v2.0 §7 (catálogo fino) | **Reemplazado** por §2 de esta enmienda |
| v2.0 §5 (guards con slugs finos) | **Reemplazado** por §3 de esta enmienda |
| v2.0 §5.6 (matriz) | **Reemplazada** por §4 |
| v2.0 resto (§1–§4, §6, §8–§10, FD-1…FD-10) | **Sin cambios** |
| FD-4 (fail-closed `coalesce`) | **Preservada** |
| FD-5 (RBAC, sin `current_role`) | **Preservada** |
| FD-1/2/3/7 (PII aislada, buckets dedicados, RPC-only, reúso parcial Custody) | **Preservadas** |
| Roadmap §8 | el seed RBAC (R2) se mantiene como migración propia **antes** de las tablas de R3 (ver §6) |

---

## 6. Próximos pasos (NO ejecutados)

```
Enmienda (este doc) → Auditoría de la enmienda → Aprobación → Seed R2
```

El **seed R2** (cuando se apruebe) será una migración que:
- INSERT en `permissions`: `rrhh.view/create/edit/export/admin` (`on conflict (slug) do nothing`).
- INSERT en `roles`: `rrhh_admin`, `rrhh_manager`, `rrhh_viewer`, `employee_self_service`
  (si no existen).
- INSERT en `role_permissions`: el mapeo de §2.2.
- **No** tablas, **no** RPCs, **no** RLS, **no** buckets (eso es R3+). Patrón calcado del seed de
  Tesorería (`0053` §11), pero **solo la porción RBAC**.

> Numeración: el seed RBAC de R2 se ubicará en la próxima migración libre (re-verificar al ejecutar);
> precede a las tablas de R3. Sin SQL en esta enmienda.

---

## 7. Estado

```text
RRHH R2

ARCHITECTURE DECISION RESOLVED
AMENDMENT COMPLETE
READY FOR AMENDMENT AUDIT

(conflicto permissions.unique(module,action) / permission_action_t: ELIMINADO)
```

*Enmienda R2 — documental. Sin SQL, sin seed, sin migraciones, sin implementación. Compatible con
producción, Tesorería y el RBAC vigente; mínima complejidad futura.*
