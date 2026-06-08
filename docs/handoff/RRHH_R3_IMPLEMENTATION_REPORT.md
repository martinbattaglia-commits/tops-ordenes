# TOPS NEXUS — RRHH · R3 IMPLEMENTATION REPORT
## R3 — CORE DATA MODEL · `0058_rrhh_core`

> **Autorización:** Dirección (R3) + confirmación explícita de **RLS incluida en R3**.
> **Nota:** la autorización original llegó truncada (terminaba en "Auditor"); se procedió con la
> metodología establecida en R1/R2 (idéntico set de entregables). Si la sección faltante variaba
> requisitos, debe avisarse.
> **Producción:** `arsksytgdnzukbmfgkju`. **Fecha:** 2026-06-07.

## 1. Resumen
Implementado el artefacto de R3: **`0058_rrhh_core.sql`** (modelo de datos del legajo + RLS +
append-only). Verificado en alcance y **committeado aislado** (`bf8ca7e`).
**Estado:** artefacto **CODE COMPLETE + COMMITEADO + VERIFICADO localmente**; **aplicación a
producción PENDIENTE** (paso manual — este entorno sin link/credenciales, igual que R1/R2).

## 2. Preflight
| Check | Resultado |
|-------|-----------|
| `0058` libre | ✅ |
| Rama | ✅ `claude/gracious-pasteur-6efdde` |
| Precondición `0056`+`0057` (lado repo) | ✅ (prod = atestación Dirección; reconfirmar al aplicar) |
| RLS en R3 | ✅ confirmada por Dirección |
| Alcance = solo modelo de datos | ✅ |

## 3. Artefacto (`0058_rrhh_core.sql`, 225 líneas)
- **Enums:** `rrhh_estado_empleado_t` (activo/licencia/baja), `rrhh_estado_civil_t`,
  `rrhh_modalidad_contratacion_t` (tipos nuevos, idempotentes).
- **Tablas (3):** `rrhh_empleados` (legajo + organigrama `supervisor_id`; `depot public.depot_t`
  reutilizado), `rrhh_empleado_bancario` (separada por sensibilidad, append-only),
  `rrhh_empleado_historial` (append-only).
- **Secuencia:** `rrhh_empleado_legajo_seq` (nº legajo `public_id`).
- **RLS:** `has_permission('rrhh.view'/'rrhh.admin')` + propiedad (`profile_id = auth.uid()`),
  fail-closed `coalesce(...,false)` (×8), **sin `current_role()`**. Patrón CRM `0042/0043`.
- **Append-only:** `tg_forbid_delete_rrhh` (3 tablas) + `tg_forbid_update_rrhh` (bancario/historial);
  `touch_updated_at` en empleados.
- **Índices:** supervisor/profile/estado/depot/seccion + FKs.

## 4. Adherencia al alcance (R3 estricto)
| Restricción | Cumplimiento |
|-------------|--------------|
| Solo modelo de datos | ✅ 3 tablas + enums + RLS + append-only |
| NO workflows/vacaciones/permisos/licencias/novedades/recibos | ✅ (verificado: ninguna tabla de esos) |
| NO buckets/storage | ✅ |
| NO RPCs | ✅ (solo funciones-trigger de inmutabilidad) |
| NO UI | ✅ |
| NO `current_role()` (FD-5) | ✅ (solo `has_permission`) |
| Reutiliza `depot_t` (no redefine) | ✅ |
| NO tocar otros dominios / `user_role_t` | ✅ |

**Commit aislado:** `bf8ca7e` — 1 archivo, 225 inserciones. Docs `RRHH_*` fuera del commit.

## 5. Aplicación a producción (manual — PENDIENTE)
Operador, sobre `arsksytgdnzukbmfgkju`: preflight (backup + reconfirmar `0056`/`0057` aplicadas +
`0058` libre + ventana + operador único) → aplicar `0058_rrhh_core.sql` → verificar
(`RRHH_R3_AUDIT_REPORT.md §3`).

## 6. Resultado
- Implementación del artefacto: ✅ COMPLETA (`bf8ca7e`).
- Aplicación a producción: ⏳ PENDIENTE (manual).
- Desviaciones de alcance: ninguna.
