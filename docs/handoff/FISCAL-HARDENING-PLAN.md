# FISCAL-HARDENING-PLAN — Estabilización de la base fiscal previa a IVA Ventas

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** FISCAL-HARDENING-PLAN.md (entregable 8 de la serie fiscal; fase previa a V1 de VAT-SALES)
**Fecha:** 2026-06-12
**Naturaleza:** PLAN DE FASE — no se escribió código ni migraciones. **Cero migraciones hasta aprobación explícita de esta fase** (directiva presidencial 2026-06-12).
**Base:** main + PR #15 · evidencia: auditoría VAT-SALES-DOMAIN-DESIGN.md §1
**Decisión presidencial (2026-06-12):** IVA Ventas queda en estado de **diseño aprobado**; antes de V1 se ejecuta FISCAL-HARDENING con foco exclusivo en 4 frentes. No desarrollar todavía la UI de IVA Ventas.

> **Objetivo:** dejar la base fiscal estable y confiable — comprobantes rectificativos reales, libros sin datos de prueba, crédito fiscal con signo correcto y cero doble facturación — antes de construir encima `customer_invoice_vat_lines`, `libro_iva_ventas`, `posicion_iva_mensual`, retenciones y percepciones.

---

## §0 — Alcance

**EN alcance (exclusivo, por directiva):**

| Frente | Gap origen | Tipo de cambio |
|---|---|---|
| H1 — NC/ND ARCA | G5 + G6 | código (sin migración) |
| H2 — Separación SANDBOX vs producción | G10 | código + **1 migración** (vista) |
| H3 — Corrección IVA Compras (signo NC) | G11 | **misma migración** (vistas 0059) |
| H4 — Prevención de doble facturación | G8 | código (sin migración) |

**FUERA de alcance (diferido, por directiva):** UI de IVA Ventas, `customer_invoice_vat_lines`, `libro_iva_ventas`, `posicion_iva_mensual`, retenciones, percepciones (→ fases V1–V4 del diseño aprobado); letra por condición IVA (G9 → V2); CHECK de alícuota en `invoice_items` y fix del default silencioso a 21% (G7 → V1, junto a vat_lines); exento/no gravado (G1 → V3); materialización de PDFs al bucket.

---

## §1 — H1 · NC/ND ARCA (comprobantes rectificativos reales)

**Problema (evidencia):** los 6 tipos NC/ND existen nominalmente, pero `EmitSchema` stripea `comprobante_asociado_id` (`billing/actions.ts:44-79`), `emit.ts` nunca envía `CbtesAsoc` en `FeDetReq` aunque `wsfev1.ts:125-131` sabe serializarlo, y RG 4540 lo exige → **ARCA real rechazaría toda NC/ND**; el mock SANDBOX las aprueba (falsa confianza). Además `ANULADO`/`anulada` no tienen escritor (G6): hoy un error de emisión es incorregible.

**Cambios (todos en código, sin migración):**
1. `EmitSchema`: incorporar `comprobante_asociado_id` (uuid, **obligatorio si** `tipo_comprobante` es NC/ND, prohibido en facturas). Eliminar el cast `parsed.data as EmitInvoiceInput` que oculta el stripping.
2. `emit.ts`: si hay comprobante asociado → resolver `(PtoVta, Tipo, Nro)` + CUIT del original y poblar `CbtesAsoc` en `FeDetReq`. Validaciones previas en `validateInvoice`: el asociado debe estar `AUTORIZADO_ARCA`, mismo receptor, misma letra; el importe de la NC no puede exceder el saldo no acreditado del original (Σ NC previas).
3. **Anulación por documento rectificativo** (patrón append-only): acción `anularPorNotaCredito(invoiceId)` = emitir NC total referenciando el original + marcar `anulada=true` en el original (permitido: el trigger de inmutabilidad `0011:257-281` no protege ese flag) + entrada en `invoice_audit` con acción `anular`. **Nunca** UPDATE de importes.
4. Gate RBAC a `emitInvoiceAction` (puerta programática hoy sin permiso) — mismo guard que el resto del dominio.

**Verificación:** suite en HOMOLOGACIÓN (no SANDBOX-mock): factura → NC parcial → NC excedente (debe rechazar) → anulación total. Evidencia de los 4 casos en el reporte de ejecución.

---

## §2 — H2 · Separación SANDBOX vs producción

**Problema (evidencia):** `customer_invoices` mezcla filas `ambiente='SANDBOX'` (CAE falso, numeración de mock que se resetea) con futuras filas reales; conviven `AUTORIZADO/RECHAZADO/ERROR`. Consumidores actuales que **no** filtran ambiente: KPI "Facturación del mes" del Cockpit (`command-center.ts:49-69`), listado `/billing`, y la vista `customer_open_items` (`0054:362-377`, filtra estado y anulada pero **no ambiente**) → Tesorería podría mostrar cobranzas pendientes de facturas de prueba.

**Regla de corte (única, centralizada):** un comprobante es **fiscalmente válido** ⟺ `estado_arca='AUTORIZADO_ARCA' AND anulada=false AND ambiente = fiscal_config.ambiente`. Helper único `isFiscallyValid()` / predicado SQL compartido — prohibido re-implementar el filtro ad hoc.

**Cambios:**
1. Código: `billingThisMonth()` y `listInvoices()` aplican la regla de corte (los no válidos quedan visibles solo en la vista operativa de `/billing` con badge de ambiente/estado).
2. **Migración (la única de esta fase):** `0071_fiscal_hardening.sql` —
   - `customer_open_items`: agregar el filtro de ambiente (join a `fiscal_config`).
   - (H3 va en la misma migración, ver §3.)
   - Verificar numeración 0071 contra main en el gate (duplicados históricos conocidos).
