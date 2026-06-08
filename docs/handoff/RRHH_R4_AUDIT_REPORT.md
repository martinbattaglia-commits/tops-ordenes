# TOPS NEXUS — RRHH · R4 AUDIT REPORT
## Auditoría del artefacto `0059_rrhh_workflows` (WORKFLOW FOUNDATION)

> **Tipo:** auditoría de gate R4, adversarial, solo lectura. Énfasis en máquina de estados, RPC-First
> fail-closed, append-only y ausencia de liquidación. **Fecha:** 2026-06-07.

## 1. Resumen
`0059` (commit `ada9fd7`) implementa el workflow conforme al plan aprobado y al modelo congelado.
**0 críticos · 0 mayores.** Aplicación/verificación en prod = paso manual (§3).

## 2. Controles
| # | Control | Resultado | Evidencia |
|---|---------|-----------|-----------|
| C1 | Alcance: 4 tablas + estados + RPCs (sin UI/buckets/storage/recibos/firma/salarial) | **PASS** | grep de tablas/objetos |
| C2 | Estados completos, sin huérfanos ni transiciones imposibles | **PASS** | enum 7 estados; transiciones validadas en RPC; terminales rechazada/cancelada/anulada |
| C3 | RPC-First: transiciones solo por RPC `security definer` | **PASS** | 8 `security definer`; escritura directa RLS = `rrhh.admin` |
| C4 | Fail-closed (FD-4) | **PASS** | 11× `coalesce(has_permission(...),false)`; sin `current_role()` |
| C5 | L1 por `supervisor_id`; L2 por `rrhh.edit` | **PASS** | `aprobar_l1` valida `supervisor_id`; `aprobar_l2` valida `rrhh.edit` |
| C6 | Concurrencia / consistencia de estado | **PASS** | `FOR UPDATE` (6×) + validación de `estado` antes de transicionar |
| C7 | Cancelación pre-aprobación (dueño) + anulación post (RRHH+contrapartida) | **PASS** | `cancelar` (owner, borrador/pendiente_*); `anular` (rrhh.edit, aprobada, +contrapartida) |
| C8 | Novedad solo al aprobar L2; sin doble alta; trazable | **PASS** | insert en `aprobar_l2` con `origen_solicitud_id`; append-only |
| C9 | Sin liquidación (FD-8) | **PASS** | recargo = metadato; novedad sin importes |
| C10 | Append-only (FD-10) | **PASS** | forbid delete (3) + forbid update (eventos/novedades) |
| C11 | RLS lectura: staff/propiedad/supervisor; operaciones nulo | **PASS** | policies con `has_permission`+`profile_id`+supervisor join |
| C12 | Trazabilidad: evento por cada transición | **PASS** | insert en `rrhh_solicitud_eventos` en las 7 RPCs |
| C13 | Idempotencia / re-ejecución | **PASS** | `if not exists`, `do$$ exception`, `drop trigger/policy if exists`, `create or replace` |
| C14 | Commit aislado | **PASS** | `ada9fd7`: 1 archivo |

## 3. Verificación post-aplicación (operador, read-only)
```
☐ 4 tablas + 7 enums creados
☐ 7 RPCs rrhh_solicitud_* + helper presentes (grant execute a authenticated)
☐ RLS on en las 4 tablas; policies de lectura presentes
☐ Transición feliz: crear→enviar→aprobar_l1→aprobar_l2 deja estado 'aprobada' + 1 novedad
☐ aprobar_l1 por NO-supervisor → ACCESS_DENIED; aprobar_l2 sin rrhh.edit → ACCESS_DENIED
☐ aprobar_l2 sobre estado != pendiente_rrhh → INVALID_STATE
☐ anular(aprobada) → 'anulada' + contrapartida (novedad negativa)
☐ DELETE/UPDATE directo en eventos/novedades → error (append-only)
☐ Empleado ve solo sus solicitudes; supervisor ve las de su equipo; operaciones 0
☐ Sin objetos fuera de alcance (no UI/buckets/storage/recibos)
```

## 4. Hallazgos
- 🔴 Críticos: **0** · 🟠 Mayores: **0**
- 🟡 Menores (no bloquean):
  - **m1** — `requiere_doc` se respeta como flag pero la **exigencia** de documentación se aplicará en
    el gate de storage (R-docs); hoy `aprobar_l2` no bloquea por falta de doc. Documentado y por diseño.
  - **m2** — validación de **solapamiento de fechas** y de **saldo de vacaciones** no implementada aún
    (saldo depende de `rrhh_jornada`/reglas, gate de vistas). Recomendado agregarla cuando exista el cálculo.
  - **m3 (heredado R3)** — anti-ciclos de organigrama: el `aprobar_l1` usa `supervisor_id` directo (1
    nivel), no recorre cadena → inmune a ciclos multinivel; la prevención de ciclos sigue pendiente en
    la edición de legajo.

## 5. Veredicto
> ## R4 ARTEFACTO — `PASS`
Workflow correcto y completo: estados sin huérfanos, RPC-First fail-closed, L1/L2 bien gobernados,
cancelación/anulación con contrapartida, novedades trazables, **sin liquidación**, append-only. 0
críticos/0 mayores. Habilita el cierre de R4 una vez aplicado y verificado en producción.
