# TOPS NEXUS — RRHH · R6 AUDIT REPORT
## Auditoría del frontend RRHH (commit `043ae54`)

> **Tipo:** auditoría de gate R6, solo lectura. Énfasis en RPC-First, no-cálculo-en-cliente (FD-9),
> espejo de seguridad (RLS/RBAC) y no-invasión. **Fecha:** 2026-06-07.

## 1. Resumen
El frontend consume R1–R5 correctamente, respeta las decisiones D1–D4 y no invade otros dominios.
**`tsc --noEmit`: 0 errores.** **0 críticos · 0 mayores.** E2E pendiente (D4).

## 2. Controles
| # | Control | Resultado | Evidencia |
|---|---------|-----------|-----------|
| C1 | Capa `src/lib/rrhh/{types,data,actions,validation,errors}` (patrón Nexus) | **PASS** | 5 archivos |
| C2 | RPC-First: transiciones vía server actions → RPCs de R4/R5 | **PASS** | `actions.ts` (`rrhh_solicitud_*`, `emit_rrhh_signed_url`) |
| C3 | Sin cálculo en cliente (FD-9) | **PASS** | KPIs por conteo en base; roll-ups server-side |
| C4 | Seguridad espejada: bancario/salud gateado por `has_permission('rrhh.admin')` | **PASS** | `empleados/[id]` muestra bancario solo si admin; RLS además fuerza |
| C5 | Signed URL efímero; nunca `storage_path` crudo | **PASS** | `getDocumentoSignedUrl` (RPC autoriza+audita → admin firma → URL 120s) |
| C6 | D1 dashboard sin `rrhh_v_*` ni migración | **PASS** | conteos en `getDashboardCounts` |
| C7 | D2 organigrama no duplicado | **PASS** | enlace a `/organigrama`; sin ruta `rrhh/organigrama` |
| C8 | D3 sin build/deploy | **PASS** | no ejecutado |
| C9 | No toca R1–R5 ni Drive/Clientify/ERP/Tracking/CCTV | **PASS** | diff limitado a `src/lib/rrhh`, `src/app/(app)/rrhh`, `Sidebar.tsx` |
| C10 | Degradación con `ModuleUnavailable` si backend ausente | **PASS** | try/catch en todas las páginas |
| C11 | Typecheck | **PASS** | `tsc --noEmit` = 0 errores |
| C12 | Commit aislado del frontend | **PASS** | `043ae54` (14 archivos) |

## 3. Hallazgos
- 🔴 Críticos: **0** · 🟠 Mayores: **0**
- 🟡 Menores (no bloquean):
  - **m1** — los resultados de las server actions (`RrhhActionResult.message`) no se muestran inline
    (la página revalida y re-renderiza el estado); mejora de UX (toast) para una iteración posterior.
  - **m2** — alta/edición de legajo y **upload** de documentos: la UI los lista/consume, pero el alta
    de empleados y la subida de binarios se harán con flujo admin/`service_role` (server action de
    carga) a detallar en una iteración de backend de carga; R6 cubre lectura + workflow + descarga.
  - **m3** — dashboard KPIs acotados a conteos (D1); ausentismo/saldos quedan para el gate de vistas.

## 4. Veredicto
> ## R6 ARTEFACTO — `PASS` (typecheck-limpio) · E2E PENDIENTE
Frontend correcto, RPC-First, PII espejada, no invasivo y sin errores de tipo. Habilita la
**validación E2E** (D4) antes del cierre de R6.
