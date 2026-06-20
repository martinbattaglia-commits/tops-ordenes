# Auditoría Contable e Impositiva — Nexus

> **Empresa:** Logística TOPS / VEROTIN S.A. (3PL) · **Fecha:** 2026-06-20
> **Alcance:** capa fiscal, contable y de cierre (IVA, compras, ventas, tesorería, contabilidad).
> **Naturaleza:** informe de auditoría (Fase 1). El detalle ampliado vive en
> `AUDITORIA_CONTABLE_IMPOSITIVA_NEXUS.md` (raíz). La implementación derivada de
> esta auditoría está documentada en `docs/contabilidad-nexus.md`.

---

## 1. Resumen ejecutivo

Nexus tenía, antes de esta intervención, una **capa fiscal/operativa sólida y bien
construida** (IVA Compras, IVA Ventas, facturación ARCA, tesorería con cobros/pagos
imputados a comprobantes) pero **carecía por completo de una capa contable**: no
existían plan de cuentas, asientos por partida doble, libro diario, mayor, balance
de sumas y saldos ni una posición mensual de IVA consolidada.

**Diagnóstico central (confirmado con evidencia):**

| Pilar | Estado al auditar |
|---|---|
| IVA Compras (crédito fiscal) | ✅ Existe y es maduro (multi-alícuota, percepciones/retenciones desglosadas, libro IVA) |
| IVA Ventas (débito fiscal) | ✅ Existe (débito discriminado por alícuota, libro IVA ventas) — **NO era la brecha** |
| Tesorería (cobros/pagos/banco) | ✅ MVP sólido (append-only, imputaciones a facturas) |
| Plan de cuentas (`chart_of_accounts`) | ❌ No existía |
| Asientos / libro diario / mayor | ❌ No existían |
| Balance de sumas y saldos / EERR | ❌ No existían |
| Posición mensual de IVA consolidada | ❌ No existía (los insumos sí) |
| Retenciones practicadas a proveedores | ❌ No modeladas |
| Períodos fiscales / cierre | ❌ No existían |

**La brecha real no era IVA Ventas, sino la ausencia de contabilidad.** Esa brecha
se cerró en esta intervención con la capa contable (migraciones 0082–0086 + módulo
UI), descrita en `docs/contabilidad-nexus.md`.

---

## 2. Estado actual de IVA Compras

**Maduro.** Migraciones 0008, 0014, 0056–0059, 0071.

- `supplier_invoices` (cabecera, caché reconciliada) + workflow de aprobación
  (`approval_status`: cargada→en_revision→aprobada→anulada).
- `supplier_invoice_vat_lines`: **crédito fiscal por alícuota** (pares AFIP validados
  0 / 2,5 / 5 / 10,5 / 21 / 27).
- `supplier_invoice_other_taxes`: **percepciones IVA/IIBB/Ganancias, impuesto interno,
  otros** (IIBB exige jurisdicción).
- Vistas `supplier_invoice_fiscal` y `libro_iva_compras` (por período/alícuota, con
  signo de NC). Export CSV/XLSX.
- Escritura del detalle solo vía RPC (`ap_create_supplier_invoice`), guards e
  inmutabilidad. RBAC módulo `cuentas_pagar`.

**Observación:** faltaba imputación contable (`chart_account_id`) y centro de costo en
ventas. La contabilización quedó resuelta por el motor de asientos (0085).

---

## 3. Estado actual de IVA Ventas

**Existe (corrige la premisa inicial).** Migraciones 0011, 0072, 0073, 0071.

- `customer_invoices` (cabecera fiscal: subtotal, iva, no gravado, exento,
  percepciones, tributos, total, período, CAE/QR, estado ARCA).
- `customer_invoice_vat_lines`: **débito fiscal por alícuota** (mismo rigor que
  compras; trigger diferido exige ≥1 línea y cuadre con cabecera ±0,02).
