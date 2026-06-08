# TOPS NEXUS — RRHH · R3 AUDIT REPORT
## Auditoría del artefacto `0058_rrhh_core` (CORE DATA MODEL)

> **Tipo:** auditoría de gate R3, adversarial, solo lectura. Primer gate con **tablas PII** →
> énfasis en seguridad (RLS, append-only, sin `current_role()`). **Fecha:** 2026-06-07.

## 1. Resumen
`0058` (commit `bf8ca7e`) cumple el alcance (solo modelo de datos) y nace con la seguridad exigida
por el diseño congelado. **0 críticos · 0 mayores.** La aplicación a prod y su verificación quedan
para el paso manual (§3).

## 2. Controles
| # | Control | Resultado | Evidencia |
|---|---------|-----------|-----------|
| C1 | Solo modelo de datos (3 tablas legajo) | **PASS** | empleados/bancario/historial; nada más |
| C2 | Sin workflows/vacaciones/permisos/licencias/novedades/recibos | **PASS** | ninguna tabla de esos dominios |
| C3 | Sin RPCs de negocio / buckets / storage / UI | **PASS** | solo funciones-trigger; sin `bucket`/`storage` |
| C4 | RLS habilitada en las 3 tablas | **PASS** | `enable row level security` ×3 |
| C5 | RLS por `has_permission` + propiedad; **sin `current_role()`** (FD-5) | **PASS** | 8× `coalesce(has_permission…)`; 0 `current_role()` en código |
| C6 | Fail-closed (FD-4) | **PASS** | `coalesce(...,false)` en todos los guards |
| C7 | PII protegida: bancario solo admin+propiedad; empleados view+propiedad | **PASS** | políticas §8 del artefacto |
| C8 | Operaciones/supervisor-no-jerárquico sin acceso | **PASS** | no tienen `rrhh.*` ⇒ RLS los excluye |
| C9 | Append-only (FD-10): forbid delete (3) + forbid update (bancario/historial) | **PASS** | triggers + ausencia de policies update/delete |
| C10 | Reutiliza `public.depot_t` (no redefine) | **PASS** | `depot public.depot_t` |
| C11 | Organigrama: `supervisor_id` self-FK + check anti-self | **PASS** | FK + `no_self_supervisor_chk` |
| C12 | Idempotencia / re-ejecución segura | **PASS** | `create ... if not exists`, enums en `do$$ exception`, `drop policy if exists` |
| C13 | Commit aislado | **PASS** | `bf8ca7e`: 1 archivo |

## 3. Verificación post-aplicación (operador, read-only)
```
☐ 3 tablas creadas: rrhh_empleados / rrhh_empleado_bancario / rrhh_empleado_historial
☐ RLS = on en las 3 (pg_tables.rowsecurity)
☐ Políticas presentes (read/insert/update según diseño); ninguna policy de delete
☐ has_permission usado en políticas; sin current_role()
☐ DELETE sobre cualquier tabla RRHH → error (append-only)
☐ UPDATE sobre bancario/historial → error (append-only)
☐ Empleado de prueba (con profile_id) ve solo su propia fila; sin permiso no ve bancario
☐ Usuario operaciones (sin rrhh.*) → 0 filas
☐ depot usa public.depot_t; dominios existentes intactos
```

## 4. Hallazgos
- 🔴 Críticos: **0** · 🟠 Mayores: **0** · 🟡 Menores: **0** sobre el artefacto.
- Observaciones (no defecto): (a) escritura limitada a `rrhh.admin` / `service_role` hasta que
  lleguen los RPCs de alta (gate posterior) — esperado en un gate de solo-datos; (b) la verificación
  en prod queda pendiente del paso manual; (c) precondición `0056/0057` aplicadas tomada de la
  atestación de Dirección — reconfirmar en preflight.

## 5. Veredicto
> ## R3 ARTEFACTO — `PASS`
Modelo de datos correcto, en alcance, **PII-first** (RLS + append-only desde el origen, sin
`current_role()`), conforme a FD-1/FD-4/FD-5/FD-10 y al patrón Nexus. Sin críticos ni mayores.
Habilita el cierre de R3 **una vez** aplicado y verificado en producción.
