# Checklist ejecutivo — Aplicación en STAGING de 0082–0101

> Versión corta y práctica del runbook completo
> (`docs/runbooks/aplicacion-contabilidad-fiscal-0082-0101.md`).
> **Destino:** STAGING (`vrxosunxlhohmqymxots`). **NO producción.** Aplica Martín a mano (G3).
> Marcá cada `[ ]` a medida que avanzás. **No saltees bloques.**

---

## 0. Antes de empezar (precondiciones mínimas)

- [ ] **Backup / restore point** de staging tomado AHORA.
- [ ] Estás en **staging**, no en producción (confirmado el proyecto Supabase).
- [ ] Migraciones **0001–0081 ya aplicadas** en staging.
- [ ] Branch `claude/nexus-accounting-tax-audit-mbpxjt` (de ahí salen los `.sql`).
- [ ] Usuario SQL con privilegios de owner/`postgres`.
- [ ] **Aplicar UN archivo por ejecución** (no pegar varios en un solo run).
      → crítico para `0082` (`ALTER TYPE … ADD VALUE`).
- [ ] Extensión **`btree_gist`** habilitada (la usa `0097`). Si no, habilitarla en
      Database → Extensions antes del Bloque E.

---

## 1. Orden exacto de migraciones (aplicar y tildar)

**Bloque A — Contabilidad base**
- [ ] 0082_accounting_enums
- [ ] 0083_accounting_core
- [ ] 0084_accounting_seed
- [ ] 0085_accounting_posting
- [ ] 0086_accounting_reports

**Bloque B — Fiscal (percepciones/retenciones)**
- [ ] 0087_sales_other_taxes
- [ ] 0088_supplier_withholdings
- [ ] 0089_phase10_posting_and_reports

**Bloque C — Tesorería bruto/retención/neto**
- [ ] 0090_treasury_withholdings_native
- [ ] 0091_phase11_reports_backfill

**Bloque D — Centros de costo / logistics / cierre**
- [ ] 0092_cost_centers_dimension
- [ ] 0093_logistics_billing
- [ ] 0094_cost_center_posting_reports
- [ ] 0095_accounting_closing

**Bloque E — Tarifas / billing / refundición anual**
- [ ] 0096_billable_services
- [ ] 0097_customer_service_rates  *(requiere btree_gist)*
- [ ] 0098_billing_runs
- [ ] 0099_logistics_pricing
- [ ] 0100_billing_draft_invoice
- [ ] 0101_annual_closing

---

## 2. Kit de validación por bloque (correr al cerrar cada bloque)

Todos en `supabase/tests/` y **read-only**. Revisar que la columna `estado` sea `OK`.

- [ ] **A** → `ACCOUNTING_VALIDATION.sql`
- [ ] **B** → `PHASE10_FISCAL_VALIDATION.sql`
- [ ] **C** → `PHASE11_TREASURY_VALIDATION.sql`
- [ ] **D** → `PHASE12_VALIDATION.sql`
- [ ] **E** → `PHASE13_VALIDATION.sql`

Puntos imprescindibles que deben dar bien en cada kit:
- [ ] `v_balance_sumas_saldos` cuadra (Σ debe = Σ haber).
- [ ] `v_asientos_descuadrados` **vacío**.
- [ ] IVA fiscal vs contable sin diferencias no explicadas.
- [ ] Sin tarifas solapadas / sin billing items duplicados (Bloque E).
- [ ] Funciones de simulación marcadas `read-only` (provolatile = stable).

---

## 3. Qué revisar en la UI (`/contabilidad`)