- Vistas `customer_invoice_fiscal` y `libro_iva_ventas` (por período/alícuota, NC con
  signo, corte por `fiscal_ambiente()` — al pasar a PRODUCCION los mocks SANDBOX se
  excluyen solos). RPC `ventas_persist_invoice`.

**Brechas detectadas:**
- **Percepciones de venta sin desglose** (solo totales en cabecera; no hay
  `customer_invoice_other_taxes`). Problema si Verotín actúa como agente de percepción.
- Emisión real a ARCA **gated** por certificado X.509 + ambiente PRODUCCION (hoy SANDBOX
  con mock).

---

## 4. Estado actual de tesorería

**MVP sólido.** Migraciones 0053–0055.

- `bank_accounts` (incluye CAJA de sistema), `treasury_movements` (append-only),
  `customer_receipts` (con `retention_amount` **sufrida** + `net_amount`),
  `supplier_payments` (**sin** retención practicada).
- `receipt_allocations` / `payment_allocations`: imputan cobros/pagos a facturas →
  el cobro baja la cuenta por cobrar y el pago la cuenta por pagar.
- Cuenta corriente AR/AP y saldos bancarios como **vistas derivadas**
  (`customer/supplier_current_account`, `treasury_bank_balances`).
- Conciliación bancaria: motor (parsers + matching) listo; persistencia/UI sin cerrar.

**Brechas:** sin retenciones practicadas; sin centro de costo en movimientos; sin
reflejo contable (resuelto ahora por el motor de asientos 0085).

---

## 5. Estado actual de facturación

- Motor `emitInvoice` genérico (no requiere OS); facturas nacen BORRADOR → CAE/QR →
  AUTORIZADO_ARCA → PDF. Inmutabilidad del comprobante autorizado por trigger.
- Facturación desde órdenes de servicio (`orders.invoice_id`, `invoice_items.order_id`)
  con hardening anti-refacturación (H4).
- **Brecha:** `logistics_orders` (3PL) no está conectado a facturación; facturación
  recurrente (contratos/tarifas, Flujo B) no implementada.

---

## 6. Brechas contables

| # | Brecha | Severidad | Estado tras esta intervención |
|---|---|---|---|
| B1 | Sin plan de cuentas | Crítico | ✅ Implementado (0083/0084) |
| B2 | Sin asientos / libro diario / mayor | Crítico | ✅ Implementado (0083/0085/0086) |
| B3 | Sin balance de sumas y saldos / EERR | Crítico | ✅ Implementado (0086) |
| B4 | Sin posición mensual de IVA consolidada | Crítico | ✅ Implementado (`v_posicion_iva`, 0086) |
| B5 | Operaciones sin asiento automático | Crítico | ✅ Motor de asientos (0085) |
| B6 | Percepciones de venta sin desglose | Alto | ✅ Cerrada en Fase 10 (`customer_invoice_other_taxes`, 0087) |
| B7 | Retenciones practicadas a proveedores | Alto | ✅ Cerrada en Fase 10 (`supplier_payment_withholdings`, 0088) |
| B8 | Sin períodos fiscales / cierre | Alto | ✅ `accounting_periods` (0083) — cierre por estado |
| B9 | `logistics_orders` no facturable | Alto | ⛔ Pendiente (decisión de negocio) |
| B10 | `cost_centers` ausente en ventas/tesorería | Medio | ⛔ Parcial (presente en líneas de asiento de compra) |

---

## 7. Riesgos

| Riesgo | Clasif. | Impacto |
|---|---|---|
| Cierre de balance dependía 100% de planillas externas | Crítico | Re-trabajo, errores, sin única fuente de verdad → **mitigado** con la capa contable |
| Posición de IVA armada a mano | Crítico | Error en DDJJ mensual, saldos mal calculados → **mitigado** (`v_posicion_iva`) |
| Sin trazabilidad documento↔asiento | Crítico | Inauditable ante AFIP → **mitigado** (source_type/source_id por asiento) |
| Percepciones de venta sin desglose | Alto | DDJJ de percepciones incompleta (si es agente) → **pendiente** |
| Retenciones practicadas fuera del sistema | Alto | SICORE/IIBB mal soportados → **pendiente** |
| Emisión ARCA en freeze | Alto (operativo) | Si se factura por fuera, el sistema no es la fuente fiscal real |
| Reglas de imputación por defecto | Medio | Ventas/gastos van a cuentas default hasta validar con contador (configurable) |

