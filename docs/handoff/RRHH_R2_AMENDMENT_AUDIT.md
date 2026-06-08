# TOPS NEXUS — RRHH · R2 AMENDMENT AUDIT

> **Tipo:** auditoría adversarial de la enmienda (solo lectura), previa al seed RBAC de R2.
> Verifica `RRHH_R2_ARCHITECTURE_AMENDMENT.md` contra el RBAC real, no contra el documento.
> **Restricciones:** sin implementar, sin SQL, sin migraciones, sin seed.
> **Metodología:** "como si mañana se ejecutara `0057_rrhh_rbac_seed.sql` en producción".
> **Fecha:** 2026-06-07. **Auditor:** Claude Code.

---

## 1. Resumen

La enmienda **resuelve correctamente** el bloqueante: colapsa el catálogo a permisos gruesos
`módulo × acción` compatibles con el esquema real (`permissions.unique(module, action)` +
`permission_action_t` fijo) y traslada la granularidad fina a RLS/RPC/propiedad/jerarquía. **Los 7
controles pasan. 0 conflictos con `0009_rbac.sql` / `permission_action_t`.**

> **Veredicto: OPTION A — `AMENDMENT APPROVED · READY FOR R2 SEED`.**

---

## 2. Resultado de controles

| Control | Estado |
|---------|--------|
| A1 — Compatibilidad RBAC | **PASS** |
| A2 — Eliminación del conflicto | **PASS** |
| A3 — Matriz de roles implementable | **PASS** |
| A4 — PII protegida | **PASS** |
| A5 — Workflow reemplaza permisos finos | **PASS** |
| A6 — Consistencia FD-1…FD-10 | **PASS** |
| A7 — Seed viable sin tocar RBAC | **PASS** |

---

## 3. Detalle

### A1 — Compatibilidad RBAC · PASS
`rrhh.view/create/edit/export/admin` = 5 pares `(module='rrhh', action=X)` con acciones **distintas**,
todas ∈ `permission_action_t` (`view,create,edit,delete,sign,export,admin`, `0009:31`). Satisface
`unique(module, action)` (`0009:50`). `'rrhh'` es módulo nuevo (R1/`0056`) → sin colisión con otros
módulos. Slugs nuevos → sin colisión en `unique(slug)`. Idéntico patrón que Tesorería (`0053:674-679`).

### A2 — Eliminación del conflicto · PASS
La enmienda **elimina** todos los slugs imposibles (`rrhh.recibos.read_all`, `rrhh.salud.read`,
`rrhh.approve_l1/l2`, `rrhh.bancario.*`, `rrhh.legajo.*`, `rrhh.novedad.*`, etc.). Revisión de §3/§4:
**ningún** guard ni regla referencia un permiso fuera de los 5 gruesos. No reaparece ningún slug
imposible como permiso.

### A3 — Matriz de roles · PASS
Implementable **solo** con `permissions` + `role_permissions` + RLS + RPC + ownership:
- 4 roles nuevos como filas en `roles` (slug+name; resto con defaults — `0009:54-66`); sin colisión
  con los 7 existentes (`admin`, `director_ops`, `operaciones`, `compliance`, `comercial`,
  `seguridad`, `cliente_b2b`).
- Distinción **manager vs viewer** por permiso (`view` vs solo `export`) — sin necesidad de chequear
  slug de rol en RLS.
- `employee_self_service` sin permisos: su acceso se resuelve **por propiedad** en RLS/RPC
  (`empleado.profile_id = auth.uid()`). Viable.

### A4 — PII protegida · PASS
- **Salud / Bancario** 🔒 → `coalesce(has_permission('rrhh.admin'), false)` o propiedad ⇒ solo admin
  + dueño (manager **excluido**).
- **Recibos / Legajo** → `coalesce(has_permission('rrhh.view'), false)` o propiedad ⇒ admin + manager
  + dueño (consistente con "manager: lectura operativa de recibos" del diseño).
- **Operaciones / Supervisor-no-jerárquico / otros** → sin permiso `rrhh.*` y sin propiedad ⇒ acceso
  nulo. La PII vive en tablas/buckets **dedicados** `rrhh_*` (FD-2), **no** en `documents` → la fuga
  histórica por RLS legacy de `documents` **no aplica**.

### A5 — Workflow · PASS
- **L1** = `caller.empleado.id = solicitud.empleado.supervisor_id` + `workflow_state =
  pendiente_supervisor` (jerarquía; sin permiso).