- [ ] Plan de cuentas se ve (~70 cuentas).
- [ ] Libro diario y balance (cuadra).
- [ ] Posición IVA / posición fiscal por período.
- [ ] Cargar percepción de venta de prueba → aparece en el reporte.
- [ ] Registrar pago proveedor con retención → bruto/retención/neto correctos; **sin residual** en CxP.
- [ ] Resultado por centro de costo (tras imputar CC).
- [ ] Vincular orden logística a factura existente → sin duplicar.
- [ ] Crear billing run → calcular recurrente → aprobar/excluir ítems.
- [ ] Generar **borrador** de factura → queda `BORRADOR` (no `AUTORIZADO_ARCA`).
- [ ] Simular pricing logístico → "no priceable" con motivo (no inventa datos).
- [ ] Simular refundición anual → muestra resultado/asiento propuesto, **sin modificar datos**.

---

## 4. Go / No-go (frenar si pasa cualquiera de estos)

**NO avanzar** al siguiente bloque si:
- [ ] Una migración falló.
- [ ] Balance no cuadra o hay asientos descuadrados.
- [ ] Diferencias fiscal vs contable sin explicación.
- [ ] Error en alguna vista.
- [ ] Duplicación de facturación o billing items duplicados.
- [ ] Un borrador quedó **emitido** (AUTORIZADO_ARCA) en vez de BORRADOR.
- [ ] Se contabilizó algo sin aprobación.
- [ ] Una "simulación" modificó datos.

→ Si hay no-go: **frenar, capturar el error, no tocar datos a mano, no pasar a producción**
(ver §7 del runbook completo).

---

## 5. Qué NO ejecutar todavía (aunque exista el botón/RPC)

- [ ] ❌ **Cierre de período real** (`acc_execute_closing`) — sólo **simular**.
- [ ] ❌ **Refundición anual real** (`acc_execute_annual_closing`) — sólo **simular**.
- [ ] ❌ **Emisión ARCA** (los borradores no se emiten en staging).
- [ ] ❌ **Producción** — recién después de validar todo y aprobar (ver §9 del runbook).

---

## 6. Qué debe revisar el contador (antes de cierres reales)

- [ ] Plan de cuentas (`chart_of_accounts`).
- [ ] Cuentas IVA crédito (`1.1.05`) / débito (`2.1.02`) / saldo a pagar (`2.1.03`).
- [ ] Percepciones a depositar (`2.1.04/05/16`) y sufridas (`1.1.06/07`).
- [ ] Retenciones a depositar (`2.1.06/12/13/14/15`) y sufridas (`1.1.08`).
- [ ] Cuentas de ingresos (`4.x`) y gastos/costos (`5.x`/`6.x`); cuenta de gasto default (`6.1.10` `(*)`).
- [ ] Reglas de imputación (`accounting_rules`), especialmente las marcadas `(*)`.
- [ ] Centros de costo / unidades de negocio.
- [ ] Criterio de cierre mensual y de refundición anual.
- [ ] Resultado del ejercicio (`3.2.02`) y Resultados No Asignados (`3.2.01`).

---

## 7. Evidencia que Martín debe guardar

Por cada bloque (A–E):
- [ ] **Captura** del resultado del kit (columna `estado`).
- [ ] **Resultado de los kits** (export del output o screenshot).
- [ ] **Logs/errores** si alguna migración o vista falla (código `SQLSTATE`, mensaje, hint).
- [ ] **Capturas de la UI** de las pruebas de §3.
- [ ] **Lista de migraciones aplicadas OK** (para saber el estado parcial si algo se corta).
- [ ] Nota de **qué quedó pendiente** o requirió ajuste (cuentas/reglas con el contador).

> Guardar todo en un lugar accesible (Drive/issue) para el go/no-go a producción.

---

## 8. Cierre del checklist

- [ ] Bloques A–E aplicados sin error.
- [ ] Los 5 kits en `OK`.
- [ ] UI funcional.
- [ ] Evidencia guardada.
- [ ] Contador validó plan de cuentas/reglas.
- [ ] **Recién entonces** se evalúa producción (checklist §9 del runbook completo).

*Checklist operativo. No constituye aplicación. Las migraciones las aplica Martín a mano.*
