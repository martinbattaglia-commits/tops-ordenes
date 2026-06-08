# TOPS NEXUS — RRHH · R4 IMPLEMENTATION REPORT
## R4 — WORKFLOW FOUNDATION · `0059_rrhh_workflows`

> **Autorización:** Dirección — plan **APPROVED**; RPCs en `0059`; criterio = cero críticos/mayores.
> **Producción:** `arsksytgdnzukbmfgkju`. **Fecha:** 2026-06-07.

## 1. Resumen
Implementado el artefacto de R4: **`0059_rrhh_workflows.sql`** (workflow completo: tablas + estados +
RPCs de transición + RLS + append-only). Verificado en alcance y **committeado aislado** (`ada9fd7`).
**Estado:** **CODE COMPLETE + COMMITEADO + VERIFICADO localmente**; **aplicación a producción
PENDIENTE** (paso manual — sin link/credenciales en este entorno, igual que R1–R3).

## 2. Preflight
| Check | Resultado |
|-------|-----------|
| `0059` libre | ✅ |
| Rama | ✅ `claude/gracious-pasteur-6efdde` |
| Precondición `0056`–`0058` (lado repo) | ✅ (prod = atestación Dirección; reconfirmar al aplicar) |
| Plan aprobado | ✅ APPROVED |
| Alcance | ✅ workflow (sin UI/buckets/storage/recibos/firma/salarial) |

## 3. Artefacto (`0059_rrhh_workflows.sql`, 436 líneas)
- **Enums (7):** solicitud_tipo/estado, permiso_subtipo, licencia_subtipo, recargo, novedad_tipo, evento_accion.
- **Tablas (4):** `rrhh_solicitudes` (+ secuencia/public_id SOL-YYYY-NNNNNN), `rrhh_horas_extra_detalle`
  (1:1), `rrhh_solicitud_eventos` (append-only, trazabilidad), `rrhh_novedades` (append-only).
- **RPCs (helper + 7):** `rrhh_caller_empleado_id`; `crear`, `enviar`, `aprobar_l1`, `aprobar_l2`,
  `rechazar`, `cancelar`, `anular`. Todas `security definer`, fail-closed `coalesce(has_permission)`
  (11×), `FOR UPDATE` (6×), validan estado, escriben evento. `grant execute` a authenticated/service_role.
- **RLS:** `has_permission`+propiedad+supervisor (lectura); escritura directa solo `rrhh.admin`
  (transiciones por RPC). **Sin `current_role()`** (solo comentarios).
- **Append-only:** forbid delete (solicitudes/eventos/novedades) + forbid update (eventos/novedades).
- **Novedad:** generada solo en `aprobar_l2`; `anular` → contrapartida. **Sin liquidación**
  (recargo = metadato).

## 4. Adherencia al alcance (R4 congelado)
| Restricción | Cumplimiento |
|-------------|--------------|
| Tablas+estados+RPCs+RLS+append-only | ✅ |
| NO UI / buckets / storage / recibos / firma digital / integración salarial | ✅ (verificado) |
| NO `current_role()` (FD-5) | ✅ |
| RPC-First, fail-closed (FD-4), append-only (FD-10) | ✅ |
| NO avanzar a R5 | ✅ |
| NO tocar otros dominios | ✅ |

**Commit aislado:** `ada9fd7` — 1 archivo, 436 inserciones. Docs `RRHH_*` fuera del commit.

## 5. Aplicación a producción (manual — PENDIENTE)
Operador: preflight (backup + `0056`–`0058` aplicadas + `0059` libre + ventana + operador único) →
aplicar `0059` → verificar (`RRHH_R4_AUDIT_REPORT.md §3`).

## 6. Resultado
- Implementación del artefacto: ✅ COMPLETA (`ada9fd7`).
- Aplicación a producción: ⏳ PENDIENTE (manual).
- Desviaciones de alcance: ninguna.