3. UI `/billing`: badge visible `SANDBOX`/`HOMOLOGACIÓN` en filas no productivas (sin rediseño).

**Verificación:** con `fiscal_config.ambiente='SANDBOX'` los KPIs cuentan solo sandbox; al pasar a `PRODUCCION`, el stock sandbox desaparece de KPIs, tesorería y futuros libros. Query de control antes/después documentada.

---

## §3 — H3 · Corrección IVA Compras (signo de NC)

**Problema (evidencia):** `NOTA_CREDITO_A/B/C` existen en el enum AP (`0014:26`) y son cargables vía `ap_create_supplier_invoice`, pero `supplier_invoice_fiscal` y `libro_iva_compras` (`0059:16-69`) no manejan signo y `supplier_invoice_vat_lines` exige importes ≥ 0 → **una NC de proveedor SUMA crédito fiscal en vez de restarlo**. El Libro IVA Compras productivo sobredeclara crédito si existe cualquier NC cargada.

**Cambios (en `0071_fiscal_hardening.sql`, misma migración que H2):**
1. Recrear las vistas 0059 con factor de signo: `CASE WHEN tipo_comprobante LIKE 'NOTA_CREDITO%' THEN -1 ELSE 1 END` aplicado a neto, IVA, percepciones, tributos y totales. Los importes almacenados siguen positivos (no se toca el CHECK ≥ 0 ni los datos): **el signo es semántica de las vistas**, mismo criterio que usará `libro_iva_ventas`.
2. `supplier_open_items`/AP status: revisar que una NC reduzca el saldo a pagar del proveedor (hoy las vistas de tesorería tratan toda factura como deuda positiva — verificar y corregir en la misma pasada si aplica).
3. Reporte de impacto pre/post sobre datos reales: cuántas NC existen cargadas y cuánto cambia el crédito fiscal por período (puede ser $0 si aún no hay NC — igual se deja correcto).

**Verificación:** caso de prueba — factura $121.000 (IVA $21.000) + NC $12.100 (IVA $2.100) → `libro_iva_compras` del período debe mostrar crédito $18.900, no $23.100.

---

## §4 — H4 · Prevención de doble facturación de OS

**Problema (evidencia):** `emitFromClientOrdersAction` obtiene CAE primero y recién después marca las OS `FACTURADA` con un update best-effort que ante error solo loguea (`actions.ts:152-156`). Si falla, las OS quedan `FIRMADA` y el botón permite **re-facturarlas con un segundo CAE válido**.

**Cambios (código, sin migración):**
1. **Guard de idempotencia pre-emisión (la defensa real):** antes de llamar a ARCA, verificar que ninguna de las OS candidatas ya esté referenciada por `invoice_items.order_id` de una factura con `estado_arca='AUTORIZADO_ARCA' AND anulada=false` del ambiente vigente. Si alguna lo está → abortar con error explícito listando las OS conflictivas. Esta verificación no depende de que el update post-CAE haya funcionado.
2. **Post-CAE robusto:** el update `orders → FACTURADA + invoice_id` se ejecuta con reintentos (3, backoff) usando `WHERE status='FIRMADA'`; si agota reintentos → entrada `invoice_audit` con acción `error` + alerta visible en `/billing` ("factura emitida con OS sin marcar — acción requerida"), nunca un `console.warn` silencioso.
3. UI: el botón de emisión muestra y excluye OS ya facturadas (lookup por `invoice_items.order_id`), con detalle de a qué factura pertenecen.

**Verificación:** test de doble click/replay sobre el mismo cliente — la segunda emisión debe abortar en el guard aunque el update post-CAE de la primera haya fallado (simulado).

---

## §5 — Riesgos de la fase

| Nivel | Riesgo | Mitigación |
|---|---|---|
| 🔴 P0 | Recrear vistas 0059 con tesorería operando | migración idempotente `create or replace`, sin cambio de columnas consumidas; validación en preview + smoke de `/compras/libro-iva` y tesorería post-deploy |
| 🟠 P1 | Regla de corte por ambiente oculta facturas que el usuario esperaba ver | las no válidas siguen visibles en `/billing` con badge; solo desaparecen de KPIs/libros/tesorería |
| 🟠 P1 | NC en homologación requiere credenciales ARCA de homologación | si no están disponibles, los casos §1 se validan contra el mock extendido + revisión de payload `CbtesAsoc` byte a byte vs spec WSFEv1; se documenta la limitación |
| 🟡 P2 | Colisión de numeración 0071 | verificación contra main en el gate de merge |

---

## §6 — Entregables y gates

| Paso | Entregable | Gate |
|---|---|---|
| 1 | Este plan | ✅ generado — **pendiente de aprobación presidencial para ejecutar** |
| 2 | Rama `feature/fiscal-hardening` + migración `0071_fiscal_hardening.sql` + cambios de código H1/H2/H3/H4 | aprobación explícita de esta fase (desbloquea la migración) |
| 3 | FISCAL-HARDENING-EXECUTION-REPORT.md con las 4 verificaciones (§1–§4) + tsc/lint/build + Deploy Preview | validación presidencial del preview |
| 4 | Merge `--no-ff` a main + deploy + smoke (libro IVA compras, /billing, tesorería, cockpit) | confirmación Published |
| 5 | **Recién entonces:** arranque de V1 (vat_lines → libro_iva_ventas → posicion → retenciones → percepciones, en ese orden) | gate por fase según diseño aprobado |

> Restricción cumplida: solo plan — cero código, cero migraciones, producción intacta. La migración 0071 no se escribe hasta la aprobación explícita de esta fase.
