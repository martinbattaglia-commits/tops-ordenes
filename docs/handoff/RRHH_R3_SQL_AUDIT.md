# TOPS NEXUS — RRHH · 0058 PRE-PRODUCTION SQL AUDIT

> **Tipo:** auditoría adversarial del SQL final de `0058_rrhh_core.sql` (commit `bf8ca7e`), previa a
> su aplicación en `arsksytgdnzukbmfgkju`. Solo lectura — no se modifica SQL, no se aplica, no se
> toca producción.
> **Criterio:** "como si mañana contuviera datos reales de empleados". No suavizar.
> **Fecha:** 2026-06-07. **Auditor:** Claude Code.

---

## 1. Resumen

El SQL es **correcto, seguro (PII-first) y en alcance**: RLS por `has_permission`+propiedad
fail-closed (sin `current_role()`), append-only en las 3 tablas, reutiliza dependencias existentes.
**0 hallazgos críticos · 0 mayores.** Hay **5 menores** de endurecimiento (no bloquean la aplicación;
recomendados ahora o en un gate de hardening).

> **Veredicto: OPTION A — `0058 APPROVED FOR PRODUCTION`** (con recomendaciones menores en §4).

---

## 2. Controles

| Control | Resultado |
|---------|-----------|
| C1 — Compatibilidad (profiles/auth.users/depot_t/touch_updated_at/RBAC) | **PASS** |
| C2 — RLS (has_permission/ownership/fail-closed; bypass) | **PASS** |
| C3 — Append-only (UPDATE/DELETE) | **PASS** (menor: TRUNCATE) |
| C4 — Índices (FK sin índice) | **PASS** (menor: FK de auditoría) |
| C5 — Constraints (nulos/self-ref) | **PASS** (menor: ciclos de organigrama) |
| C6 — Orden 0056→0057→0058 | **PASS** |
| C7 — No workflows/vacaciones/licencias/recibos/buckets/storage | **PASS** |

---

## 3. Detalle

### C1 — Compatibilidad · PASS
- `profile_id → public.profiles(id)` (uuid, 0001) ✓ · `on delete set null` ✓.
- `created_by/updated_by/changed_by → auth.users(id)` ✓ · `on delete set null` ✓.
- `depot public.depot_t` (0001) — **reutiliza**, no redefine ✓.
- `touch_updated_at()` (0009, `returns trigger`) — invocado en `before update` de empleados ✓.
- `has_permission(text)` (0009) — usado en RLS; patrón ya probado en CRM `0042/0043` ✓.
- Enums nuevos (`rrhh_*_t`) en `do$$ … exception when duplicate_object`: idempotentes ✓.

### C2 — RLS · PASS
- **empleados read** = `coalesce(has_permission('rrhh.view'),false) OR profile_id = auth.uid()`.
  Sin permiso y sin propiedad ⇒ 0 filas (fail-closed). El empleado no puede auto-asignarse
  `profile_id` (escritura = `rrhh.admin`). ✓
- **bancario read** 🔒 = `rrhh.admin` **o** propiedad (subselect a empleados, también bajo RLS — el
  dueño ve su empleado ⇒ el `exists` resuelve). `rrhh_manager` (sin admin) **no** ve bancario ajeno
  ✓ (conforme amendment).
- **historial read** = `rrhh.view`. Escrituras = `rrhh.admin` en las 3.
- **Fail-closed:** 8× `coalesce(...,false)`; `to authenticated` (anon sin policy ⇒ sin acceso);
  `service_role` bypassa RLS (carga inicial) — esperado.
- **Búsqueda de bypass:** no se halló. Sin `current_role()` (FD-5). Operaciones/otros sin `rrhh.*`
  ⇒ acceso nulo. (Nota: RLS no es `FORCE`; el **owner** de la tabla bypassa RLS — comportamiento
  estándar Postgres, idéntico a treasury/CRM; no es bypass de la app.)

### C3 — Append-only · PASS (con menor)
- empleados: `forbid delete` ✓; UPDATE permitido (master mutable) — correcto.
- bancario / historial: `forbid delete` + `forbid update` ✓; sin policies de update/delete (doble
  barrera RLS + trigger).
- **🟡 m1 (menor):** los triggers son `for each row`; **`TRUNCATE` no los dispara** ni pasa por RLS.
  Un actor con privilegio elevado (`service_role`/owner) podría `TRUNCATE` una tabla append-only.
  Es **idéntico** al patrón vigente (treasury/custody solo usan forbid-delete por fila), por lo que
  no es regresión. **Recomendación de hardening:** agregar `before truncate` statement-trigger que
  invoque `tg_forbid_delete_rrhh` (cheap). No bloquea.