- **L2** = `coalesce(has_permission('rrhh.edit'), false)` + `workflow_state = pendiente_rrhh`.
- **Cancelar** = propiedad + `workflow_state ∈ {borrador, pendiente_*}`. **Anular** = `rrhh.edit`.
- Reemplaza correctamente los permisos finos eliminados (`approve_l1/l2`, `cancel`, `anular`) por
  propiedad + jerarquía + estado, ejecutables vía RPC `security definer`.

### A6 — FD-1…FD-10 · PASS
| FD | Estado | Nota |
|----|--------|------|
| FD-1 PII aislada | ✅ | tablas/buckets dedicados sin cambios |
| FD-2 buckets dedicados | ✅ | sin reuse de `documents` |
| FD-3 RPC-only signed URLs | ✅ | `emit_rrhh_signed_url` aplica las reglas gruesas |
| FD-4 fail-closed `coalesce` | ✅ | guard canónico preservado |
| FD-5 RBAC sin `current_role` | ✅ | autorización por `has_permission`; bypass admin interno es by-design |
| FD-6 propiedad explícita | ✅ | `profile_id = auth.uid()` |
| FD-7 reúso parcial Custody | ✅ | sin cambios |
| FD-8 no liquida | ✅ | sin cambios |
| FD-9 cálculo en vistas | ✅ | sin cambios |
| FD-10 append-only | ✅ | `delete` omitido a propósito; baja = `edit`/void |
Ninguna Frozen Decision violada.

### A7 — Seed viable · PASS
**¿Puede escribirse `0057_rrhh_rbac_seed` sin modificar la arquitectura RBAC actual? → SÍ.**
- `INSERT` en `permissions` (5 filas, `on conflict (slug) do nothing`).
- `INSERT` en `roles` (4 filas; `slug`+`name` requeridos, resto defaults — `0009:54-66`;
  `on conflict (slug) do nothing`).
- `INSERT` en `role_permissions` (mapeo §2.2 vía `select` join, `on conflict do nothing`) — patrón
  `0053:682-700`.
- **Sin** `ALTER TYPE`, **sin** nuevos módulos/acciones, **sin** tablas/RPC/RLS/buckets.
- Precondición: `'rrhh'` ya presente en `permission_module_t` (R1/`0056`, atestado aplicado en prod
  por Dirección). El seed `module='rrhh'` lo requiere.

---

## 4. Observaciones menores (no bloqueantes)

- **n1:** usar la acción `export` como compuerta del dashboard del `rrhh_viewer` es una elección
  semántica (export gating una vista de lectura). Es consistente con Tesorería (`export` = reportes)
  y no es un conflicto de esquema. Confirmar etiqueta/descripcón clara en el seed.
- **n2:** el bypass de admin vive **dentro** de `has_permission` (`… or current_role()='admin'`,
  `0009:174`); un usuario legacy `admin` ve todo (incluida salud). Es superusuario by-design (FD-5),
  no un defecto de la enmienda.
- **n3:** la precondición de A7 (R1 aplicada en prod) se toma de la **atestación de Dirección**; no
  reverificable desde este entorno. Si el seed se ejecutara sin `'rrhh'` aplicado, fallaría — el
  preflight del seed debe re-confirmarlo.

Ninguna afecta PII, seguridad ni la viabilidad del seed.

---

## 5. Veredicto

> ## OPTION A — `AMENDMENT APPROVED · READY FOR R2 SEED`

La enmienda elimina por completo el conflicto con `permissions.unique(module, action)` y
`permission_action_t`, preserva los objetivos de seguridad (PII, workflow, separación de dominios) y
las Frozen Decisions, y habilita un seed RBAC **puro** (permissions + roles + role_permissions) sin
modificar la arquitectura RBAC vigente. **0 conflictos reales.**

### Condiciones para el seed R2 (`0057_rrhh_rbac_seed`)
1. Aprobación de Dirección para ejecutar R2 (igual que R1).
2. Preflight: re-confirmar `'rrhh'` en `permission_module_t` (prod) + próxima migración libre.
3. Seed solo INSERTs (permissions/roles/role_permissions), idempotente, patrón `0053 §11`.
4. Sin tablas/RPC/RLS/buckets (eso es R3+).

---

```text
RRHH R2

AMENDMENT APPROVED
READY FOR R2 SEED
(0 conflictos con 0009_rbac.sql / permission_action_t)
```

*Auditoría de la enmienda — solo lectura. Veredicto OPTION A. No se escribió SQL ni seed.*
