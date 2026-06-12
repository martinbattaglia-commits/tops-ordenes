# FISCAL-HARDENING-EXECUTION-REPORT — Implementación H1–H4

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** FISCAL-HARDENING-EXECUTION-REPORT.md (entregable 1/3 de la fase)
**Fecha:** 2026-06-12
**Rama:** `feature/fiscal-hardening` · base `main@59445d5`
**Autorización:** presidencial 2026-06-12 (alcance exacto H1–H4; sin features nuevas; sin IVA Ventas; sin Facturación Directa; sin merge ni deploy productivo hasta revisión del preview)

> **Estado: IMPLEMENTACIÓN COMPLETA.** tsc 0 · lint 0 · build 0 · QA unitaria 15/15 PASS. La migración 0071 está ESCRITA pero NO aplicada (se aplica en el runbook post-merge).

---

## §0 — Resumen de cambios

| Frente | Cambio | Migración |
|---|---|---|
| H1 | NC/ND con `CbtesAsoc` + validaciones + tope acumulado + anulación por NC total + mock honesto + gate de rol en las puertas de emisión | No |
| H2 | Regla de corte única de validez fiscal (TS + SQL) + KPI del Cockpit corregido + badges de ambiente en /billing | Sí (vista) |
| H3 | Signo de NC en `supplier_invoice_fiscal`, `libro_iva_compras` y `supplier_open_items` | Sí (vistas) |
| H4 | Guard de idempotencia pre-emisión + vínculo OS→factura con reintentos y alerta auditable | No |

**Una sola migración** (`0071_fiscal_hardening.sql`), solo vistas + 1 función estable. Cero cambios de datos, cero borrados, cero cambios de tablas.

---

## §1 — H1 · NC/ND ARCA

| Cambio | Archivo |
|---|---|
| `CbtesAsoc` poblado en `FeDetReq` con (Tipo, PtoVta, Nro, CUIT emisor, fecha) del original | `src/lib/invoicing/emit.ts` |
| Resolución del comprobante asociado + **tope acumulado**: ΣNC autorizadas no anuladas ≤ total del original (±0,02) | `emit.ts` + `sumNotasCreditoDe()` en `data.ts` |
| Validaciones nuevas en `validateInvoice`: NC/ND exigen asociado; asociado autorizado/no anulado; misma letra; mismo receptor; mismo ambiente; NC no rectifica NC | `src/lib/invoicing/calc.ts` |
| `EmitSchema` incorpora `comprobante_asociado_id` (obligatorio en NC/ND, prohibido en facturas) y se eliminó el cast que ocultaba el stripping | `src/app/(app)/billing/actions.ts` |
| **Anulación por documento rectificativo**: `anularInvoiceAction` emite NC total asociada, marca `anulada=true` (flag no protegido por el trigger de inmutabilidad — los importes quedan intactos) y registra `invoice_audit.action='anular'` | `actions.ts` + botón `AnularInvoiceButton.tsx` en /billing |
| **Mock honesto**: el Mock ARCA ahora rechaza NC/ND sin `CbtesAsoc` (Obs 10192, Resultado R, sin CAE) — el sandbox ya no aprueba lo que producción rechazaría | `src/lib/arca/mock-service.ts` |
| **Gate de rol** en las 3 puertas de emisión (`emitInvoiceAction`, `emitFromClientOrdersAction`, `anularInvoiceAction`): espejo del RLS de escritura de `customer_invoices` (admin/operaciones) — antes la action genérica no tenía ningún control | `actions.ts` (`assertBillingRole`) |

Helpers de dominio agregados en `calc.ts`: `esNotaCredito/esNotaDebito/esRectificativo/letraComprobante/notaCreditoPara/signoComprobante`. `FACTURA_E` queda explícitamente sin NC modelada (código ARCA 21, fuera de alcance).

## §2 — H2 · Separación SANDBOX vs producción

