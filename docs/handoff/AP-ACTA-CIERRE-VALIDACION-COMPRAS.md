# Acta de Cierre — Validación Funcional del Circuito de Compras

| | |
|---|---|
| **Fecha** | 2026-06-28 |
| **Alcance** | Circuito completo de Compras / Cuentas por Pagar de TOPS Nexus: Proveedores → Órdenes de Compra → Facturas/OCR → Conciliación OC↔Factura → Libro IVA → handoff a Tesorería. |
| **Rama** | `feat/conciliacion-oc` (unificación definitiva de `release/conciliacion-oc` + `feat/conciliacion-oc`). |
| **Entorno de validación** | Preview Netlify `6a40d58…` contra Supabase **prod** `arsksytgdnzukbmfgkju` (único entorno). |
| **Validador / autoridad** | Martín Battaglia (presidente · admin). |
| **Resultado** | ✅ **Criterio de salida CUMPLIDO — validación funcional APROBADA.** |

## Qué se validó (Etapas 0–8)
Recorrido E2E manual sobre datos reales de producción. Las 9 etapas (Preflight, Proveedores, OC, Facturas/OCR, Recepción-contraste, Conciliación, Libro IVA, Tesorería-handoff, Dashboard/Nav/RBAC) se ejecutaron con resultado satisfactorio. Detalle completo en [`AP-PLAN-VALIDACION-COMPRAS-E2E.md`](./AP-PLAN-VALIDACION-COMPRAS-E2E.md).

## Fixes re-verificados EN VIVO (lo que motivó la unificación)
- **Incidente OCR "Number must be ≥ 0":** el mensaje ahora nombra el campo ("Importe no gravado: el valor no puede ser negativo…"); el crudo de Zod ya no aparece.
- **Conciliación OC↔Factura — los 6 fixes:**
  - (a) query PostgREST del detalle → side-by-side sin error 400.
  - (b) "Iniciar" postea JSON → la conciliación arranca.
  - (c) control de rol con `current_role()` → dashboard lista y acciones admin OK.
  - (d) hidratación por fechas → el detalle de recon ya no crashea (#425).
  - (e) on-ramp → selector de OC + botón "Conciliar" + ruteo correcto.
  - (f) doble control con excepción admin (mig 0105) → **confirmado en BD**: `initiated_by = resolved_by = admin`.

## Hallazgos (NO bloquean el release → backlog próximo ciclo)
H-1 a H-7 registrados en [`AP-BACKLOG-MEJORAS.md`](./AP-BACKLOG-MEJORAS.md). Prioritarios: **H-1** (CUIT sin normalizar), **H-2** (fecha −1 en listados de Compras), **H-3** (hidratación #425/#422 en preview A4 de OC). Ninguno compromete la integridad ni el estado estable de producción.

## Datos de prueba (conservados)
Proveedores `QA Compras E2E SA` y `Duplicado Test SA`; facturas `FP-2026-0024`, `FP-2026-0025`, `FP-2026-0026`; 1 borrador de OC. Se conservan como fixtures; su limpieza queda a criterio posterior.

## Decisión
Se **autoriza avanzar con el proceso de release a producción** (commit de cierre, verificación lint/typecheck/tests/build, push, merge, deploy oficial Netlify, verificación `/api/version` y smoke test). Los hallazgos H-1…H-7 quedan como backlog y **no bloquean** este release.
