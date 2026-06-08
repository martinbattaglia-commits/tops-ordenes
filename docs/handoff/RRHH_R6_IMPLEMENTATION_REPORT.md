# TOPS NEXUS — RRHH · R6 IMPLEMENTATION REPORT
## R6 — UI / PORTAL & DASHBOARD

> **Autorización:** Dirección — plan APPROVED + D1 (KPIs simples sin migración) / D2 (organigrama
> integra con `/organigrama` existente) / D3 (build/deploy fuera de R6) / D4 (E2E Playwright + manual).
> **Commit:** `043ae54`. **Fecha:** 2026-06-07.

## 1. Resumen
Implementado el frontend completo de RRHH (capa `lib` + pantallas + Sidebar), consumiendo R1–R5
(`0056`–`0060`) ya en producción. **Sin migraciones** (D1), **sin build/deploy** (D3, release aparte).
**`tsc --noEmit`: 0 errores** en todo el proyecto. **Estado:** `R6 IMPLEMENTED · AWAITING E2E VALIDATION`.

## 2. Artefactos (14 archivos, 965 líneas — commit `043ae54`)
**Capa lib** `src/lib/rrhh/`:
- `types.ts` (espejo de tablas/RPC), `errors.ts` (mapeo de errcodes a mensajes UI),
  `validation.ts` (zod), `data.ts` (read accessors + `hasPerm` + KPIs por conteo),
  `actions.ts` (`"use server"` → RPCs de R4/R5 + signed URL).

**Pantallas** `src/app/(app)/rrhh/`:
- `page.tsx` Dashboard (KPIs simples: dotación/activos/licencia/solicitudes/vacaciones/licencias).
- `empleados/` lista + `[id]` detalle (bancario y salud solo `rrhh.admin`; historial).
- `solicitudes/` lista + `[id]` detalle con workflow (enviar/aprobar L1/L2/rechazar/cancelar/anular)
  vía server actions que invocan los RPCs; timeline desde `rrhh_solicitud_eventos`.
- `novedades/` lectura por período. `documentos/` listado + descarga por `emit_rrhh_signed_url`.
- `mi-espacio/` portal del empleado (su legajo + accesos).

**Sidebar** `src/components/shell/Sidebar.tsx`: dominio "Recursos Humanos" (6 items). Organigrama
**enlaza** a `/organigrama` existente (D2 — sin duplicar).

## 3. Alcance y decisiones aplicadas
| Punto | Estado |
|-------|--------|
| Sidebar / Mi Espacio / Empleados / Solicitudes / Novedades / Documentación / Dashboard / Roles UI | ✅ |
| D1 Dashboard KPIs simples (sin `rrhh_v_*`, sin migración) | ✅ conteos en `data.ts` |
| D2 Organigrama integrado a `/organigrama` (no duplicar) | ✅ enlace, sin ruta nueva |
| D3 Build/deploy fuera de R6 | ✅ no ejecutado |
| FD-9 (sin cálculo en cliente) | ✅ KPIs por conteo en base; roll-ups server-side |
| Seguridad UI espeja RLS/RBAC | ✅ `has_permission` + RLS; bancario/salud gateado; signed URL efímero |
| No tocar R1–R5 / Drive / Clientify / ERP / Tracking / CCTV | ✅ |

## 4. Verificación local
- **`tsc --noEmit` → 0 errores** (proyecto completo).
- **Build/deploy:** NO ejecutado (D3 — release separado).
- **E2E:** PENDIENTE (D4 — Playwright + manual) → ver `RRHH_R6_FINAL_VALIDATION` (próximo).

## 5. Resultado
- Implementación: ✅ COMPLETA y typecheck-limpia (`043ae54`).
- Build/deploy a producción: ⏸ fuera de alcance R6 (D3).
- E2E visual: ⏳ pendiente (D4).