- **Regla única** (helper `isFiscallyValid()` en `src/lib/invoicing/fiscal-validity.ts`): válido ⟺ `AUTORIZADO_ARCA ∧ ¬anulada ∧ ambiente = fiscal_config.ambiente`. Prohibido reimplementar el filtro ad hoc (documentado en el propio archivo).
- **KPI "Facturación del mes" del Cockpit** (`command-center.ts`): antes sumaba TODA fila del mes (incluidos RECHAZADO/ERROR y cualquier ambiente); ahora aplica la regla y las **NC restan** (`signoComprobante`).
- **SQL**: `customer_open_items` recreada con filtro `ci.ambiente = public.fiscal_ambiente()` — función `security definer` acotada que expone solo el escalar `ambiente` (las vistas `security_invoker` no pueden leer `fiscal_config` bajo su RLS). `customer_current_account` y `treasury_cashflow_projection` heredan el corte por derivación.
- **/billing**: badge de ambiente en todo comprobante no-PRODUCCION + badge ANULADA + fila atenuada. Los comprobantes de prueba no se borran: salen del corte, no de la vista operativa.

## §3 — H3 · Corrección IVA Compras (signo NC)

- `supplier_invoice_fiscal` y `libro_iva_compras`: factor `CASE tipo_comprobante LIKE 'NOTA_CREDITO%' THEN -1` aplicado a neto, IVA, percepciones, tributos y totales. Caso de control documentado en la migración: factura $121.000 (IVA $21.000) + NC $12.100 (IVA $2.100) → crédito **$18.900** (antes: $23.100).
- `supplier_open_items`: una NC de proveedor entra con total/saldo negativos → **reduce el saldo a pagar** en `supplier_current_account` y no aparece como deuda. Columnas y filtros idénticos a 0054 (compatibilidad de consumidores verificada: `tesoreria/data.ts` solo lee columnas existentes).
- Los importes almacenados siguen positivos (no se tocan los CHECK ≥ 0 ni los datos): el signo es semántica de las vistas — el mismo criterio que usará `libro_iva_ventas` en V2.

## §4 — H4 · Prevención de doble facturación

- **Guard pre-emisión** (`findBilledOrderConflicts()` en `data.ts`, capa de datos testeable): antes de pedir CAE, ninguna OS candidata puede estar referenciada vía `invoice_items.order_id` por un comprobante AUTORIZADO no anulado que no sea NC. Si hay conflicto → aborta listando `OS → comprobante`. **No depende del update post-CAE.**
- **Post-CAE robusto**: el update `orders → FACTURADA` ahora corre con `WHERE status='FIRMADA'` + 3 reintentos con backoff; si agota: entrada `invoice_audit` (action `error`, detalle H4) + `warning` visible en la UI del botón (antes: `console.warn` silencioso).
- La NC de anulación **no copia `order_id`** (el vínculo operativo pertenece al original) y las facturas anuladas liberan sus OS ante el guard.

---

## §5 — Archivos modificados (12)

| Archivo | Frente |
|---|---|
| `supabase/migrations/0071_fiscal_hardening.sql` (NUEVA — no aplicada) | H2+H3 |
| `src/lib/invoicing/calc.ts` | H1 |
| `src/lib/invoicing/emit.ts` | H1 |
| `src/lib/invoicing/data.ts` | H1+H4 |
| `src/lib/invoicing/fiscal-validity.ts` (NUEVO) | H2 |
| `src/lib/arca/mock-service.ts` | H1 |
| `src/app/(app)/billing/actions.ts` | H1+H4 |
| `src/app/(app)/billing/page.tsx` | H1+H2 |
| `src/app/(app)/billing/EmitInvoiceButton.tsx` | H4 |
| `src/app/(app)/billing/AnularInvoiceButton.tsx` (NUEVO) | H1 |
| `src/lib/ejecutivo/command-center.ts` | H2 |
| `scripts/qa/fiscal-hardening-test.ts` (NUEVO — QA reproducible) | QA |

## §6 — Cumplimiento de alcance

- ✅ Alcance exacto H1–H4 según FISCAL-HARDENING-PLAN.md y REVIEW-SESSION.
- ✅ Sin features nuevas: no hay UI de IVA Ventas, no hay Facturación Directa, no se tocaron percepciones (G4→V3), letra por condición IVA (G9→V2) ni CHECK de alícuota (G7→V1).
- ✅ Tesorería ERP-A: RPCs y tablas intactas (solo vistas derivadas recreadas con columnas idénticas).
- ✅ RBAC: Estrategia B y `RBAC_ENFORCE` sin tocar; el gate de emisión replica el RLS existente (no agrega slugs).
- ⏸ Migración 0071: escrita, **no aplicada** — se aplica en el runbook post-merge con verificación de numeración contra main.

Detalle de pruebas: ver FISCAL-HARDENING-QA.md. Guía de validación del preview: FISCAL-HARDENING-PREVIEW.md.