---

## 8. Recomendación técnica

1. **No reinventar lo fiscal: reflejarlo.** El asiento es un derivado del documento
   (subledger manda, GL refleja). Cada operación genera un asiento balanceado,
   idempotente y trazable. **(Implementado.)**
2. **Posición de IVA como vista sobre los libros existentes.** Quick win de alto valor.
   **(Implementado: `v_posicion_iva`.)**
3. **Plan de cuentas seedeado pero gestionable**, con reglas de imputación
   configurables (`accounting_rules`) — sin hardcodear cuentas en el frontend.
   **(Implementado.)**
4. **Todo aditivo.** No se tocó ninguna tabla fiscal ni de tesorería; la contabilidad
   solo las **lee**. **(Cumplido.)**
5. **Cerrar las brechas impositivas concretas** (percepciones de venta, retenciones
   practicadas) como siguiente paso, por su bajo esfuerzo y alto riesgo legal.
6. **Validar el plan de cuentas y las reglas con el contador externo** antes de dar
   por bueno el cierre (las cuentas default están marcadas con `(*)`).
7. **Aplicar en staging primero** y correr el kit de validación read-only
   (`supabase/tests/ACCOUNTING_VALIDATION.sql`) antes de producción.

---

## 9. Roadmap de implementación

| Fase | Entregable | Estado |
|---|---|---|
| F1 | Auditoría + documentación | ✅ (este informe + raíz) |
| F2 | Modelo contable (plan de cuentas, períodos, asientos) | ✅ 0082–0084 |
| F3 | Plan de cuentas base 3PL + reglas de imputación | ✅ 0084 |
| F4 | Motor de asientos automáticos (ventas, compras, cobros, pagos, reversa, backfill) | ✅ 0085 |
| F5 | Libros y reportes (diario, mayor, sumas y saldos, EERR, posición IVA, controles) | ✅ 0086 |
| F6 | Frontend administrativo de contabilidad | ✅ módulo `/contabilidad` |
| F7 | Backfill histórico seguro (dry-run → real) | ✅ `acc_backfill` + UI |
| F8 | Tests / validación | ✅ `ACCOUNTING_VALIDATION.sql` + typecheck verde |
| F9 | Documentación final | ✅ `docs/contabilidad-nexus.md` |
| F10.A/B/C | Percepciones de venta desglosadas + retenciones practicadas + integración contable | ✅ 0087–0089 |
| F11 | Tesorería con retenciones nativas (bruto/retención/neto) + formularios fiscales | ✅ 0090–0091 |
| F12 | Centros de costo (ventas/tesorería/contab.) · `logistics_orders`→facturación · base de cierre/refundición | ✅ 0092–0095 |
| F13 (resto) | Facturación recurrente/tarifas (Flujo B) · refundición anual multi-período · pricing de órdenes logísticas | ⛔ Pendiente |

> Las migraciones se **entregan**, no se aplican: las corre Martín a mano en Supabase
> (gobernanza G3). No se ejecutó ninguna migración ni se modificó producción.

### Fase 10 — Percepciones de venta y retenciones practicadas (cerradas)

Se cerraron las dos brechas fiscales/impositivas pendientes, de forma **aditiva** y
compatible con 0082–0086 (commit separado):

- **10.A — Percepciones de venta** (`0087`): tabla `customer_invoice_other_taxes`
  (tipo/jurisdicción/base/alícuota/importe), RPC `ventas_persist_other_taxes`, cuentas
  y reglas por tipo. No se mezcla con el IVA débito (que vive en `customer_invoice_vat_lines`).
