# TOPS NEXUS — RRHH · R3 IMPLEMENTATION PLAN (DRAFT)
## R3 — CORE DATA MODEL · `0058_rrhh_core`

> **Estado:** PLAN — **DRAFT, pendiente de dos confirmaciones de Dirección** (ver §0). **No** se
> implementa, **no** se migra, **no** se commitea, **no** se toca producción.
> **Autorización:** Dirección — apertura R3 (modelo de datos del legajo).
> **Modelo:** `RRHH_MASTER_ARCHITECTURE_v2_0.md` §4 + `RRHH_R2_ARCHITECTURE_AMENDMENT.md` (seguridad).
> **Producción:** `arsksytgdnzukbmfgkju`. **Fecha:** 2026-06-07.

---

## 0. Bloqueos previos a ejecución (requieren a Dirección)

1. **Mensaje de autorización truncado.** La autorización recibida termina en "`Auditor`"; faltan las
   secciones habituales (Auditor obligatorio / Entregables / Metodología / Criterio de éxito).
   **Se requiere el texto completo** antes de cerrar el plan y ejecutar.
2. **Decisión RLS en R3 (PII).** R3 crea las primeras tablas con PII (DNI/CUIL/CBU). El diseño
   congelado (FD-1, FD-5, recomendación v2.0 #2) exige que **nazcan con RLS**. Como tu restricción
   dice "NO crear RPCs" (RLS ≠ RPC), este plan **incluye RLS** (vía `has_permission` + propiedad, sin
   RPCs). **Confirmar** que R3 incluye RLS (recomendado) o si se difiere.

> Hasta resolver 1 y 2: sin migración, sin commit, sin SQL final.

---

## 1. Objetivo
Crear la **fundación de datos** del legajo RRHH: empleados, datos laborales/bancarios/contacto,
estado y organigrama (supervisor). **Solo modelo de datos.**

## 2. Alcance autorizado (estricto)
**Incluye:** tablas de legajo + enums de soporte + append-only + **RLS** (ver §0.2).
**NO incluye:** workflows, vacaciones, permisos, licencias, novedades, recibos, buckets/storage,
RPCs, UI. **No** avanza a R4. **No** toca otros dominios ni `user_role_t`/enums RBAC.

## 3. Diseño de tablas (`0058_rrhh_core`)

### 3.1 Enums nuevos (tipos propios — no tocan enums existentes)
- `rrhh_estado_empleado_t` = `activo` · `licencia` · `baja`.
- `rrhh_estado_civil_t`, `rrhh_modalidad_contratacion_t` (valores a fijar).
> Son `CREATE TYPE` nuevos → pueden usarse en la misma migración (la restricción de "valor nuevo en
> misma tx" aplica solo a `ADD VALUE` sobre enums existentes, no a tipos nuevos).

### 3.2 `rrhh_empleados` (legajo)
`id` uuid PK · `public_id` int (nº legajo) · `profile_id` uuid FK→profiles (nullable, 1:0..1) ·
`apellido_nombre`🔒 · `dni`🔒 único · `cuil`🔒 único · `fecha_nacimiento`🔒 ·
`domicilio/telefono/email_personal`🔒 · `estado_civil rrhh_estado_civil_t` · `contacto_emergencia`🔒 jsonb ·
`fecha_ingreso` · `fecha_reconocida` · `categoria/seccion/calificacion` · `convenio` ·
`modalidad_contratacion rrhh_modalidad_contratacion_t` · `depot public.depot_t` (**reutiliza** 0001) ·
`supervisor_id` uuid FK→rrhh_empleados (**organigrama**) · `obra_social` · `estado rrhh_estado_empleado_t` ·
`fecha_baja/motivo_baja` · audit cols (`created_*`/`updated_*`).

### 3.3 `rrhh_empleado_bancario` (separada por sensibilidad — FD-1)
`id` · `empleado_id` FK · `banco` · `cbu`🔒 · `alias`🔒 · `cuenta`🔒 · `vigente_desde` · audit.
Append-only (historial de cuentas). RLS más estricta (solo admin + propiedad).

### 3.4 `rrhh_empleado_historial` (append-only — organigrama/atributos)
`id` · `empleado_id` FK · `campo` · `valor_anterior` · `valor_nuevo` · `vigente_desde` · `changed_by` ·
`created_at`. Cambios de categoría/remuneración/supervisor/sección. Inmutable.

> **Fuera de R3** (van con el motor de ausencias / gates posteriores): `rrhh_jornada`,
> `rrhh_vacaciones_reglas`, `rrhh_feriados`, solicitudes, novedades, documentos, recibos.

## 4. Seguridad (RLS — incluida por FD-1/FD-5; sin RPCs)
| Tabla | Lectura (RLS) | Escritura (RLS) |
|-------|---------------|------------------|
| `rrhh_empleados` | `coalesce(has_permission('rrhh.view'),false)` **o** propiedad (`profile_id=auth.uid()`) | `coalesce(has_permission('rrhh.admin'),false)` (granular vía RPC en gate posterior) |
| `rrhh_empleado_bancario` 🔒 | `coalesce(has_permission('rrhh.admin'),false)` **o** propiedad | `coalesce(has_permission('rrhh.admin'),false)` |
| `rrhh_empleado_historial` | `coalesce(has_permission('rrhh.view'),false)` | solo `service_role`/admin (lo escribe el RPC de edición — gate posterior) |
- **Append-only:** `tg_forbid_delete_rrhh` en las 3 tablas (FD-10); sin UPDATE en historial/bancario.
- **Sin `current_role()`** (FD-5). Guards fail-closed `coalesce(...,false)` (FD-4).
- **Operaciones/supervisor-no-jerárquico:** sin permiso `rrhh.*` ⇒ acceso nulo.
- **Carga inicial del legajo:** por `service_role`/admin (no hay RPCs de alta en R3).

## 5. Migración
`0058_rrhh_core.sql` — enums + 3 tablas + índices + RLS + triggers append-only. **Sin** RPCs,
storage, ni datos (salvo, si se decide, una carga inicial controlada — fuera de este gate).

## 6. Riesgos
| Tipo | Riesgo | Sev. | Mitigación |
|------|--------|------|-----------|
| Seguridad | Tablas PII sin RLS | **Alta** | RLS desde el origen (§4) — **bloqueo §0.2** |
| Técnico | `depot_t` redefinido | Baja | Reutilizar `public.depot_t` |
| Técnico | `0058` tomado | Baja | Re-verificar libre al aplicar |
| Producción | Aplicar sin backup | Alta (si se omite) | Preflight: backup + ventana + operador único |
| Alcance | Scope creep a workflows/recibos | Media | Lista de exclusión §2 |

## 7. Entregables previstos (a confirmar con el texto completo)
`RRHH_R3_IMPLEMENTATION_PLAN.md` (este) · `_IMPLEMENTATION_REPORT` · `_AUDIT_REPORT` ·
`_CLOSURE_REPORT` — mismo set que R1/R2.

## 8. GO / NO-GO
**NO-GO** hasta: (a) recibir el texto completo de la autorización; (b) confirmar RLS en R3; (c)
backup verificado; (d) `0058` libre. Luego: Preflight → Implementación → Auditoría → Verificación
prod → Cierre.

---
*Plan R3 DRAFT — sin SQL, sin migración, sin commit, sin tocar producción. Pendiente de §0.*