### C4 — Índices · PASS (con menor)
- FKs indexadas: `supervisor_id`, `profile_id`, `bancario.empleado_id`, `historial.empleado_id` ✓.
  Filtros: `estado`, `depot`, `seccion` ✓. Unique: `dni`, `cuil`, `public_id` ✓.
- **🟡 m2 (menor):** FKs de auditoría `created_by/updated_by/changed_by → auth.users` **sin índice**.
  Impacto bajo (columnas de auditoría, rara vez join/filtro; `on delete set null` poco frecuente) y
  consistente con la norma del repo. Opcional indexar.

### C5 — Constraints · PASS (con menor)
- `dni`/`cuil`/`public_id` unique; `dni`/`cuil`/`apellido_nombre`/`fecha_ingreso` not null ✓.
- `rrhh_empleados_baja_chk` (`estado<>'baja' or fecha_baja not null`) ✓ (unidireccional — aceptable).
- `rrhh_empleados_no_self_supervisor_chk` (`supervisor_id <> id`) bloquea auto-loop directo ✓.
- **🟡 m3 (menor):** el check **no** previene **ciclos multinodo** en el organigrama (A→B→A). Un
  ciclo rompería recorridos recursivos (dashboard/reportes de jerarquía en gates futuros). No es
  expresable en un `check`; debe validarse en el **RPC de escritura** (gate posterior). Documentar.
- **🟡 m4 (observación):** el empleado **no** ve su propio `historial` (la policy de historial solo
  da `rrhh.view`, sin rama de propiedad). Es conservador/by-design; confirmar si se desea exponer al
  empleado su historial de cambios.

### C6 — Orden de dependencia · PASS
- `0058` referencia **solo** objetos ya existentes (`depot_t`, `profiles`, `auth.users`,
  `touch_updated_at`, `has_permission`). **No** tiene FK ni uso DDL del enum `'rrhh'` ni de los
  permisos `rrhh.*` (los slugs viajan como **texto** a `has_permission`). ⇒ aplicar `0058` no
  ERROR-aría aun sin `0057`, pero el resultado sería "sin accesos" hasta sembrar permisos.
- **Orden funcional correcto:** `0056 → 0057 → 0058` (el framework de migraciones los aplica en
  orden numérico). PASS.

### C7 — Fuera de alcance · PASS
Solo 3 tablas de legajo + enums + secuencia + triggers de inmutabilidad + RLS. **Sin** workflows,
vacaciones, licencias, permisos, novedades, recibos, documentos, buckets ni storage. Verificado.

---

## 4. Hallazgos

- 🔴 Críticos: **0**
- 🟠 Mayores: **0**
- 🟡 Menores (no bloquean; hardening recomendado):
  - **m1** — `TRUNCATE` no bloqueado en tablas append-only → agregar `before truncate` trigger.
  - **m2** — FKs de auditoría sin índice (impacto bajo).
  - **m3** — ciclos de organigrama no prevenidos en DB → validar en el RPC de escritura (gate posterior).
  - **m4** — empleado no ve su propio historial (confirmar si es intencional).
  - **m5** — `baja_chk` unidireccional (no exige `estado='baja'` cuando hay `fecha_baja`).

> Ninguno expone PII el día 1 ni rompe la seguridad/integridad básica. m1 y m3 son los más relevantes
> para "datos reales"; ambos tienen mitigación clara y barata (trigger de truncate; validación de
> ciclos en el RPC del próximo gate).

---

## 5. Veredicto

> ## OPTION A — `0058 APPROVED FOR PRODUCTION`

El SQL es correcto, **PII-first** (RLS fail-closed + append-only, sin `current_role()`), en alcance
estricto y compatible con las dependencias reales. **0 críticos / 0 mayores.** Se aprueba su
aplicación manual controlada (con el preflight habitual: backup + orden `0056→0057→0058` + ventana +
operador único).

### Recomendaciones (no bloqueantes)
- Incluir m1 (trigger `before truncate`) en el mismo `0058` o en un `0058a`/gate de hardening — es el
  refuerzo de mayor valor para append-only sobre PII.
- Planificar m3 (anti-ciclos) en el RPC de alta/edición de legajo (gate posterior).
- Evaluar m2/m4/m5 según necesidad.

---
*Auditoría SQL de 0058 — solo lectura. Veredicto OPTION A. No se modificó SQL ni se tocó producción.*