- **10.B — Retenciones practicadas** (`0088`): tabla `supplier_payment_withholdings`
  (tipo/jurisdicción/base/alícuota/importe/certificado), RPC
  `ap_register_payment_withholdings`, cuentas "a depositar" por tipo. Genera deuda fiscal.
- **10.C — Integración contable** (`0089`): `acc_post_sales_invoice` desglosa percepciones
  por tipo cuando el detalle cuadra con la cabecera; `acc_post_supplier_payment` arma
  **DEBE Proveedores (neto+retenciones) / HABER Banco (neto) + Retenciones a depositar**.
  Reportes: `v_percepciones_ventas`, `v_retenciones_practicadas`,
  `v_pagos_proveedor_retenciones`, `v_posicion_fiscal_mensual`,
  `v_percep_retenc_fiscal_vs_contable`, `v_comprobantes_diferencias_fiscales`.
- **UI**: `/contabilidad/posicion-fiscal`, `/percepciones-ventas`, `/retenciones`.
- **Validación**: `supabase/tests/PHASE10_FISCAL_VALIDATION.sql`.
- **Detalle técnico**: ver `docs/contabilidad-nexus.md` § "Fase 10".

> Limitación documentada en Fase 10 (residual en `supplier_open_items` por allocations al
> neto) → **RESUELTA en Fase 11** con la RPC nativa que imputa el bruto. Ver abajo.

### Fase 11 — Tesorería con retenciones nativas y formularios fiscales (cerrada)

Cierra el gap operativo de Fase 10: ahora un pago a proveedor con retención **cancela la
cuenta corriente por el bruto, egresa el neto por banco/caja y registra la retención**,
sin residual y con asiento balanceado.

- **11.B/C — RPC nativa** (`0090`): `tesoreria_register_supplier_payment_neto` imputa
  `payment_allocations = bruto` (cancela CxP por bruto), `supplier_payments.amount = neto`
  (+ columnas `gross_amount`/`withheld_amount`), `treasury_movements = neto`, y registra
  `supplier_payment_withholdings`. La RPC vieja `tesoreria_register_payment` queda **intacta**
  (pagos sin retención). El asiento (acc_post de 0089) ya daba DEBE Proveedores (neto+ret=bruto)
  / HABER Banco (neto) + Retenciones → todo coincide. **Sin residual.**
- **11.D/F — Reportes y diagnóstico** (`0091`): `v_supplier_payment_detalle`
  (bruto/retención/neto + balanceado), `v_pagos_retencion_residual` (detecta pagos
  desbalanceados — los nativos no aparecen), `v_pagos_tesoreria_vs_contable` (conciliación) y
  `tesoreria_diagnose_payment_withholdings(dry_run)` (diagnóstico read-only; **no** corrige
  automáticamente porque las allocations son inmutables).
- **11.E — UI**: `/contabilidad/pagos-retenciones` (alta de pago con retención, muestra
  bruto/retención/neto) y `/contabilidad/percepciones-cargar` (alta de percepciones de venta).
- **Validación**: `supabase/tests/PHASE11_TREASURY_VALIDATION.sql`.
- **Detalle técnico**: ver `docs/contabilidad-nexus.md` § "Fase 11".

> Edge documentado: la RPC nativa exige **neto > 0** (no soporta retención del 100% del
> pago, caso virtualmente inexistente, por el `check (amount > 0)` de `supplier_payments`).
> Pagos legacy con retenciones cargadas por la vía de Fase 10 (allocations al neto) quedan
> listados en `v_pagos_retencion_residual` para corrección manual; el diagnóstico no los
> reescribe (allocations inmutables).

### Fase 12 — Centros de costo, logística facturable y base de cierre (cerrada)

- **12.B/C — Centro de costo como dimensión** (`0092`): `cost_centers` extendido
  (`type`, `updated_at`) + seed de unidades de negocio (ALMACENAJE, ANMAT, CARGAS,
  LOGISTICA, TRANSPORTE, OFICINAS) y sedes; `cost_center_id` agregado a
  `customer_invoices` y `treasury_movements` (compras y `journal_entry_lines` ya lo tenían).
  El asiento de venta (`0094`) imputa las Ventas al centro de costo de la factura.
- **12.D/E — `logistics_orders` → facturación** (`0093`): `logistics_order_billing_links`
  (1 vínculo por orden → sin duplicación) + RPC `logistics_set_billing_status` /
  `logistics_link_invoice` + vistas de facturables/facturadas/no facturables. **Partial
  seguro**: como `logistics_orders` no tiene precio ni `client_id`, NO se auto-emite ni
  auto-tarifa; se detecta y se vincula a una factura emitida por el flujo de ventas existente.
- **12.F — Base de cierre/refundición** (`0095`): `accounting_closing_runs` +
  `acc_simulate_closing` (**read-only**) + `acc_execute_closing` (gateado: `p_confirm=true`
  + `contabilidad.admin`, rechaza con descuadrados/comprobantes sin asiento/IVA diffs) +
  `acc_reopen_period` (auditado, con reversa). Vistas `v_periodos_para_cierre`,
  `v_refundicion_simulacion`.
- **12.G — Reportes** (`0094`): `v_estado_resultados_cc`, `v_libro_mayor_cc`,
  `v_resultado_por_cc` (rentabilidad por CC).
- **12.H — UI**: `/contabilidad/centros-costo`, `/resultado-cc`, `/ordenes-facturar`,
  `/cierre`.
- **Validación**: `supabase/tests/PHASE12_VALIDATION.sql`.
- **Detalle técnico**: ver `docs/contabilidad-nexus.md` § "Fase 12".

> Pendiente real (F13): facturación recurrente/tarifas (Flujo B no implementado),
> refundición **anual** multi-período (hoy el cierre es por período mensual), y pricing de
> órdenes logísticas (sin tarifa no hay monto automático).

---

## 10. Checklist de validación final

### Impositivo
- [x] IVA crédito fiscal multi-alícuota (compras)
- [x] IVA débito fiscal multi-alícuota (ventas)
- [x] Libro IVA Compras / Ventas (vistas + export compras)
- [x] **Posición mensual de IVA consolidada** (`v_posicion_iva`)
- [x] Percepciones IVA sufridas y retenciones sufridas en la posición
- [x] Percepciones de venta desglosadas (Fase 10 · 0087)
- [x] Retenciones practicadas a proveedores (Fase 10 · 0088)

### Contable
- [x] Plan de cuentas (`chart_of_accounts`) seedeado y gestionable
- [x] Períodos contables con cierre/bloqueo (`accounting_periods`)
- [x] Asientos por partida doble (`journal_entries` / `journal_entry_lines`)
- [x] Invariante de balance (Σ debe = Σ haber) por trigger
- [x] Motor de asientos automáticos por documento + reversa
- [x] Trazabilidad documento ↔ asiento (`source_type` / `source_id`)
- [x] Libro diario / mayor / balance de sumas y saldos / estado de resultados
- [x] Idempotencia (un asiento activo por documento)

### Integración
- [x] Factura venta → IVA ventas → CxC → asiento
- [x] Factura compra → IVA compras → CxP → asiento
- [x] Cobranza → baja CxC → banco/caja → asiento
- [x] Pago → baja CxP → banco/caja → asiento
- [x] Backfill histórico con dry-run

### Técnico / gobierno
- [x] RLS en todas las tablas contables
- [x] RBAC módulo `contabilidad` (view/create/edit/export/admin)
- [x] Escrituras contables vía RPC SECURITY DEFINER
- [x] Migraciones idempotentes y numeradas (entregadas, NO aplicadas)
- [x] Kit de validación read-only
- [x] `tsc --noEmit` verde en `src/`
